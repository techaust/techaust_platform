// The M2.4 form pages (designer): their copy renders, the budget bands are money from @techaust/core (never typed),
// the country list and call windows are sound, the Turnstile site key comes from wrangler.jsonc per environment, and the
// built pages carry the builder's field contract (FORM_FIELDS) and the spam-protection pieces.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BUDGET_BANDS,
  callWindowText,
  FORM_FIELDS,
  formatMoney,
  formMeta,
  money,
  serviceCode,
} from "@techaust/core";
import { describe, expect, it } from "vitest";
import { HOURS, site } from "../src/config/site";
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
import { gmtName, istText, istWindow, localText, localWindow, textRuns } from "../src/scripts/call-time";

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
    expect(thanksPage.h1).toBe("Thanks, we’ve got it.");
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
});

// Times in the visitor's own clock, one time only (owner, 2026-11-01; docs/07 §1 "Times"; run file company-phone).
describe("hours and call windows in the visitor's own clock", () => {
  const winter = new Date(Date.UTC(2026, 0, 15, 12)); // Thursday 15 January 2026
  const summer = new Date(Date.UTC(2026, 6, 15, 12)); // Wednesday 15 July 2026
  const hours = (now: Date, timeZone: string, locale?: string) => {
    const l = localWindow(HOURS, now, { timeZone, ...(locale ? { locale } : {}) });
    return l && localText(l);
  };

  it("writes the IST text the server shows, from the one source in site.ts", () => {
    expect(istText(HOURS)).toBe("Mon–Sat, 10:00–19:00 IST");
    expect(site.hours).toBe("Mon–Sat, 10:00–19:00 IST");
    for (const w of CALL_WINDOWS) expect(istText(w)).toBe(callWindowText(w));
    expect(textRuns(istWindow(HOURS))).toEqual(["Mon–Sat,", "10:00–19:00", "IST"]);
  });

  it("changes nothing for a clock on IST", () => {
    expect(localWindow(HOURS, winter, { timeZone: "Asia/Kolkata" })).toBeNull();
    expect(localWindow(HOURS, summer, { timeZone: "Asia/Calcutta" })).toBeNull();
    expect(localWindow(CALL_WINDOWS[0], winter, { timeZone: "Asia/Kolkata" })).toBeNull();
  });

  it("shows London in winter and in summer, with the zone's short name and no IST", () => {
    expect(hours(winter, "Europe/London")).toBe("Mon–Sat, 04:30–13:30 GMT");
    expect(hours(summer, "Europe/London", "en-GB")).toBe("Mon–Sat, 05:30–14:30 BST");
    // Where the locale has no name for the zone, Intl's own "GMT+1" form.
    expect(hours(summer, "Europe/London")).toBe("Mon–Sat, 05:30–14:30 GMT+1");
  });

  it("moves the weekdays with the start and adds “next day” when the window crosses local midnight (USA)", () => {
    expect(hours(winter, "America/New_York")).toBe("Sun–Fri, 23:30–08:30 next day EST");
    expect(hours(summer, "America/New_York")).toBe("Mon–Sat, 00:30–09:30 EDT");
    expect(hours(winter, "America/Los_Angeles")).toBe("Sun–Fri, 20:30–05:30 next day PST");
    expect(hours(summer, "America/Los_Angeles")).toBe("Sun–Fri, 21:30–06:30 next day PDT");
  });

  it("handles half-hour and 45-minute zones", () => {
    expect(hours(winter, "Asia/Kathmandu")).toBe("Mon–Sat, 10:15–19:15 GMT+5:45");
    expect(hours(winter, "America/St_Johns")).toBe("Mon–Sat, 01:00–10:00 GMT-3:30");
    // Adelaide in its summer (UTC+10:30): the window ends exactly at local midnight.
    expect(hours(winter, "Australia/Adelaide")).toBe("Mon–Sat, 15:00–00:00 next day GMT+10:30");
  });

  it("handles zones east of IST, where the window runs late or past midnight", () => {
    expect(hours(winter, "Asia/Tokyo")).toBe("Mon–Sat, 13:30–22:30 GMT+9");
    expect(hours(winter, "Australia/Sydney")).toBe("Mon–Sat, 15:30–00:30 next day GMT+11");
    expect(hours(summer, "Australia/Sydney")).toBe("Mon–Sat, 14:30–23:30 GMT+10");
    expect(hours(winter, "Pacific/Kiritimati")).toBe("Mon–Sat, 18:30–03:30 next day GMT+14");
  });

  it("uses the IST day of `now`, even when the visitor's own date is still the day before", () => {
    // 00:30 IST on Friday 16 January is 11:00 on Thursday in New York: the window is Friday's in India.
    const lateUtc = new Date(Date.UTC(2026, 0, 15, 19));
    expect(hours(lateUtc, "America/New_York")).toBe("Sun–Fri, 23:30–08:30 next day EST");
  });

  it("falls back to the GMT offset when the runtime gives no zone name", () => {
    const none = { timeZone: "America/Los_Angeles", zoneName: () => undefined };
    const l = localWindow(HOURS, winter, none);
    expect(l && localText(l)).toBe("Sun–Fri, 20:30–05:30 next day GMT-8");
    const blank = localWindow(HOURS, winter, { timeZone: "Europe/London", zoneName: () => " " });
    expect(blank?.zone).toBe("GMT");
    // Chromium's "GMT+0" for London in winter is written "GMT", as Node and Firefox write it.
    const chromium = localWindow(HOURS, winter, { timeZone: "Europe/London", zoneName: () => "GMT+0" });
    expect(chromium?.zone).toBe("GMT");
    expect([0, 60, -210, 345, -480].map(gmtName)).toEqual(["GMT", "GMT+1", "GMT-3:30", "GMT+5:45", "GMT-8"]);
  });

  it("shows the call windows in local time only, without weekdays, while the value stays IST", () => {
    const [morning, midday] = CALL_WINDOWS;
    const london = localWindow(morning, winter, { timeZone: "Europe/London" });
    expect(london && localText(london)).toBe("04:30–07:30 GMT");
    const la = localWindow(midday, winter, { timeZone: "America/Los_Angeles" });
    expect(la && localText(la)).toBe("23:30–02:30 next day PST");
    expect(la && textRuns(la)).toEqual(["23:30–02:30", "next day PST"]);
    expect(callWindows()[0]?.value).toBe("10:00–13:00 IST");
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
