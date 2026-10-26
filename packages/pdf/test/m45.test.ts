// M4.5 in @techaust/pdf [ADM-PROP-08, POR-04]: the `./view` entry the portal imports (and only that), and the acceptance certificate page.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { serializeEnvelope } from "../src/envelope.ts";
import { type CertificateView, certificateBody } from "../src/layout/certificate-skeleton.ts";
import { renderCertificateHtml } from "../src/render.ts";
import { toPdfView } from "../src/view.ts";
import * as entry from "../src/view-entry.ts";
import { buildFixture } from "./fixtures/index.ts";

const read = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

describe("@techaust/pdf/view: what the portal may import", () => {
  it("exports the projection and the reader of a stored copy, nothing else at runtime", () => {
    expect(Object.keys(entry).sort()).toEqual(["DEFAULT_VIEW_CONFIG", "parseEnvelope", "toPdfView"]);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports["./view"]).toBe("./src/view-entry.ts");
  });

  it("a stored copy read back through the entry gives the same view as the original (what the portal returns is the PDF's view)", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const back = entry.parseEnvelope(serializeEnvelope(envelope));
    expect(back).not.toBeNull();
    expect(entry.toPdfView(back as NonNullable<typeof back>)).toEqual(toPdfView(envelope));
  });

  it("refuses text that is not a stored copy", () => {
    for (const text of [
      "",
      "null",
      "[]",
      "{}",
      '{"v":1}',
      "not json",
      '{"v":2,"documentId":"d","snapshotSha256":"s"}',
    ]) {
      expect(entry.parseEnvelope(text), text).toBeNull();
    }
  });

  it("the view entry's files never import the fonts, the HTML templates, the hashing code or the core package root", () => {
    for (const f of ["view-entry.ts", "parse-envelope.ts", "view.ts", "format.ts", "types.ts"]) {
      const src = read(f);
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string);
      for (const i of imports) {
        expect(i, `${f} imports ${i}`).not.toMatch(
          /generated|render|layout|hash|^\.\/envelope\.ts|bundle|@techaust\/db/,
        );
        expect(i, `${f} imports ${i}`).not.toBe("@techaust/core");
      }
    }
  });

  it("the view carries no catalogue rate, no catalogue id and no staff id (a key scan of the whole view)", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const text = JSON.stringify(entry.toPdfView(envelope));
    for (const key of [
      "catalogueRateMinor",
      "catalogueItemId",
      "catalogueLine",
      "staffId",
      "hidden",
      "computedJson",
    ]) {
      expect(text, key).not.toContain(key);
    }
  });
});

describe("the acceptance certificate page", () => {
  const view: CertificateView = {
    number: "TH/PRP/2627/0003",
    version: "2",
    total: "₹2,95,000.00",
    kind: "Proposal",
    title: "Website rebuild",
    clientLegalName: "Sample Traders Pvt Ltd",
    typedName: "Asha <script>alert(1)</script> Rao",
    email: "asha@example.test",
    acceptedAtIst: "26 Oct 2026, 10:30 IST",
    acceptedAtUtc: "2026-10-26 05:00:00 UTC",
    ip: "203.0.113.9",
    userAgent: 'UA/1 "quoted" <b>',
    country: "IN",
    via: "link",
    pdfSha256: "a".repeat(64),
    snapshotSha256: "b".repeat(64),
    termsVersion: "4",
    termsSha256: "c".repeat(64),
  };

  it("escapes every value, prints both times, the evidence and the fingerprints, and keeps its test contract", () => {
    const html = renderCertificateHtml(view);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain("26 Oct 2026, 10:30 IST");
    expect(html).toContain("2026-10-26 05:00:00 UTC");
    expect(html).toContain("203.0.113.9");
    expect(html).toContain("a".repeat(64));
    expect(html).toContain("b".repeat(64));
    expect(html).toContain("From the emailed link");
    for (const id of ["typed-name", "time", "sha"]) expect(html).toContain(`data-testid="${id}"`);
  });

  it("is one self-contained page: a CSP that refuses the network, no script, no external reference", () => {
    const html = renderCertificateHtml(view);
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\b(?:src|href)=["']https?:/i);
    expect(html).not.toMatch(/@import|url\(\s*["']?https?:/i);
  });

  it("prints the frozen total under the number and version (07-N §5), with the rupee sign in the embedded font", () => {
    const body = certificateBody(view);
    const at = (s: string) => body.indexOf(s);
    expect(body).toContain('<th scope="row">Total</th><td>₹2,95,000.00</td>');
    expect(at("Number and version")).toBeLessThan(at(">Total<"));
    expect(at(">Total<")).toBeLessThan(at("Prepared for"));
    // The page embeds the same Archivo as the documents, including its own U+20B9 face, so the sign never falls back.
    expect(renderCertificateHtml(view)).toMatch(/unicode-range: U\+20B9;/);
  });

  it("a session acceptance says so; a missing value prints as the dash the view gives it", () => {
    expect(certificateBody({ ...view, via: "session" })).toContain("Signed in to the client portal");
    expect(certificateBody({ ...view, ip: "–" })).toContain("–");
  });
});
