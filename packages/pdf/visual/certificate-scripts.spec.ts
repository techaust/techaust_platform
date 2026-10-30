// FX-5 (full audit A4 3): the acceptance certificate with a name typed in Bengali and one in Devanagari. Archivo has neither script, so the
// Noto Sans Bengali and Devanagari subsets join the "Archivo" family for those characters (scripts/build-assets.ts). The gate: no request
// leaves the page, every face loads, the name is drawn only with the embedded faces (never a system font), and the PDF Chromium prints embeds
// the Noto subset it used. Run: bash tools/heavy.sh --log pdf-visual pnpm --filter @techaust/pdf test:visual
import { PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { expect, type Page, test } from "@playwright/test";
import type { CertificateView } from "../src/layout/certificate-skeleton.ts";
import { renderCertificateHtml } from "../src/render.ts";

const base: CertificateView = {
  number: "TH/PRP/2627/0003",
  version: "2",
  total: "₹2,95,000.00",
  kind: "Proposal",
  title: "Website rebuild",
  clientLegalName: "Sample Traders Pvt Ltd",
  typedName: "",
  email: "client@example.test",
  acceptedAtIst: "26 Oct 2026, 10:30 IST",
  acceptedAtUtc: "2026-10-26 05:00:00 UTC",
  ip: "203.0.113.9",
  userAgent: "Mozilla/5.0 (sample)",
  country: "IN",
  via: "link",
  pdfSha256: "a".repeat(64),
  snapshotSha256: "b".repeat(64),
  termsVersion: "2",
  termsSha256: "c".repeat(64),
};

/** Sample names (not client data): each with a conjunct and vowel signs, so shaping is exercised. */
const NAMES = [
  { script: "Bengali", name: "অমিত ক্ষেত্রী", font: "NotoSansBengali" },
  { script: "Devanagari", name: "अमित क्षेत्री", font: "NotoSansDevanagari" },
] as const;

async function open(page: Page, typedName: string) {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.emulateMedia({ media: "print" });
  await page.setContent(renderCertificateHtml({ ...base, typedName }), { waitUntil: "load" });
  await page.evaluate("document.fonts.ready.then(() => true)");
  return requests;
}

for (const { script, name, font } of NAMES) {
  test.describe(`certificate with a ${script} name`, () => {
    test("loads only data: URLs, every face, and draws the name with embedded faces only", async ({
      page,
    }) => {
      const requests = await open(page, name);
      expect(requests.filter((u) => !u.startsWith("data:") && u !== "about:blank")).toEqual([]);
      const statuses = (await page.evaluate("[...document.fonts].map((f) => f.status)")) as string[];
      expect(statuses).not.toContain("error");
      const client = await page.context().newCDPSession(page);
      await client.send("DOM.enable");
      await client.send("CSS.enable");
      const doc = await client.send("DOM.getDocument", { depth: 0 });
      const found = await client.send("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: "[data-testid=typed-name]",
      });
      expect(found.nodeId).toBeGreaterThan(0);
      const { fonts } = await client.send("CSS.getPlatformFontsForNode", { nodeId: found.nodeId });
      // every glyph of the name comes from a face the page embeds: Archivo for the space, the Noto subset for the script
      expect(fonts.length).toBeGreaterThan(0);
      expect(fonts.every((f) => f.isCustomFont)).toBe(true);
      expect(fonts.some((f) => (f.postScriptName ?? "").startsWith(font))).toBe(true);
    });

    test("prints a PDF that embeds the Noto subset; nothing but the monospaced fingerprints falls back to a system font", async ({
      page,
    }) => {
      await open(page, name);
      const bytes = await page.pdf({ preferCSSPageSize: true, tagged: true, printBackground: true });
      const pdf = await PDFDocument.load(bytes);
      const names: string[] = [];
      for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
        if (obj instanceof PDFDict) {
          const b = obj.get(PDFName.of("BaseFont")) ?? obj.get(PDFName.of("FontName"));
          if (b) names.push(String(b));
        }
      }
      expect(names.some((n) => n.includes(font))).toBe(true);
      // Known gap, found here (FX-5 builder report, follow-up): the certificate's `.mono` fingerprints ask for IBM Plex Mono, which the PDF
      // fonts don't embed (TECHAUST_PDF_FONT_DATA holds Archivo only), so they print in the machine's monospace font. One such font at most.
      const others = names.filter((n) => !n.includes("Archivo") && !n.includes("NotoSans"));
      expect(others.length).toBeLessThanOrEqual(1);
      // the size this adds, for the report (A4 3 asked for it)
      console.log(`certificate PDF with a ${script} name: ${bytes.length} bytes`);
    });
  });
}
