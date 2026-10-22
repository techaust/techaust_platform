// M2.3 data and machine files: the blog and case-study schemas, RSS, security.txt, legal version data and the
// {{terms:…}} / {{postal_address}} / {{effective_date}} tokens (WEB-BLOG, WEB-WORK, WEB-LEGAL, WEB-SEC, WEB-G-11).
// Runs in Node.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as c from "../../../scripts/web-dist-checks.mjs";
import { blogSchema, headings, published, readingTime } from "../src/lib/blog";
import { snapshot } from "../src/lib/catalogue";
import { formatLegalDate, LEGAL_SLUGS, validateLegal, versionLine } from "../src/lib/legal";
import { buildRss, buildSecurityTxt } from "../src/lib/machine-files";
import { POSTAL_ADDRESS_PLACEHOLDER, parseTokens, renderPlain } from "../src/lib/tokens";
import { caseStudySchema, publishedCases } from "../src/lib/work";
import { fixturePost } from "./fixtures/blog-post";

const codes = snapshot().items.map((i) => i.code);
const schema = blogSchema(codes);
const post = (over: Record<string, unknown> = {}) => schema.parse({ ...fixturePost.data, ...over });

describe("blog front-matter (WEB-BLOG)", () => {
  it("accepts the fixture and defaults draft to true", () => {
    expect(post().relatedServices).toEqual(["S1"]);
    const { draft: _d, ...noDraft } = fixturePost.data;
    expect(schema.parse(noDraft).draft).toBe(true);
  });

  it("rejects a related service that is not a catalogue code, and unknown keys", () => {
    expect(() => post({ relatedServices: ["S99"] })).toThrow(/catalogue code/);
    expect(() => post({ surprise: 1 })).toThrow();
    expect(() => post({ date: "not a date" })).toThrow();
  });

  it("excludes drafts and sorts newest first", () => {
    const mk = (id: string, date: string, draft: boolean) => ({ id, data: post({ date, draft }) });
    const list = published([
      mk("a", "2026-01-01", false),
      mk("b", "2026-03-01", false),
      mk("c", "2026-05-01", true),
    ]);
    expect(list.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("counts reading time as words / 200 rounded up, ignoring code fences", () => {
    expect(readingTime("word ".repeat(200))).toBe(1);
    expect(readingTime("word ".repeat(201))).toBe(2);
    expect(readingTime("")).toBe(1);
    expect(readingTime(`${"word ".repeat(10)}\n\`\`\`\n${"code ".repeat(500)}\n\`\`\``)).toBe(1);
  });

  it("lists h2 and h3 headings, skipping code fences", () => {
    expect(headings(fixturePost.body)).toEqual([
      { depth: 2, text: "First heading", slug: "first-heading" },
      { depth: 3, text: "Second level", slug: "second-level" },
    ]);
  });
});

describe("case studies (WEB-WORK)", () => {
  const study = {
    title: "T",
    industry: "Retail",
    size: "10",
    region: "WB",
    problem: "p",
    outcome: "o",
    stack: [],
  };
  it("defaults to a draft, unverified", () => {
    const s = caseStudySchema.parse(study);
    expect(s.draft).toBe(true);
    expect(s.verified).toBe(false);
  });
  it("fails the build for a published case study that is not verified", () => {
    expect(() => caseStudySchema.parse({ ...study, draft: false })).toThrow(/verified: true/);
    expect(() => caseStudySchema.parse({ ...study, draft: false, verified: false })).toThrow(/verified/);
    expect(caseStudySchema.parse({ ...study, draft: false, verified: true }).verified).toBe(true);
  });
  it("shows no draft", () => {
    expect(publishedCases([{ data: { draft: true } }, { data: { draft: false } }])).toHaveLength(1);
  });
});

/** A minimal well-formedness check (no XML package in the repo): balanced, properly nested elements, no stray "&" or "<". */
function wellFormed(xml: string): boolean {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
  const stack: string[] = [];
  let i = 0;
  while (i < body.length) {
    const lt = body.indexOf("<", i);
    const text = body.slice(i, lt === -1 ? undefined : lt);
    if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(text) || text.includes(">")) return false;
    if (lt === -1) break;
    const gt = body.indexOf(">", lt);
    if (gt === -1) return false;
    const tag = body.slice(lt + 1, gt);
    if (tag.startsWith("/")) {
      if (stack.pop() !== tag.slice(1).trim()) return false;
    } else if (!tag.endsWith("/")) {
      stack.push((tag.split(/\s/)[0] as string).trim());
    }
    i = gt + 1;
  }
  return stack.length === 0 && /^<[a-z]/.test(body);
}
const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
const elem = (xml: string, name: string) =>
  unescapeXml(new RegExp(String.raw`<${name}>([\s\S]*?)</${name}>`).exec(xml)?.[1] ?? "");

describe("RSS (valid XML, escaping, empty channel)", () => {
  const posts = [{ id: fixturePost.id, data: post() }];

  it("is valid RSS 2.0 with one item per published post", () => {
    const xml = buildRss(posts);
    expect(wellFormed(xml)).toBe(true);
    expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    expect(elem(xml, "language")).toBe("en-IN");
    expect(xml).toContain('<atom:link href="https://techaust.com/rss.xml" rel="self"');
    expect(xml.match(/<item>/g)).toHaveLength(1);
    expect(elem(xml, "link")).toBe("https://techaust.com/blog");
    expect(xml).toContain("<link>https://techaust.com/blog/fixture-post</link>");
    expect(xml).toContain('<guid isPermaLink="true">https://techaust.com/blog/fixture-post</guid>');
    expect(xml).toContain("<pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate>"); // RFC 822
  });

  it("escapes markup and ampersands in titles", () => {
    const xml = buildRss(posts);
    expect(xml).toContain("Fixture &lt;post&gt; &amp; &quot;quotes&quot;");
    expect(wellFormed(xml)).toBe(true);
    expect(elem(xml.slice(xml.indexOf("<item>")), "title")).toBe('Fixture <post> & "quotes"');
  });

  it("is a valid empty channel with no published posts", () => {
    const xml = buildRss([]);
    expect(wellFormed(xml)).toBe(true);
    expect(elem(xml, "title")).toBeTruthy();
    expect(xml).not.toContain("<item>");
  });

  it("the checker itself rejects broken XML", () => {
    expect(wellFormed("<a><b></a></b>")).toBe(false);
    expect(wellFormed("<a>Tom & Jerry</a>")).toBe(false);
    expect(wellFormed("<a>ok</a>")).toBe(true);
  });
});

describe("security.txt (WEB-SEC)", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();

  it("has the four required fields and passes with Expires a year out", () => {
    const text = buildSecurityTxt(days(365));
    expect(text).toContain("Contact: mailto:security@techaust.com");
    expect(text).toContain("Policy: https://techaust.com/security");
    expect(text).toContain("Canonical: https://techaust.com/.well-known/security.txt");
    expect(text).toContain("Preferred-Languages: en");
    expect(c.checkSecurityTxt(text, now)).toEqual([]);
  });

  it("fails when Expires is in the past, over 366 days away, or not a date", () => {
    expect(c.checkSecurityTxt(buildSecurityTxt(days(-1)), now).join()).toContain("in the past");
    expect(c.checkSecurityTxt(buildSecurityTxt(days(367)), now).join()).toContain("more than 366 days");
    expect(c.checkSecurityTxt(buildSecurityTxt(days(366)), now)).toEqual([]);
    expect(c.checkSecurityTxt(buildSecurityTxt("soon"), now).join()).toContain("not an ISO 8601");
  });

  it("fails when any required field is missing", () => {
    for (const field of ["Contact", "Expires", "Policy", "Canonical"]) {
      const text = buildSecurityTxt(days(100))
        .split("\n")
        .filter((l) => !l.startsWith(`${field}:`))
        .join("\n");
      expect(c.checkSecurityTxt(text, now).join()).toContain(`missing the ${field}`);
    }
  });
});

describe("legal page versioning (WEB-LEGAL)", () => {
  const ok = {
    version: "0.1",
    effective: "2026-10-22",
    changes: [{ version: "0.1", date: "2026-10-22", note: "n" }],
  };
  const all = Object.fromEntries(LEGAL_SLUGS.map((s) => [s, ok]));

  it("accepts a complete set and writes the version line", () => {
    const data = validateLegal(all);
    expect(versionLine(data.privacy)).toBe("Version 0.1 · Effective 22 October 2026");
    expect(formatLegalDate("2027-03-05")).toBe("5 March 2027");
  });

  it("fails the build when a page lacks its data, a field, or a change for the current version", () => {
    const { terms: _t, ...missing } = all;
    expect(() => validateLegal(missing)).toThrow(/terms: no version data/);
    expect(() => validateLegal({ ...all, privacy: { ...ok, effective: "22/10/2026" } })).toThrow(/privacy/);
    expect(() => validateLegal({ ...all, cookies: { ...ok, changes: [] } })).toThrow(/cookies/);
    expect(() => validateLegal({ ...all, cookies: { ...ok, version: "0.2" } })).toThrow(/no "changes" entry/);
    expect(() => validateLegal({ ...all, extra: ok })).toThrow(/not a legal page slug/);
  });

  it("checks a built page for the version line and a Changes section", () => {
    const good = "<h2>Changes</h2><p>Version 0.1 · Effective 22 October 2026</p>";
    expect(c.checkLegalPage("privacy.html", good)).toEqual([]);
    expect(c.checkLegalPage("privacy.html", "<h2>Changes</h2>").join()).toContain("Version x.y");
    expect(c.checkLegalPage("privacy.html", "Version 0.1 · Effective 22 October 2026").join()).toContain(
      "Changes",
    );
  });
});

describe("{{terms:…}}, {{postal_address}} and {{effective_date}} tokens", () => {
  it("renders the small-job threshold in both currencies, whole units, no GST", () => {
    const [p] = parseTokens("{{terms:small_job_threshold}}");
    if (p?.kind !== "price") throw new Error("expected a price part");
    expect(p.plain).toBe(true);
    expect(p.inr.amount).toBe(100_000_00);
    expect(p.usd?.amount).toBe(2_000_00);
    expect(renderPlain("Under {{terms:small_job_threshold}}.")).toBe("Under ₹1,00,000.");
  });

  it("fails the build on an unknown terms key", () => {
    expect(() => parseTokens("{{terms:nope}}")).toThrow(/Unknown content token \{\{terms:nope\}\}/);
    expect(() => parseTokens("{{terms:}}")).toThrow(/Unknown content token/);
  });

  it("shows a labelled placeholder while the postal address is empty", () => {
    expect(renderPlain("Write to {{postal_address}}.")).toBe(`Write to ${POSTAL_ADDRESS_PLACEHOLDER}.`);
    expect(POSTAL_ADDRESS_PLACEHOLDER).toMatch(/owner input pending/);
  });

  it("renders the effective date only where the page gives it", () => {
    expect(renderPlain("From {{effective_date}}.", { effectiveDate: "22 October 2026" })).toBe(
      "From 22 October 2026.",
    );
    expect(() => parseTokens("{{effective_date}}")).toThrow(/effective date/);
  });
});
