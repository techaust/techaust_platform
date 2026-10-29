// The PDF panel's and the signature control's rules and wording (M4.4; 07-P §3, §4).
import { SIGNATURE_MAX_BYTES, SIGNATURE_MIMES } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import pdfPanelSource from "../routes/documents/pdf-panel.tsx?raw";
import invoiceReadSource from "../routes/invoices/read.tsx?raw";
import {
  adoptVersion,
  PDF_COPY,
  PDF_SLOW_AFTER_MS,
  pdfPhase,
  pdfReadChanged,
  pdfRetryText,
  SIGNATURE_ACCEPT,
  SIGNATURE_COPY,
  SIGNATURE_INPUT_MAX,
  SIGNATURE_MAX,
  signatureErrorIsWrongFile,
  signatureFileOk,
} from "./pdf.ts";

describe("pdfPhase", () => {
  const t0 = 1_800_000_000_000;
  it("a draft has no PDF and a made one is ready", () => {
    expect(pdfPhase("none", t0, t0)).toBe("none");
    expect(pdfPhase("ready", t0, t0 + 10 * PDF_SLOW_AFTER_MS)).toBe("ready");
  });
  it("is making it for 5 minutes after the send or a retry, then says it is slow", () => {
    expect(pdfPhase("pending", t0, t0)).toBe("making");
    expect(pdfPhase("pending", t0, t0 + PDF_SLOW_AFTER_MS - 1)).toBe("making");
    expect(pdfPhase("pending", t0, t0 + PDF_SLOW_AFTER_MS)).toBe("slow");
  });
  it("without a start it offers the retry at once", () => {
    expect(pdfPhase("pending", null, t0)).toBe("slow");
  });
});

describe("the signature file", () => {
  it("reads a PNG or JPEG of up to 10 MB before scaling; the stored PNG's limit stays the API's 256 KB (fix round, lead 2026-10-29)", () => {
    expect(SIGNATURE_MAX).toBe(SIGNATURE_MAX_BYTES);
    expect(SIGNATURE_INPUT_MAX).toBe(10 * 1024 * 1024);
    expect(SIGNATURE_ACCEPT.split(",")).toEqual([...SIGNATURE_MIMES]);
    expect(signatureFileOk({ type: "image/png", size: 1 })).toBe(true);
    expect(signatureFileOk({ type: "image/jpeg", size: SIGNATURE_MAX + 1 })).toBe(true);
    expect(signatureFileOk({ type: "image/jpeg", size: 1024 * 1024 })).toBe(true);
    expect(signatureFileOk({ type: "image/jpeg", size: SIGNATURE_INPUT_MAX })).toBe(true);
  });
  it("refuses another type, an empty file or one over 10 MB", () => {
    expect(signatureFileOk({ type: "image/svg+xml", size: 100 })).toBe(false);
    expect(signatureFileOk({ type: "image/webp", size: 100 })).toBe(false);
    expect(signatureFileOk({ type: "image/png", size: 0 })).toBe(false);
    expect(signatureFileOk({ type: "image/png", size: SIGNATURE_INPUT_MAX + 1 })).toBe(false);
    expect(signatureFileOk({ type: "image/jpeg", size: 11 * 1024 * 1024 })).toBe(false);
  });
});

describe("the API's refusals in 07-P's words", () => {
  it("says a wrong type or size as 07-P does; other answers keep the server's sentence", () => {
    expect(signatureErrorIsWrongFile("file_too_large")).toBe(true);
    expect(signatureErrorIsWrongFile("type_not_allowed")).toBe(true);
    expect(signatureErrorIsWrongFile("image_too_big")).toBe(true);
    expect(signatureErrorIsWrongFile("stale_version")).toBe(false);
  });
  it("words the retry's known refusals", () => {
    expect(pdfRetryText("pdf_done")).toBe(PDF_COPY.done);
    expect(pdfRetryText("pdf_pending")).toBe(PDF_COPY.pending);
    expect(pdfRetryText("not_found")).toBeNull();
  });
});

describe("adoptVersion", () => {
  it("takes on only the next version; anything else keeps the form's own (a later save then says someone else saved)", () => {
    expect(adoptVersion(4, 5)).toBe(5);
    expect(adoptVersion(4, 7)).toBe(4);
    expect(adoptVersion(4, 4)).toBe(4);
  });
});

describe("the wording (07-P §3, §4)", () => {
  it("is word for word", () => {
    expect(PDF_COPY.download).toBe("Download PDF");
    expect(PDF_COPY.ready).toBe("PDF ready");
    expect(PDF_COPY.making).toBe("Making the PDF…");
    expect(PDF_COPY.slow).toBe("The PDF is taking longer than usual.");
    expect(PDF_COPY.tryAgain).toBe("Try again");
    expect(PDF_COPY.retried).toBe("We'll make the PDF again.");
    expect(PDF_COPY.fingerprint("0123456789ab")).toBe("Fingerprint 0123456789ab");
    expect(`${PDF_COPY.fingerprintLabel} 0123456789ab`).toBe(PDF_COPY.fingerprint("0123456789ab"));
    expect(PDF_COPY.pending).toBe("The PDF is still being made. Try again in a minute.");
    expect(PDF_COPY.done).toBe("The PDF is already made.");
    expect(SIGNATURE_COPY).toEqual({
      heading: "Signature",
      hint: `Optional. Invoices you send electronically don't need a signature (GST Rule 46). If you add one, it prints above "Authorised signatory".`,
      upload: "Upload signature",
      replace: "Replace",
      remove: "Remove",
      removeQuestion: "Remove the signature? Invoices issued already keep theirs.",
      // FX-3: 07-Y, amended by the lead in the fix round (10 MB in, a PNG of up to 256 KB stored)
      wrongFile: "[Placeholder] Use a PNG or JPEG image up to 10 MB. We store it as a PNG of up to 256 KB.",
      scaled: "[Placeholder] We made the image smaller to fit 800 by 400 pixels.",
      tooDetailed:
        "[Placeholder] This image is too detailed to keep as a signature. Use a scan on a plain white background.",
    });
  });
});

describe("FX-4 review H2: the PDF panel follows the page's read in place, never remounted", () => {
  const pending = { state: "pending", fingerprint: null };
  const ready = { state: "ready", fingerprint: "a1b2c3d4e5f6" };
  it("another state or another file is news; the same read is not", () => {
    expect(pdfReadChanged(pending, ready)).toBe(true);
    expect(pdfReadChanged(ready, { state: "ready", fingerprint: "ffffffffffff" })).toBe(true);
    expect(pdfReadChanged(ready, { ...ready })).toBe(false);
    expect(pdfReadChanged(pending, { ...pending })).toBe(false);
  });
  it("the invoice page keys the panel on the document only, so turning ready keeps the focus and the live region", () => {
    const keys = [...invoiceReadSource.matchAll(/<PdfPanel[\s\S]*?key=\{([^}]*)\}/g)].map((m) => m[1]);
    expect(keys).toEqual(["v.id"]);
    expect(invoiceReadSource).not.toMatch(/key=\{`\$\{v\.id\}-\$\{v\.pdf\.state\}`\}/);
  });
  it("the panel takes a newer read from its props, and its words sit in a polite region that is always drawn", () => {
    expect(pdfPanelSource).toMatch(
      /if \(pdfReadChanged\(read, props\.initial\)\) \{\s*setRead\(props\.initial\);\s*setPdf\(props\.initial\);/,
    );
    expect(pdfPanelSource).toMatch(/<div className="pdf-panel__text" aria-live="polite">\s*<h2 id="pdf-h"/);
  });
});
