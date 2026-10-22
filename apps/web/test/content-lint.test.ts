// The content lint (scripts/web-content-lint.mjs): banned phrases of docs/07 §1.3 and one h1 per page [WEB-G-14].
// Each rule must FAIL on bad input; the real source content must pass.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as lint from "../../../scripts/web-content-lint.mjs";

const ids = (text: string): string[] => lint.findBanned(text).map((f: { id: string }) => f.id);

describe("banned phrases (07 §1.3)", () => {
  it.each([
    ["Delivered with 100% accuracy", "100%"],
    ["Delivered with 100 % accuracy", "100%"],
    ["We guarantee results", "guarantee"],
    ["Guaranteed delivery", "guarantee"],
    ["Guaranteeing results", "guarantee"],
    ["Delivered with 100 per cent accuracy", "100%"],
    ["Delivered with 100percent accuracy", "100%"],
    ["100 Percent uptime", "100%"],
    ["There will be no hallucinations", "no hallucinations"],
    ["Zero errors in production", "zero errors"],
    ["Zero manual work", "zero manual"],
    ["An ironclad process", "ironclad"],
    ["Bulletproof code", "bulletproof"],
    ["Military-grade security", "military-grade"],
    ["Status: LIVE", "LIVE"],
    ["Real-time dashboards", "real-time"],
    ["real time sync", "real-time"],
    ["Trusted by teams", "trusted by"],
    ["Industry-leading studio", "industry-leading"],
    ["The #1 studio", "#1"],
    ["Best-in-class tooling", "best-in-class"],
    ["A world-class team", "world-class"],
    ["Fully compliant with DPDP", "fully compliant"],
    ["We are certified", "certified"],
    ["Next-gen AI", "next-gen"],
    ["A revolutionary tool", "revolutionary"],
    ["Cutting-edge models", "cutting-edge"],
    ["Limited slots left", "limited slots"],
    ["Act now", "act now"],
  ])("flags %j", (text, id) => {
    expect(ids(text)).toContain(id);
  });

  it("is case-insensitive, except LIVE (the badge), so the ordinary word 'live' passes", () => {
    expect(ids("REVOLUTIONARY")).toContain("revolutionary");
    expect(ids("Go live on Monday; live sites; delivered")).toEqual([]);
  });

  it("is word-bounded: it does not flag longer words or similar text", () => {
    expect(
      ids("uncertified? decertified, realtimer, preguarantee, ironclads, #10, #1a2b3c, 3100%, 1100 %"),
    ).toEqual([]);
    expect(ids("100 percentage points, 1000 per centre")).toEqual([]);
    expect(ids("We offer a 30-day warranty; a discovery report.")).toEqual([]);
  });

  it("reports the file, the phrase and a little context", () => {
    const [p] = lint.checkBanned("src/content/x.ts", "We guarantee it.");
    expect(p).toContain("src/content/x.ts");
    expect(p).toContain("guarantee");
    expect(p).toContain("We guarantee it.");
  });

  it("lets an allow-listed (file, phrase) pass, and only that pair", () => {
    const allow = [{ file: "src/content/x.ts", phrase: "guarantee" }];
    expect(lint.checkBanned("src/content/x.ts", "the guarantee clause", allow)).toEqual([]);
    expect(lint.checkBanned("src/content/y.ts", "the guarantee clause", allow)).toHaveLength(1);
    expect(lint.checkBanned("src/content/x.ts", "ironclad", allow)).toHaveLength(1);
  });
});

describe("allow-list file", () => {
  it("accepts entries with a reason", () => {
    const r = lint.parseAllowList({
      allow: [{ file: "a.ts", phrase: "guarantee", reason: "'warranty' as defined in the terms" }],
    });
    expect(r.problems).toEqual([]);
    expect(r.entries).toEqual([{ file: "a.ts", phrase: "guarantee" }]);
  });

  it("rejects entries without a reason, with an unknown phrase, without a file, or a wrong shape", () => {
    expect(lint.parseAllowList({ allow: [{ file: "a.ts", phrase: "guarantee" }] }).problems[0]).toMatch(
      /reason/,
    );
    expect(
      lint.parseAllowList({ allow: [{ file: "a.ts", phrase: "guarantee", reason: "x" }] }).problems,
    ).toHaveLength(1);
    expect(
      lint.parseAllowList({ allow: [{ file: "a.ts", phrase: "fine", reason: "long enough reason" }] })
        .problems[0],
    ).toMatch(/not a banned phrase/);
    expect(
      lint.parseAllowList({ allow: [{ phrase: "guarantee", reason: "long enough reason" }] }).problems[0],
    ).toMatch(/no "file"/);
    expect(lint.parseAllowList({}).problems).toHaveLength(1);
    expect(lint.parseAllowList(null).problems).toHaveLength(1);
  });
});

