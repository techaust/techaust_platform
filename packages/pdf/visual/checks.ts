// The five checks every document fixture goes through (M4.4; shared with the tax invoice layout in M5.1): the printed HTML in Chromium
// (data: URLs only, every font face loaded, the rupee sign in Archivo), the PDF Chromium prints from it (page count, title, embedded Archivo),
// a full-page screenshot, and the same page in grayscale with a contrast check.
import { PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { expect, type Page, test } from "@playwright/test";

/** The 4.5:1 check on every text colour, against the white page (the template never paints a coloured background). */
export const CONTRAST_SCRIPT = `(() => {
  const lum = (c) => { const a = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
  let min = 21; let worst = "";
  for (const el of document.body.querySelectorAll("*")) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
    if (!own) continue;
    const m = getComputedStyle(el).color.match(/\\d+(\\.\\d+)?/g).map(Number);
    const l = lum(m.slice(0, 3));
    const ratio = (1.05) / (l + 0.05);
    if (ratio < min) { min = ratio; worst = el.tagName + "." + el.className; }
  }
  return { min, worst };
})()`;

/** Opens one fixture in the page (print media, its HTML set) and says what was requested and what the PDF title must be. */
export type OpenFixture = (page: Page) => Promise<{ view: { title: string }; requests: string[] }>;

/** The five checks of one fixture, as a `describe` block named after it. Screenshots are `<name>.png` and `<name>-grayscale.png`. */
export function describeDocument(name: string, open: OpenFixture, minPages: number): void {
  test.describe(name, () => {
    test("loads only data: URLs and every font face", async ({ page }) => {
      const { requests } = await open(page);
      expect(requests.filter((u) => !u.startsWith("data:") && u !== "about:blank")).toEqual([]);
      await page.evaluate("document.fonts.ready.then(() => true)");
      const faces = (await page.evaluate(
        "[...document.fonts].map((f) => ({ family: f.family, status: f.status, range: f.unicodeRange }))",
      )) as { family: string; status: string; range: string }[];
      expect(faces).toHaveLength(2);
      expect(faces.every((f) => f.family.replaceAll('"', "") === "Archivo")).toBe(true);
      expect(faces.map((f) => f.status)).not.toContain("error");
      expect(faces.map((f) => f.status)).not.toContain("unloaded");
    });

    test("the rupee sign is set in Archivo, not a fallback font", async ({ page }) => {
      await open(page);
      await page.evaluate("document.fonts.ready.then(() => true)");
      const client = await page.context().newCDPSession(page);
      await client.send("DOM.enable");
      await client.send("CSS.enable");
      const doc = await client.send("DOM.getDocument", { depth: 0 });
      const found = await client.send("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: "[data-testid=rupee]",
      });
      expect(found.nodeId).toBeGreaterThan(0);
      const { fonts } = await client.send("CSS.getPlatformFontsForNode", { nodeId: found.nodeId });
      // Chromium names a variable-font instance after its weight ("Archivo SemiBold"), so the family is matched by its first word.
      const isArchivo = (f: { familyName: string; postScriptName?: string }) =>
        f.familyName.split(" ")[0] === "Archivo" && (f.postScriptName ?? "").startsWith("Archivo");
      const archivo = fonts.filter(isArchivo);
      expect(archivo.length).toBeGreaterThan(0);
      expect(archivo.every((f) => f.isCustomFont && f.glyphCount > 0)).toBe(true);
      expect(fonts.filter((f) => !isArchivo(f))).toEqual([]);
    });

    test("prints a PDF with the right page count, title and embedded Archivo", async ({ page }) => {
      const { view } = await open(page);
      await page.evaluate("document.fonts.ready.then(() => true)");
      const bytes = await page.pdf({ preferCSSPageSize: true, tagged: true, printBackground: true });
      expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(minPages);
      expect(pdf.getTitle()).toBe(view.title);
      const names: string[] = [];
      for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
        if (obj instanceof PDFDict) {
          const base = obj.get(PDFName.of("BaseFont")) ?? obj.get(PDFName.of("FontName"));
          if (base) names.push(String(base));
        }
      }
      expect(names.some((n) => n.includes("Archivo"))).toBe(true);
      // fonts that are not Archivo would mean a fallback was used somewhere in the document
      expect(names.filter((n) => !n.includes("Archivo"))).toEqual([]);
    });

    test("screenshot of the print-media HTML at A4 width", async ({ page }) => {
      await open(page);
      await page.evaluate("document.fonts.ready.then(() => true)");
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
    });

    test("grayscale: still legible, every text colour at least 4.5:1", async ({ page }) => {
      await open(page);
      await page.evaluate("document.fonts.ready.then(() => true)");
      const { min, worst } = (await page.evaluate(CONTRAST_SCRIPT)) as { min: number; worst: string };
      expect(min, `lowest contrast on ${worst}`).toBeGreaterThanOrEqual(4.5);
      await page.addStyleTag({ content: "html{filter:grayscale(1)}" });
      await expect(page).toHaveScreenshot(`${name}-grayscale.png`, { fullPage: true });
    });
  });
}
