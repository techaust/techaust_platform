// The M2.4 form pages (designer): their copy renders, the budget bands are money from @techaust/core (never typed),
// the country list and call windows are sound, the Turnstile site key comes from wrangler.jsonc per environment, and the
// built pages carry the builder's field contract (FORM_FIELDS) and the spam-protection pieces.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BUDGET_BANDS, FORM_FIELDS, formatMoney, formMeta, money, serviceCode } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { contactPage, formUi, noJsNote, quotePage, thanksPage } from "../src/content/forms";
import {
  BAND_BOUNDS,
  budgetBands,
  CALL_WINDOWS,
  callWindows,
  countries,
  noticeVersion,
  serviceGroups,
} from "../src/lib/forms";
import { isServiceOnSite } from "../src/lib/prices";
import { parseTokens } from "../src/lib/tokens";
import { parseJsonc, siteKeyOf } from "../src/lib/turnstile";
import { localWindow } from "../src/scripts/call-time";

const webDir = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("M2.4 form copy", () => {
  it("renders every string: tokens resolve, no '&', no arrows", () => {
    for (const text of strings([contactPage, quotePage, thanksPage, formUi, noJsNote])) {
      expect(() => parseTokens(text)).not.toThrow();
      expect(text).not.toMatch(/&|→/);
    }
  });

  it("keeps 07's words where 07 has them", () => {
    expect(contactPage.h1).toBe("Talk to us");
    expect(contactPage.submit).toBe("Send message");
    expect(quotePage.h1).toBe("Tell us about your project");
    expect(quotePage.submit).toBe("Send request");
    expect(thanksPage.h1).toBe("Thanks, we've got it.");
    expect(noJsNote).toBe(
      "This form needs JavaScript for spam protection. You can email contact@techaust.com instead.",
    );
  });
});

describe("budget bands (04 FRM-QUOTE): amounts formatted by @techaust/core", () => {
  it("labels every band of the shared schema, in its order, Not sure last", () => {
    for (const cur of ["INR", "USD"] as const) {
      const bands = budgetBands(cur);
      expect(bands.map((b) => b.value)).toEqual([...BUDGET_BANDS[cur]]);
      expect(bands.at(-1)?.label).toBe("Not sure");
    }
  });

  it("writes the amounts with the currency formatting (lakh grouping for INR)", () => {
    const f = (n: number, c: "INR" | "USD") => formatMoney(money(n, c), { wholeUnits: true });
    const inr = budgetBands("INR").map((b) => b.label);
    expect(inr[0]).toBe(`Under ${f(10_000_000, "INR")}`);
    expect(inr[1]).toBe(`${f(10_000_000, "INR")} to ${f(30_000_000, "INR")}`);
    expect(inr[4]).toBe(`${f(150_000_000, "INR")} or more`);
    expect(inr[1]).toContain("1,00,000");
    const usd = budgetBands("USD").map((b) => b.label);
    expect(usd[2]).toBe(`${f(500_000, "USD")} to ${f(1_500_000, "USD")}`);
    expect(usd[2]).toContain("5,000");
  });

  it("bands touch end to end, with no gap or overlap", () => {
    for (const cur of ["INR", "USD"] as const) {
      const bounds = Object.values(BAND_BOUNDS[cur]);
      for (let i = 1; i < bounds.length; i++) expect(bounds[i]?.[0]).toBe(bounds[i - 1]?.[1]);
    }
  });
});

