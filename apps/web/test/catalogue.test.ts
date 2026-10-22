// The catalogue snapshot loader, scheduleOf, the S3 flag and the token renderer [ADM-CAT-05, WEB-G-07, WEB-G-17,
// WEB-SVC-05]. Expected values come from the seed catalogue, so a catalogue edit shows up here on purpose.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogueSnapshot } from "@techaust/core";
import { CATALOGUE } from "@techaust/db/catalogue";
import { afterAll, describe, expect, it } from "vitest";
import { flags } from "../src/config/site";
import { loadSnapshot, snapshotFromSeed } from "../src/lib/catalogue";
import { displayAmount, isServiceOnSite, priceOf, scheduleOf } from "../src/lib/prices";
import { hasTokens, parseTokens, renderPlain } from "../src/lib/tokens";

const dir = mkdtempSync(join(tmpdir(), "ta-snapshot-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const write = (name: string, content: string): string => {
  const f = join(dir, name);
  writeFileSync(f, content);
  return f;
};

const onSite = CATALOGUE.filter((c) => c.showOnSite).map((c) => c.code);

describe("snapshot from the seed", () => {
  const snap = snapshotFromSeed();

  it("passes the core schema and covers every catalogue entry", () => {
    expect(catalogueSnapshot.safeParse(snap).success).toBe(true);
    expect(snap.items.map((i) => i.code)).toEqual(CATALOGUE.map((c) => c.code));
  });

  it("carries public fields only: no SAC, no GST rate, no internal notes", () => {
    const text = JSON.stringify(snap);
    for (const c of CATALOGUE) expect(text).not.toContain(c.sac === "" ? "∅" : `"${c.sac}"`);
    expect(text).not.toMatch(/"sac"|gstRate|internal|deliverables|assumptions|exclusions|reminder/i);
  });

  it("keeps default-line names and prices (care-plan tiers, S11 setup and monthly)", () => {
    const s16 = snap.items.find((i) => i.code === "S16");
    expect(s16?.defaultLines.map((l) => l.description)).toEqual(["Essential", "Growth", "Scale"]);
    expect(snap.items.find((i) => i.code === "S11")?.defaultLines).toHaveLength(2);
  });

  it("publishes the payment terms (the public subset)", () => {
    expect(snap.paymentTerms.buildSchedule.map((s) => s.pctBp)).toEqual([4_000, 3_000, 3_000]);
    expect(Object.keys(snap.paymentTerms).sort()).toEqual([
      "buildSchedule",
      "dueDays",
      "proposalValidityDays",
      "smallJobThreshold",
    ]);
  });
});

describe("loadSnapshot", () => {
  it("falls back to the seed when there is no file", () => {
    expect(loadSnapshot(join(dir, "missing.json"))).toEqual(snapshotFromSeed());
  });

  it("prefers a valid file over the seed", () => {
    const edited = structuredClone(snapshotFromSeed());
    const s1 = edited.items.find((i) => i.code === "S1");
    if (!s1) throw new Error("S1");
    s1.priceInrMinor = 45_000_00;
    const loaded = loadSnapshot(write("valid.json", JSON.stringify(edited)));
    expect(loaded.items.find((i) => i.code === "S1")?.priceInrMinor).toBe(45_000_00);
  });

  it("fails on an invalid file instead of falling back (schema)", () => {
    const bad = { ...snapshotFromSeed(), items: [{ ...snapshotFromSeed().items[0], sac: "998313" }] };
    const file = write("internal.json", JSON.stringify(bad));
    expect(() => loadSnapshot(file)).toThrow(/not a valid catalogue snapshot/);
  });

  it("fails on malformed JSON and on a wrong version", () => {
    expect(() => loadSnapshot(write("broken.json", "{ nope"))).toThrow(/not valid JSON/);
    expect(() =>
      loadSnapshot(write("v2.json", JSON.stringify({ ...snapshotFromSeed(), version: 2 }))),
    ).toThrow(/version/);
  });

  it("does not echo values in its error", () => {
    const bad = { ...snapshotFromSeed(), secretPersonalData: "asha@example.com" };
    expect(() => loadSnapshot(write("leak.json", JSON.stringify(bad)))).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("asha@example.com") }),
    );
  });
});

describe("priceOf and scheduleOf for every on-site code", () => {
  it.each(onSite)("%s has a price (or priced lines) and a schedule text", (code) => {
    const e = CATALOGUE.find((c) => c.code === code);
    expect(scheduleOf(code)).toMatch(/\S/);
    if (e?.priceInr !== null) expect(priceOf(code).inr.amount).toBe(e?.priceInr);
  });

  it("words the schedules from the steps", () => {
    expect(scheduleOf("S5")).toBe("40 % on acceptance, 30 % at the midpoint milestone, 30 % on delivery");
    expect(scheduleOf("S1")).toBe("Paid in full upfront");
    expect(scheduleOf("S4")).toBe("Monthly in advance");
  });

  it("fails the build for an unknown or hidden code", () => {
    expect(() => scheduleOf("S99")).toThrow(/no catalogue entry/);
    expect(() => scheduleOf("S3")).toThrow(/hidden/);
  });

  it("prints whole-unit amounts through core's formatter", () => {
    expect(displayAmount(priceOf("S1").inr)).toBe("₹40,000");
    expect(displayAmount(priceOf("S1").usd ?? priceOf("S1").inr)).toBe("$2,000");
  });
});

describe("S3_DPDP_PAGE flag (WEB-G-17)", () => {
  it("is off, and S3 is then not on the site while every other entry is", () => {
    expect(flags.S3_DPDP_PAGE).toBe(false);
    expect(isServiceOnSite("S3")).toBe(false);
    expect(onSite).not.toContain("S3");
    for (const code of onSite) expect(isServiceOnSite(code)).toBe(true);
    expect(isServiceOnSite("S99")).toBe(false);
  });
});

describe("token renderer", () => {
  it("splits text and price parts, with 'from' once", () => {
    const parts = parseTokens("Care from {{price:S16-essential}} a month, or {{price:S1}}.");
    expect(parts.map((p) => p.kind)).toEqual(["text", "price", "text", "price", "text"]);
    expect(parts[1]).toMatchObject({ ref: "S16-essential", plain: false, from: false });
    expect(parts[3]).toMatchObject({ ref: "S1", from: true });
  });

  it("renders plain text in INR", () => {
    expect(renderPlain("Pilot from {{price-plain:S9}}.")).toBe("Pilot from ₹2,00,000.");
    expect(renderPlain("Care from {{price:S16-essential}} a month.")).toBe("Care from ₹9,999 + GST a month.");
    expect(renderPlain("Sprint {{price:S1}}.")).toBe("Sprint from ₹40,000 + GST.");
    expect(renderPlain("No tokens.")).toBe("No tokens.");
  });

  it("knows whether a string has tokens", () => {
    expect(hasTokens("a {{price:S1}} b")).toBe(true);
    expect(hasTokens("plain")).toBe(false);
  });

  it("fails the build on an unknown token, a bad reference, an unknown code or a hidden service", () => {
    expect(() => parseTokens("{{prise:S1}}")).toThrow(/Unknown content token/);
    expect(() => parseTokens("{{price:}}")).toThrow(/Unknown content token/);
    expect(() => parseTokens("{{price:five}}")).toThrow(/Unknown content token/);
    expect(() => parseTokens("{{price:S99}}")).toThrow(/no catalogue entry/);
    expect(() => parseTokens("{{price:S3}}")).toThrow(/hidden/);
    expect(() => parseTokens("{{price:S16-platinum}}")).toThrow(/no priced line/);
  });
});
