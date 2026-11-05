// The rules an email keeps so it reads the same in real mail clients (docs/06 §6; M7.2 run file I "Templates"): no script, form, iframe, external stylesheet
// or web-font dependency; every table a layout table; every image with alt text and a width; a language; at most 600 px wide; no text under 12 px; the
// button's address repeated in the text twin; and a size well under Gmail's clipping point (about 102 KB of HTML, a figure Gmail doesn't publish: here
// 100 KB). Returns the problems found, none for a good email.
const MAX_BYTES = 100_000;

export function emailClientProblems(html: string, text: string): string[] {
  const out: string[] = [];
  if (/<script\b/i.test(html)) out.push("script");
  if (/<form\b/i.test(html)) out.push("form");
  if (/<iframe\b/i.test(html)) out.push("iframe");
  if (/<link\b[^>]*rel=["']?stylesheet/i.test(html)) out.push("external stylesheet");
  if (/@import\b|@font-face\b|fonts\.googleapis/i.test(html)) out.push("web font");
  if (!/<html\b[^>]*\blang="[a-z]{2}(-[A-Z]{2})?"/.test(html)) out.push("no lang");
  for (const t of html.match(/<table\b[^>]*>/g) ?? [])
    if (!t.includes('role="presentation"')) out.push(`table without role="presentation": ${t.slice(0, 60)}`);
  for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
    if (!/\balt="[^"]+"/.test(img)) out.push("img without alt");
    if (!/\bwidth="\d+"/.test(img)) out.push("img without width");
  }
  for (const m of html.matchAll(/max-width:(\d+)px/g))
    if (Number(m[1]) > 600) out.push(`wider than 600 px: ${m[1]}`);
  for (const m of html.matchAll(/font-size:(\d+)px/g))
    if (Number(m[1]) < 12) out.push(`text under 12 px: ${m[1]}`);
  // Every button's address (the VML and the link) is repeated in the plain text.
  for (const m of html.matchAll(/<a href="([^"]+)" class="bt"/g)) {
    const url = (m[1] ?? "").replaceAll("&amp;", "&");
    if (!text.includes(url)) out.push(`button URL not in the text: ${url}`);
  }
  if (!/<h1\b/.test(html)) out.push("no heading");
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > MAX_BYTES) out.push(`HTML over ${MAX_BYTES} bytes: ${bytes}`);
  if (!text.trim()) out.push("no plain text");
  return out;
}
