// The site's one door to prices (src/lib/prices.ts) and the plain-text token renderer (src/lib/copy.ts) [WEB-G-07].
// Expected values come from the seed catalogue, so a catalogue edit shows up here on purpose.
import { CATALOGUE } from "@techaust/db/catalogue";
import { describe, expect, it } from "vitest";
import { home } from "../src/content/home";
import { aiDocumentAutomation } from "../src/content/services/ai-document-automation";
import { plainText } from "../src/lib/copy";
import { displayAmount, isVisible, lineByFirstWord, priceOf } from "../src/lib/prices";
import { parseTokens } from "../src/lib/tokens";

const entry = (code: string) => {
  const e = CATALOGUE.find((c) => c.code === code);
  if (!e) throw new Error(code);
  return e;
};

describe("priceOf", () => {
  it("reads an entry's headline price in both currencies, in minor units", () => {
    const p = priceOf("S1");
    expect(p.inr).toEqual({ amount: entry("S1").priceInr, currency: "INR" });
    expect(p.usd).toEqual({ amount: entry("S1").priceUsd, currency: "USD" });
  });

  it("reads a named default line ({{price:S16-essential}})", () => {
    const line = entry("S16").defaultLines?.find((l) => l.description === "Essential");
    expect(priceOf("S16-essential")).toEqual({
      inr: { amount: line?.rateInrMinor, currency: "INR" },
      usd: { amount: line?.rateUsdMinor, currency: "USD" },
    });
  });

  it("matches a default line on the first word of its description (S11-monthly, S11-setup)", () => {
    const lines = entry("S11").defaultLines ?? [];
    const setup = lines.find((l) => l.description === "Setup");
    const monthly = lines.find((l) => l.description === "Monthly management");
    expect(priceOf("S11-setup").inr.amount).toBe(setup?.rateInrMinor);
    expect(priceOf("S11-monthly").inr.amount).toBe(monthly?.rateInrMinor);
    expect(priceOf("S11-monthly").inr.amount).not.toBe(priceOf("S11-setup").inr.amount);
  });

  it("throws on an ambiguous first word and is not fooled by case", () => {
    const lines = [
      { description: "Monthly management" },
      { description: "monthly retainer" },
      { description: "Setup" },
    ];
    expect(() => lineByFirstWord("S0", lines, "monthly")).toThrow(/ambiguous/);
    expect(lineByFirstWord("S0", lines, "setup")).toBe(lines[2]);
    expect(lineByFirstWord("S0", lines, "other")).toBeUndefined();
  });

  it("shows S3 only when the catalogue switch and the flag are both on", () => {
    expect(isVisible({ code: "S3", showOnSite: true }, true)).toBe(true);
    expect(isVisible({ code: "S3", showOnSite: true }, false)).toBe(false);
    expect(isVisible({ code: "S3", showOnSite: false }, true)).toBe(false);
    expect(isVisible({ code: "S1", showOnSite: false }, true)).toBe(false);
    expect(isVisible({ code: "S1", showOnSite: true }, false)).toBe(true);
  });

  it("keeps USD null where a service isn't offered internationally", () => {
    expect(priceOf("S11").usd).toBeNull();
  });

  it("fails the build for a hidden entry, an unknown code or line, or a malformed reference", () => {
    expect(() => priceOf("S3")).toThrow(/hidden/);
    expect(() => priceOf("S99")).toThrow(/no catalogue entry/);
    expect(() => priceOf("S16-platinum")).toThrow(/no priced line/);
    expect(() => priceOf("five")).toThrow(/not a catalogue reference/);
  });
});

describe("displayAmount", () => {
  it("prints whole rupees in the Indian system and whole dollars, without a zero minor part", () => {
    expect(displayAmount(priceOf("S5").inr)).toBe("₹3,00,000");
    expect(displayAmount(priceOf("S5").usd ?? priceOf("S5").inr)).toBe("$12,000");
  });
});

describe("plainText (meta descriptions)", () => {
  it("renders {{price-plain:Sx}} as the INR amount with '+ GST', no extra 'from' (owner, 2026-10-22)", () => {
    expect(plainText(aiDocumentAutomation.meta.description)).toMatch(/Pilot from ₹2,00,000 \+ GST\.$/);
  });

  it("renders {{price:Sx}} with one 'from' and '+ GST'", () => {
    expect(plainText("Care from {{price:S16-essential}} a month.")).toBe("Care from ₹9,999 + GST a month.");
    expect(plainText("Discovery Sprint {{price:S1}}.")).toBe("Discovery Sprint from ₹40,000 + GST.");
  });
});

describe("content", () => {
  const texts = JSON.stringify([home, aiDocumentAutomation]);

  it("resolves every {{price:…}} token in the home and S9 copy", () => {
    // parseTokens is the one parser: it throws on an unknown token, code, line or hidden service.
    const strings: string[] = [];
    JSON.parse(texts, (_k, v) => {
      if (typeof v === "string") strings.push(v);
      return v;
    });
    const refs = strings.flatMap((s) => parseTokens(s).filter((p) => p.kind === "price"));
    expect(refs.length).toBeGreaterThan(0);
  });

  it("writes 'and', never '&', in page copy (07 §1.1); URLs may keep '&'", () => {
    const withoutUrls = texts.replace(/"\/[^"]*"/g, '""');
    expect(withoutUrls).not.toMatch(/&/);
  });
});
