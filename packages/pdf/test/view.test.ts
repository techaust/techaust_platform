// toPdfView: pre-formatted strings, no arithmetic, empty supplier fields left out.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countryName, formatMicros, formatQty, longIsoDate, shortIsoDate } from "../src/format.ts";
import { DEFAULT_VIEW_CONFIG, toPdfView } from "../src/view.ts";
import { buildFixture, FIXTURE_NAMES, SAMPLE_SUPPLIER_GSTIN } from "./fixtures/index.ts";

/** Every string value in a plain object tree. */
const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];

describe("view.ts has no arithmetic on money", () => {
  // Comments and string literals are removed, then the operators the brief bans must not appear in the code.
  const src = readFileSync(new URL("../src/view.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
  it.each([
    ["multiplication or a comment opener", /\*/],
    ["division", /\//],
    ["Math.", /Math\./],
    ["parseFloat", /parseFloat/],
    ["toFixed", /toFixed/],
  ])("has no %s", (_n, re) => {
    expect(src).not.toMatch(re);
  });
});

describe("toPdfView", () => {
  it("builds the title, labels and integrity line", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const v = toPdfView(envelope);
    expect(v.title).toBe("Proposal TH/PRP/2627/0003 v2 – Sample Client");
    expect(v.docLabel).toBe("Proposal");
    expect(v.versionLabel).toBe("Version 2");
    expect(v.statusText).toBe("Sent");
    expect(v.issueDate).toBe("26 Oct 26");
    expect(v.validUntil).toBe("10 Nov 26");
    expect(v.version).toBe("2");
    expect(v.portalLink).toBe("portal.techaust.com");
    expect(v.integrity).toBe(
      `Document ID ${envelope.documentId} · Content fingerprint ${envelope.snapshotSha256.slice(0, 12)}`,
    );
    expect(v.footer.sender).toBe("hello@techaust.com");
    expect(v.notice).toBeNull();
  });

  it("formats money from the computed result, in the Indian system for INR", async () => {
    const { envelope, computed } = await buildFixture("short-intra-inr");
    const v = toPdfView(envelope);
    const total = v.totals.find((t) => t.key === "total");
    expect(total?.strong).toBe(true);
    expect(total?.value).toMatch(/^₹\d{1,2},\d{2},\d{3}\.\d{2}$|^₹\d{1,3},\d{3}\.\d{2}$/);
    expect(total?.value.replace(/[^\d]/g, "")).toBe(String(computed.totalMinor));
    expect(v.words).toBe(computed.words);
    expect(v.lines).toHaveLength(3);
    expect(v.lines[1]?.qty).toBe("1.5");
    // 07-P "18 %": a space before the sign, a no-break one so the two never part at a line end
    expect(v.lines[2]?.discount).toBe("10\u00a0%");
  });

  it("shows CGST and SGST for a supply inside the state, IGST for another state", async () => {
    const intra = toPdfView((await buildFixture("intra-estimate")).envelope);
    expect(intra.totals.map((t) => t.key)).toEqual(expect.arrayContaining(["cgst", "sgst"]));
    expect(intra.totals.map((t) => t.key)).not.toContain("igst");
    expect(intra.placeOfSupply).toBe("West Bengal (19)");
    const inter = toPdfView((await buildFixture("inter-estimate")).envelope);
    expect(inter.totals.map((t) => t.key)).toContain("igst");
    expect(inter.totals.map((t) => t.key)).not.toContain("cgst");
    expect(inter.placeOfSupply).toBe("Karnataka (29)");
  });

  it("prints the estimate notice only on estimates", async () => {
    expect(toPdfView((await buildFixture("intra-estimate")).envelope).notice).toBe(
      "This is an estimate, not a tax invoice.",
    );
  });

  it("an export: Outside India, no tax rows or summary, an INR note", async () => {
    const v = toPdfView((await buildFixture("usd-export")).envelope);
    expect(v.placeOfSupply).toBe("Outside India (96 – Other Territory)");
    expect(v.totals.map((t) => t.key)).toEqual(["subtotal", "taxable", "total"]);
    expect(v.summary).toEqual([]);
    expect(v.totals.at(-1)?.value).toMatch(/^\$/);
    expect(v.inrNote).toMatch(/^Indicative total in INR: ₹[\d,]+\.\d{2} \(1 USD = ₹83\.50\)\.$/);
  });

  it("lists the instalments with their frozen amounts and hides hidden sections", async () => {
    const { envelope } = await buildFixture("long-inter-inr");
    const v = toPdfView(envelope);
    expect(v.schedule).toHaveLength(4);
    expect(v.schedule[0]).toMatchObject({ when: "On acceptance", share: "25\u00a0%" });
    expect(v.sections.some((s) => s.title === "Hidden sample")).toBe(false);
    expect(v.sections.find((s) => s.kind === "custom")?.title).toBe("Sample custom section");
    expect(v.sections.find((s) => s.kind === "cover")?.title).toBe("Cover");
    expect(v.summary.length).toBeGreaterThan(0);
    expect(v.totals.map((t) => t.key)).toContain("discount");
    expect(v.totals.find((t) => t.key === "discount")?.value.startsWith("−")).toBe(true);
  });

  it("leaves empty supplier fields out: never null or a placeholder", async () => {
    const bare = toPdfView((await buildFixture("short-intra-inr", { bareSupplier: true })).envelope);
    expect(bare.supplier.name).toBe("TecHaust Technologies");
    // only the state (it has a default) and the sender address remain
    expect(bare.supplier.lines).toEqual(["State West Bengal (19)", "hello@techaust.com"]);
    expect(strings(bare).filter((s) => /null|undefined|NaN|Placeholder/.test(s))).toEqual([]);
    const full = toPdfView((await buildFixture("short-intra-inr")).envelope);
    expect(full.supplier.lines).toEqual([
      "Proprietor: Sample Proprietor",
      "1 Sample Supplier Road, Balurghat, West Bengal 733101",
      `GSTIN ${SAMPLE_SUPPLIER_GSTIN} · State West Bengal (19)`,
      "hello@techaust.com",
    ]);
  });

  it("prints Settings 'Email on documents' in the supplier block and the footer; an older version falls back to the default (07-Q Q11)", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const withEmail = structuredClone(envelope);
    withEmail.snapshot.header.issuer.company.email = "accounts@example.test";
    const v = toPdfView(withEmail);
    expect(v.footer.sender).toBe("accounts@example.test");
    expect(v.footer.brand).toBe("TecHaust Technologies · techaust.com · accounts@example.test");
    expect(v.supplier.lines.at(-1)).toBe("accounts@example.test");
    expect(toPdfView(envelope).footer.brand).toBe(
      "TecHaust Technologies · techaust.com · hello@techaust.com",
    );
  });

  it("builds the recipient block", async () => {
    const v = toPdfView((await buildFixture("short-intra-inr")).envelope);
    expect(v.recipient.name).toBe("Sample Client");
    expect(v.recipient.attention).toBe("Sample Contact");
    expect(v.recipient.lines).toEqual([
      "Sample Client Private Limited",
      "1 Sample Road",
      "Kolkata, West Bengal, 700001",
      "India",
      "GSTIN 19ABCDE1234F1ZX",
    ]);
  });

  it("refuses an envelope whose lines do not match the computed result", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const broken = {
      ...envelope,
      snapshot: { ...envelope.snapshot, lines: envelope.snapshot.lines.slice(1) },
    };
    expect(() => toPdfView(broken)).toThrow(RangeError);
  });

  it("refuses an unknown currency", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const bad = {
      ...envelope,
      snapshot: { ...envelope.snapshot, computedJson: JSON.stringify({ currency: "EUR", lines: [] }) },
    };
    expect(() => toPdfView(bad)).toThrow(RangeError);
  });

  it("every fixture builds a view with no unrendered values", async () => {
    for (const name of FIXTURE_NAMES) {
      const v = toPdfView((await buildFixture(name)).envelope, DEFAULT_VIEW_CONFIG);
      expect(strings(v).filter((s) => /undefined|NaN|{{/.test(s))).toEqual([]);
    }
  });
});

describe("format helpers", () => {
  it("formatQty writes milli-units", () => {
    expect(formatQty(1000)).toBe("1");
    expect(formatQty(1500)).toBe("1.5");
    expect(formatQty(250)).toBe("0.25");
    expect(formatQty(12_345)).toBe("12.345");
    expect(formatQty(-500)).toBe("-0.5");
  });
  it("formatMicros writes the rate with at least two places", () => {
    expect(formatMicros(83_500_000)).toBe("83.50");
    expect(formatMicros(83_123_456)).toBe("83.123456");
    expect(formatMicros(1_000_000)).toBe("1.00");
    expect(formatMicros(500_000)).toBe("0.50");
  });
  it("shortIsoDate keeps what it cannot read", () => {
    expect(shortIsoDate("2026-01-05")).toBe("05 Jan 26");
    expect(shortIsoDate("later")).toBe("later");
  });
  it("longIsoDate prints the four-digit year and keeps what it cannot read", () => {
    expect(longIsoDate("2026-01-05")).toBe("05 Jan 2026");
    expect(longIsoDate("later")).toBe("later");
  });
  it("toPdfView with longDates writes four-digit years in every date; the default stays short", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const v = toPdfView(envelope, undefined, { longDates: true });
    expect(v.issueDate).toBe("26 Oct 2026");
    expect(v.validUntil).toBe("10 Nov 2026");
    expect(v.validityNote).toBe("Valid until 10 Nov 2026");
    expect(toPdfView(envelope).validUntil).toBe("10 Nov 26");
  });
  it("countryName names a country and keeps an unknown code", () => {
    expect(countryName("IN")).toBe("India");
    expect(countryName("US")).toBe("United States");
    expect(countryName("!!")).toBe("!!");
  });
});
