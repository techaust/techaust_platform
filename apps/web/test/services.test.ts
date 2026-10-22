// The service pages and the hub (M2.2): which services get a page, the hub lists each exactly once, every content
// string renders (tokens resolve, no "&"), FAQs within WEB-SVC-04 where shown, related links point at live pages,
// and every pricing section carries the catalogue's payment schedule (WEB-SVC-05).
import { describe, expect, it } from "vitest";
import { home } from "../src/content/home";
import { homeCards, liveServices, serviceContent, serviceLink } from "../src/content/services";
import { servicesHub } from "../src/content/services-hub";
import { SCHEDULE, type ServiceCode, type ServiceContent } from "../src/content/types";
import { snapshot } from "../src/lib/catalogue";
import { isServiceOnSite, scheduleOf } from "../src/lib/prices";
import { parseTokens } from "../src/lib/tokens";

const live = liveServices();

/** Every string in a content object (URLs included; callers filter). */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("service pages", () => {
  it("builds the 14 launch pages, and none for S3 while its flag is off", () => {
    expect(live.map((s) => s.code).sort()).toEqual(
      ["S1", "S2", "S4", "S5", "S6", "S7", "S9", "S10", "S11", "S12", "S13", "S14", "S16", "S18"].sort(),
    );
    expect(isServiceOnSite("S3")).toBe(false);
    expect(live.some((s) => s.slug === "dpdp-readiness")).toBe(false);
    expect(() => serviceContent("S3")).toThrow(/hidden/);
  });

  it("uses the catalogue's slug and name for every content file (no hand-copied slug)", () => {
    const items = snapshot().items;
    for (const s of live) {
      const c = items.find((i) => i.code === s.code);
      expect(c, s.code).toBeDefined();
      expect(s.slug, `${s.code} slug`).toBe(c?.slug);
    }
  });

  it("links and prices every home 'What we do' card from its service page", () => {
    const cards = homeCards();
    expect(cards).toHaveLength(6);
    for (const c of cards) {
      const code = home.services.cards.find((h) => h.title === c.title)?.price;
      expect(code, c.title).toBeDefined();
      expect(c.href).toBe(`/services/${serviceContent(code as ServiceCode).slug}`);
      expect(c.unit).toBe(serviceContent(code as ServiceCode).hero.price.unit);
      expect(c.text).toBe(home.services.cards.find((h) => h.price === code)?.text);
    }
  });

  it("gives every page a unique slug", () => {
    expect(new Set(live.map((s) => s.slug)).size).toBe(live.length);
  });

  it.each(live.map((s) => [s.code, s] as [string, ServiceContent]))("%s: every token renders", (_, s) => {
    for (const text of strings(s)) expect(() => parseTokens(text)).not.toThrow();
  });

  it.each(live.map((s) => [s.code, s] as [string, ServiceContent]))("%s: 'and', never '&'", (_, s) => {
    const text = strings(s).filter((t) => !t.startsWith("/"));
    expect(text.join("\n")).not.toMatch(/&/);
  });

  it.each(live.map((s) => [s.code, s] as [string, ServiceContent]))(
    "%s: pricing shows the schedule",
    (_, s) => {
      if (s.plans) {
        expect(scheduleOf(s.code)).toBe("Monthly in advance");
        return;
      }
      expect(s.pricing?.lines).toContain(SCHEDULE);
    },
  );

  it("shows FAQs only within WEB-SVC-04 (4–8); S1 and S9 have them", () => {
    for (const s of live) expect((s.faqs ?? []).length).toBeLessThanOrEqual(8);
    expect(serviceContent("S1").faqs).toHaveLength(4);
    expect(serviceContent("S9").faqs).toHaveLength(4);
  });

  it("links related services that are live, three per page, never itself", () => {
    for (const s of live) {
      expect(s.related).toHaveLength(3);
      for (const code of s.related ?? []) {
        expect(code).not.toBe(s.code);
        expect(() => serviceLink(code)).not.toThrow();
      }
    }
  });
});

describe("services hub", () => {
  const listed = servicesHub.groups.flatMap((g) => g.codes.filter((c) => isServiceOnSite(c)));

  it("lists every live service exactly once (WEB-SVCHUB)", () => {
    expect([...listed].sort()).toEqual(live.map((s) => s.code).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("hides S3 while its flag is off", () => {
    expect(listed).not.toContain("S3");
  });

  it("links each item to its page with a one-liner and a price", () => {
    for (const code of listed) {
      const l = serviceLink(code);
      expect(l.href).toBe(`/services/${serviceContent(code).slug}`);
      expect(l.text.length).toBeGreaterThan(0);
      expect(() => parseTokens(l.text)).not.toThrow();
    }
  });
});
