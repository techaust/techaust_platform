// The PDF panel's and the signature control's rules and wording (M4.4; 07-P §3, §4).
import { SIGNATURE_MAX_BYTES, SIGNATURE_MIMES } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import {
  adoptVersion,
  PDF_COPY,
  PDF_SLOW_AFTER_MS,
  pdfPhase,
  SIGNATURE_ACCEPT,
  SIGNATURE_COPY,
  SIGNATURE_MAX,
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
  it("accepts a PNG or JPEG of up to 256 KB, as the API does", () => {
    expect(SIGNATURE_MAX).toBe(SIGNATURE_MAX_BYTES);
    expect(SIGNATURE_ACCEPT.split(",")).toEqual([...SIGNATURE_MIMES]);
    expect(signatureFileOk({ type: "image/png", size: 1 })).toBe(true);
    expect(signatureFileOk({ type: "image/jpeg", size: SIGNATURE_MAX })).toBe(true);
  });
  it("refuses another type, an empty file or a larger one", () => {
    expect(signatureFileOk({ type: "image/svg+xml", size: 100 })).toBe(false);
    expect(signatureFileOk({ type: "image/webp", size: 100 })).toBe(false);
    expect(signatureFileOk({ type: "image/png", size: 0 })).toBe(false);
    expect(signatureFileOk({ type: "image/png", size: SIGNATURE_MAX + 1 })).toBe(false);
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
    expect(PDF_COPY.pending).toBe("The PDF is still being made. Try again in a minute.");
    expect(PDF_COPY.done).toBe("The PDF is already made.");
    expect(SIGNATURE_COPY).toEqual({
      heading: "Signature",
      hint: 'Printed on tax invoices above "Authorised signatory". PNG or JPEG, up to 256 KB.',
      upload: "Upload signature",
      replace: "Replace",
      remove: "Remove",
      removeQuestion: "Remove the signature? Invoices issued already keep theirs.",
      wrongFile: "Use a PNG or JPEG image up to 256 KB.",
    });
  });
});