describe("countries and call windows", () => {
  it("lists the 249 ISO countries by name, India among them, 'and' never '&'", () => {
    const list = countries();
    expect(list).toHaveLength(249);
    expect(new Set(list.map((c) => c.code)).size).toBe(249);
    expect(list.find((c) => c.code === "IN")?.name).toBe("India");
    for (const c of list) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.name).not.toContain("&");
    }
  });

  it("call windows sit inside the published hours (10:00–19:00 IST) and fit the schema's 60 characters", () => {
    for (const w of CALL_WINDOWS) {
      expect(w.from).toBeGreaterThanOrEqual(600);
      expect(w.to).toBeLessThanOrEqual(1140);
    }
    expect(callWindows().map((w) => w.value)).toEqual([
      "10:00–13:00 IST",
      "13:00–16:00 IST",
      "16:00–19:00 IST",
      formUi.anyTime,
    ]);
    for (const w of callWindows()) expect(w.value.length).toBeLessThanOrEqual(60);
  });

  it("shows the visitor's own clock beside an IST window, and nothing on IST", () => {
    const utc = (d: Date) =>
      `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    const winter = new Date(Date.UTC(2026, 0, 15, 12));
    // A clock on UTC (London in winter): 10:00 IST is 04:30.
    expect(localWindow(600, 780, winter, 0, utc)).toBe("04:30–07:30");
    expect(localWindow(600, 780, winter, 330, utc)).toBeNull();
    // New York in winter (UTC-5), formatted in its own zone.
    const ny = (d: Date) => utc(new Date(d.getTime() - 5 * 3_600_000));
    expect(localWindow(960, 1140, winter, -300, ny)).toBe("05:30–08:30");
  });
});

describe("the service picker and consent", () => {
  it("offers only services on the site, each a valid schema value", () => {
    const codes = serviceGroups().flatMap((g) => g.services.map((s) => s.code));
    expect(codes.length).toBeGreaterThan(10);
    for (const c of codes) {
      expect(isServiceOnSite(c)).toBe(true);
      expect(serviceCode.safeParse(c).success).toBe(true);
    }
    expect(serviceCode.safeParse("not-sure").success).toBe(true);
  });

  it("sends the privacy notice's version as the consent notice version (FRM-05)", () => {
    expect(formMeta.shape.noticeVersion.safeParse(noticeVersion).success).toBe(true);
  });
});

describe("the Turnstile site key (lib/turnstile.ts)", () => {
  const config = parseJsonc(readFileSync(`${webDir}/wrangler.jsonc`, "utf8")) as Parameters<
    typeof siteKeyOf
  >[0];

  it("local builds use Cloudflare's always-pass test key; staging builds the staging widget's key", () => {
    expect(siteKeyOf(config)).toBe("1x00000000000000000000AA");
    expect(siteKeyOf(config, "staging")).toMatch(/^0x[0-9A-Za-z_-]+$/);
  });

  it("fails a staging build without a key, and an unknown environment", () => {
    expect(() => siteKeyOf({ env: { staging: { vars: {} } } }, "staging")).toThrow(/no TURNSTILE_SITE_KEY/);
    expect(() => siteKeyOf(config, "nope")).toThrow(/not an environment/);
  });
});

const built = existsSync(`${webDir}/dist/get-a-quote.html`);

describe.skipIf(!built)("the built form pages (skipped until apps/web/dist exists)", () => {
  const page = (name: string) => readFileSync(`${webDir}/dist/${name}.html`, "utf8");

  it("post to the builder's endpoints with its field names and the spam-protection pieces", () => {
    for (const [name, action] of [
      ["contact", "contact"],
      ["get-a-quote", "quote"],
    ] as const) {
      const html = page(name);
      expect(html).toContain(`action="/api/forms/${action}"`);
      expect(html).toMatch(
        new RegExp(`name="${FORM_FIELDS.honeypot}"[^>]*tabindex="-1"[^>]*autocomplete="off"`),
      );
      expect(html).toMatch(/class="hp" aria-hidden="true"/);
      expect(html).toContain(`name="${FORM_FIELDS.elapsed}"`);
      expect(html).toContain(`data-action="${action}"`);
      expect(html).toContain('data-sitekey="');
      expect(html).toContain('name="noticeVersion"');
      expect(html).not.toMatch(/name="marketing"[^>]*checked/);
      expect(html).toContain(noJsNote);
    }
  });

  it("the quote form has four steps; thanks is noindex and links How we work and Pricing", () => {
    expect(page("get-a-quote").match(/data-qstep="/g)).toHaveLength(4);
    const thanks = page("thanks");
    expect(thanks).toContain('content="noindex, nofollow"');
    expect(thanks).toContain('href="/how-we-work"');
    expect(thanks).toContain('href="/pricing"');
  });

  it("publishes the email logos at /brand/ for the emails (docs/06 §6)", () => {
    for (const f of ["logo-email-badge@2x.png", "logo-email-dark@2x.png"])
      expect(existsSync(`${webDir}/dist/brand/${f}`)).toBe(true);
  });
});
