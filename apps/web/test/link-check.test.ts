// The dist link checker and the pre-production readiness check (scripts/web-link-check.mjs,
// scripts/check-prod-readiness.mjs). Each must fail on bad input. Runs in Node.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as r from "../../../scripts/check-prod-readiness.mjs";
// @ts-expect-error plain .mjs without types
import * as l from "../../../scripts/web-link-check.mjs";

const html = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;
const site = (pages: Record<string, string>, extra: string[] = []) =>
  new Map<string, string>([...Object.entries(pages), ...extra.map((n) => [n, ""] as [string, string])]);

describe("link checker", () => {
  const pages = {
    "index.html":
      html(`<a href="/about">a</a><a href="/about#team">t</a><a href="#top-of-page" >x</a><h1 id="top-of-page">h</h1>
      <img src="/_astro/a.png"><a href="mailto:a@b.c">m</a><a href="https://example.com/x">e</a><a href="/api/healthz">api</a>`),
    "about.html": html(`<h2 id="team">Team</h2><a href="/">home</a><a href="/services/s1">s</a>`),
    "services/s1.html": html(`<a href="../about#team">rel</a><a href="/.well-known/security.txt">sec</a>`),
  };
  const files = site(pages, ["_astro/a.png", ".well-known/security.txt"]);

  it("passes a site whose links, srcs and fragments all resolve (external, mailto and /api/ are skipped)", () => {
    expect(l.checkLinksIn(files)).toEqual([]);
  });

  it("fails on a broken internal link and a broken src", () => {
    const bad = site({ ...pages, "x.html": html(`<a href="/nope">n</a><img src="/missing.png">`) }, [
      "_astro/a.png",
      ".well-known/security.txt",
    ]);
    const out = l.checkLinksIn(bad).join("\n");
    expect(out).toContain('x.html: href="/nope" does not resolve');
    expect(out).toContain('x.html: src="/missing.png" does not resolve');
  });

  it("counts name= only on an <a>, and decodes percent-escapes in a fragment", () => {
    expect([...l.idsOf(html(`<a name="old">x</a><input name="email"><h2 id="a b">h</h2>`))].sort()).toEqual([
      "a b",
      "old",
    ]);
    const ok = site({
      "index.html": html(`<a href="/p#caf%C3%A9">a</a><a href="/p#a%20b">b</a><a href="/p#old">c</a>`),
      "p.html": html(`<h2 id="café">c</h2><h2 id="a b">h</h2><a name="old">o</a>`),
    });
    expect(l.checkLinksIn(ok)).toEqual([]);
    const bad = site({
      "index.html": html(`<a href="/p#email">a</a>`),
      "p.html": html(`<input name="email">`),
    });
    expect(l.checkLinksIn(bad).join()).toContain('no id "email"');
  });

  it("fails on a broken fragment, on this page and on another", () => {
    const bad = site({
      "index.html": html(`<a href="#nowhere">a</a><a href="/about#ghost">b</a>`),
      "about.html": html(`<h2 id="team">T</h2>`),
    });
    const out = l.checkLinksIn(bad).join("\n");
    expect(out).toContain('no id "nowhere" on index.html');
    expect(out).toContain('no id "ghost" on about.html');
  });

  it("ignores links inside scripts and comments", () => {
    const f = site({
      "index.html": html(`<script>var s = '<a href="/nope">';</script><!-- <a href="/gone"> -->`),
    });
    expect(l.checkLinksIn(f)).toEqual([]);
  });

  it("allows listed routes (with a reason) and flags an entry that is no longer needed", () => {
    const allow = [{ path: "/contact", reason: "M2.4 builds it", milestone: "M2.4" }];
    const f = site({ "index.html": html(`<a href="/contact">c</a>`) });
    expect(l.checkLinksIn(f, allow)).toEqual([]);
    const built = site({ "index.html": html(`<a href="/contact">c</a>`), "contact.html": html("") });
    expect(l.checkLinksIn(built, allow).join()).toContain("now exists: remove the entry");
    const unlinked = site({ "index.html": html("") });
    expect(l.checkLinksIn(unlinked, allow).join()).toContain("not linked from any page");
  });

  it("requires a reason and a milestone on every allow-list entry", () => {
    expect(() => l.parseLinkAllowList({ allow: [{ path: "/contact", milestone: "M2.4" }] })).toThrow(
      /reason/,
    );
    expect(() => l.parseLinkAllowList({ allow: [{ path: "/contact", reason: "x" }] })).toThrow(/milestone/);
    expect(() => l.parseLinkAllowList({ allow: [{ path: "contact", reason: "x", milestone: "M" }] })).toThrow(
      /path/,
    );
    expect(l.parseLinkAllowList({ allow: [] })).toEqual([]);
  });
});