describe("built HTML", () => {
  const page = (body: string, head = "") =>
    `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

  it("flags a phrase in the visible text and in shown attributes, not in scripts, styles or URLs", () => {
    expect(lint.checkBannedHtml("a.html", page("<h1>Hi</h1><p>We guarantee it</p>"))).toHaveLength(1);
    expect(
      lint.checkBannedHtml(
        "a.html",
        page("<h1>Hi</h1>", '<meta name="description" content="Cutting-edge AI">'),
      ),
    ).toHaveLength(1);
    expect(lint.checkBannedHtml("a.html", page('<img alt="Revolutionary" src="/x.png">'))).toHaveLength(1);
    expect(
      lint.checkBannedHtml(
        "a.html",
        page(
          '<script>const a = "guarantee"</script><style>.x::after{content:"LIVE"}</style><a href="/guarantee">Terms</a><!-- ironclad -->',
        ),
      ),
    ).toEqual([]);
  });

  it("does not skip an attribute that merely STARTS like a URL, path or fragment (review finding 3)", () => {
    const meta = (c: string) => page("<h1>Hi</h1>", `<meta name="description" content="${c}">`);
    expect(lint.checkBannedHtml("a.html", meta("#1 studio in India"))).toHaveLength(1);
    expect(lint.checkBannedHtml("a.html", meta("/ guaranteed results"))).toHaveLength(1);
    expect(
      lint.checkBannedHtml("a.html", meta("https://example.com and a 100 per cent promise")),
    ).toHaveLength(1);
    expect(
      lint.checkBannedHtml("a.html", page('<img alt="Guaranteeing quality" src="/x.png">')),
    ).toHaveLength(1);
    // whole values that are only a URL, path or fragment are still skipped
    for (const url of ["https://example.com/ironclad", "/guaranteed", "#ironclad"])
      expect(lint.checkBannedHtml("a.html", meta(url))).toEqual([]);
  });

  it("honours the allow-list for a built page", () => {
    const html = page("<h1>Hi</h1><p>guarantee</p>");
    expect(lint.checkBannedHtml("terms.html", html, [{ file: "terms.html", phrase: "guarantee" }])).toEqual(
      [],
    );
  });

  it("requires exactly one h1", () => {
    expect(lint.checkOneH1("a.html", page("<h1>One</h1>"))).toEqual([]);
    expect(lint.checkOneH1("a.html", page("<h1 class='x'>One</h1>"))).toEqual([]);
    expect(lint.checkOneH1("a.html", page("<h2>None</h2>"))[0]).toContain("0 <h1>");
    expect(lint.checkOneH1("a.html", page("<h1>One</h1><h1>Two</h1>"))[0]).toContain("2 <h1>");
    expect(lint.checkOneH1("a.html", page("<h1>One</h1><script>'<h1>'</script><!-- <h1> -->"))).toEqual([]);
  });

  it("lintBuiltPage combines both rules", () => {
    expect(lint.lintBuiltPage("a.html", page("<p>ironclad</p>"), [])).toHaveLength(2);
    expect(lint.lintBuiltPage("a.html", page("<h1>Fine</h1>"), [])).toEqual([]);
  });
});

describe("source content", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });
  const web = (files: Record<string, string>, allow?: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), "ta-lint-"));
    roots.push(dir);
    mkdirSync(join(dir, "src", "content"), { recursive: true });
    for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, "src", "content", f), text);
    if (allow !== undefined) writeFileSync(join(dir, "content-lint-allow.json"), JSON.stringify(allow));
    return dir;
  };

  it("fails on a banned phrase in a content file", () => {
    const problems = lint.lintSource(web({ "home.ts": 'export const t = "Bulletproof apps";' }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("src/content/home.ts");
  });

  it("passes with an allow-list entry that has a reason, and fails on one without", () => {
    const files = { "terms.md": "This is a guarantee clause." };
    const ok = web(files, {
      allow: [
        { file: "src/content/terms.md", phrase: "guarantee", reason: "quotes the clause of the terms" },
      ],
    });
    expect(lint.lintSource(ok)).toEqual([]);
    const bad = web(files, { allow: [{ file: "src/content/terms.md", phrase: "guarantee" }] });
    expect(lint.lintSource(bad).length).toBeGreaterThan(0);
  });

  it("passes the real content of the site", () => {
    const webDir = fileURLToPath(new URL("..", import.meta.url));
    expect(lint.lintSource(webDir)).toEqual([]);
  });
});