describe("pre-production readiness (never run by CI or staging)", () => {
  const filled = `postalAddress: "1 Road, Town",
    linkedinFounder: "https://linkedin.com/in/x",
    founderPhoto: "/brand/f.png",
    founderBio: "Bio.",
    aliasesConfirmed: true,`;

  it("passes when every owner input is filled and aliases are confirmed", () => {
    expect(r.checkSiteConfig(filled)).toEqual([]);
  });

  it("says what the owner must supply for each empty input", () => {
    const out =
      r.checkSiteConfig(`postalAddress: "" as string, linkedinFounder: "", founderPhoto: "", founderBio: "",
      aliasesConfirmed: false as boolean`);
    expect(out).toHaveLength(5);
    expect(out.join("\n")).toMatch(/postal address/);
    expect(out.join("\n")).toMatch(/LinkedIn/);
    expect(out.join("\n")).toMatch(/headshot/);
    expect(out.join("\n")).toMatch(/bio/);
    expect(out.join("\n")).toMatch(/aliases/);
    expect(
      r.checkSiteConfig(filled.replace("aliasesConfirmed: true", "aliasesConfirmed: false")),
    ).toHaveLength(1);
  });

  it("blocks production while the launch date is empty or a legal page's effective date differs", () => {
    const legalTs = `a: { effective: "2026-10-22" }, b: { effective: "2026-10-22" }`;
    expect(r.checkLaunchDate('launchDate: "" as string,', legalTs).join()).toMatch(/launch date is not set/);
    expect(r.checkLaunchDate('launchDate: "2026-11-01" as string,', legalTs).join()).toMatch(
      /2026-10-22 differ from site.launchDate 2026-11-01/,
    );
    expect(r.checkLaunchDate('launchDate: "2026-10-22",', legalTs)).toEqual([]);
    expect(r.checkLaunchDate('launchDate: "2026-10-22",', "nothing here").join()).toMatch(/No `effective`/);
  });

  it("fails on a built page that still has a Placeholder or the postal-address placeholder", () => {
    expect(r.checkBuiltPage("about.html", `<span class="placeholder__tag">Placeholder</span>`)).toHaveLength(
      1,
    );
    expect(r.checkBuiltPage("privacy.html", `<p>${r.POSTAL_PLACEHOLDER_TEXT}</p>`)).toHaveLength(1);
    expect(r.checkBuiltPage("index.html", "<p>clean</p>")).toEqual([]);
  });

  it("fails while X-Robots-Tag: noindex is set, and passes when removed or only commented", () => {
    expect(r.checkNoindex("/*\n  X-Robots-Tag: noindex\n")).toHaveLength(1);
    expect(r.checkNoindex("/*\n  Referrer-Policy: x\n")).toEqual([]);
    expect(r.checkNoindex("# X-Robots-Tag: noindex (removed)\n/*\n  A: b\n")).toEqual([]);
  });

  it("reads the real site.ts: blocked today (owner inputs pending)", () => {
    const text = r.readSiteString('a: 1,\n  founderBio: "x",', "founderBio");
    expect(text).toBe("x");
    // The real site.ts has no launch date yet, so the real check is blocked on it too.
    expect(r.readSiteString('launchDate: "" as string,', "launchDate")).toBe("");
    expect(r.readSiteBool("aliasesConfirmed: false as boolean", "aliasesConfirmed")).toBe(false);
  });
});
