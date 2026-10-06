// Renders tokens/tokens.json into the generated outputs (pure string functions; scripts/build-tokens.ts writes them).
import {
  tokens as defaultTokens,
  fontStack,
  rem,
  resolveColor,
  semanticColors,
  type Theme,
  type Tokens,
  textSize,
} from "./model.ts";

const HEADER = (what: string) =>
  `/* ${what}. Generated from packages/ui/tokens/tokens.json by \`pnpm --filter @techaust/ui build:tokens\`. Do not edit. */\n`;

const block = (selector: string, lines: string[], indent = "") =>
  `${indent}${selector} {\n${lines.map((l) => `${indent}  ${l}`).join("\n")}\n${indent}}\n`;

const decl = (name: string, value: string | number) => `--${name}: ${value};`;

function colorDecls(t: Tokens, theme: Theme, withPalette: boolean): string[] {
  const out: string[] = [];
  if (withPalette)
    for (const [k, v] of Object.entries(t.palette)) out.push(decl(`color-${k}`, resolveColor(v, t)));
  for (const [k, v] of Object.entries(semanticColors(theme, t))) out.push(decl(`color-${k}`, v));
  return out;
}

// Shadows go through --elevation-N because Tailwind inlines --shadow-* values into utilities;
// the indirection keeps them switchable per theme.
const elevationDecls = (t: Tokens, theme: Theme) =>
  Object.entries(t.shadow).map(([k, v]) => decl(`elevation-${k}`, v[theme]));
const shadowRefs = (t: Tokens) =>
  Object.keys(t.shadow).map((k) => decl(`shadow-${k}`, `var(--elevation-${k})`));

function typeDecls(t: Tokens): string[] {
  const out = Object.entries(t.font).map(([k, f]) => decl(`font-${k}`, fontStack(f)));
  for (const [k, f] of Object.entries(t.font)) if (f.stretch) out.push(decl(`font-${k}--stretch`, f.stretch));
  for (const [k, tok] of Object.entries(t.text)) {
    out.push(decl(`text-${k}`, textSize(tok, t)));
    out.push(decl(`text-${k}--line-height`, tok.lineHeight));
    out.push(decl(`text-${k}--font-weight`, tok.weight));
    if (tok.letterSpacing) out.push(decl(`text-${k}--letter-spacing`, tok.letterSpacing));
  }
  return out;
}

const shapeDecls = (t: Tokens) => [
  ...Object.entries(t.breakpoint).map(([k, v]) => decl(`breakpoint-${k}`, rem(v))),
  ...Object.entries(t.container).map(([k, v]) => decl(`container-${k}`, v)),
  ...Object.entries(t.radius).map(([k, v]) => decl(`radius-${k}`, v >= 999 ? "9999px" : rem(v))),
  ...Object.entries(t.ease).map(([k, v]) => decl(`ease-${k}`, v)),
];

function rootDecls(t: Tokens): string[] {
  return [
    ...Object.entries(t.space).map(([k, v]) => decl(`space-${k}`, rem(v))),
    ...Object.entries(t.rhythm).map(([k, v]) => decl(k, rem(v.base))),
    ...Object.entries(t.duration).map(([k, v]) => decl(`duration-${k}`, `${v}ms`)),
    ...Object.entries(t.app).map(([k, v]) => decl(`app-${k}`, rem(v))),
    decl("target-min", rem(t.target.min)),
  ];
}

function sharedTail(t: Tokens): string {
  const md = rem(t.breakpoint.md ?? 768);
  const lg = rem(t.breakpoint.lg ?? 1024);
  const rhythm = (bp: "md" | "lg") => Object.entries(t.rhythm).map(([k, v]) => decl(k, rem(v[bp])));
  const dark = ["color-scheme: dark;", ...colorDecls(t, "dark", false), ...elevationDecls(t, "dark")];
  const reduced = Object.keys(t.duration).map((k) => decl(`duration-${k}`, "0ms"));
  return [
    `@media (min-width: ${md}) {\n${block(":root", rhythm("md"), "  ")}}\n`,
    `@media (min-width: ${lg}) {\n${block(":root", rhythm("lg"), "  ")}}\n`,
    "/* Dark theme: follows the OS unless the page sets data-theme. */\n",
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"])', dark, "  ")}}\n`,
    block(':root[data-theme="dark"]', dark),
    `@media (prefers-reduced-motion: reduce) {\n${block(":root", reduced, "  ")}}\n`,
  ].join("\n");
}

/** Plain CSS custom properties (any consumer). */
export function renderTokensCss(t: Tokens = defaultTokens): string {
  const root = [
    "color-scheme: light;",
    ...colorDecls(t, "light", true),
    ...elevationDecls(t, "light"),
    ...shadowRefs(t),
    ...typeDecls(t),
    ...shapeDecls(t),
    ...rootDecls(t),
  ];
  return `${HEADER("Design tokens as CSS custom properties")}\n${block(":root", root)}\n${sharedTail(t)}`;
}

/** Tailwind v4 theme: only our tokens exist as utilities (all Tailwind defaults are reset). */
export function renderTailwindTheme(t: Tokens = defaultTokens): string {
  const theme = [
    "--*: initial;",
    decl("spacing", rem(4)),
    ...colorDecls(t, "light", true),
    ...shadowRefs(t),
    ...typeDecls(t),
    ...shapeDecls(t),
    decl("default-font-family", "var(--font-sans)"),
    decl("default-mono-font-family", "var(--font-mono)"),
    decl("default-transition-duration", `${t.duration.fast ?? 120}ms`),
    decl("default-transition-timing-function", "var(--ease-standard)"),
  ];
  const root = ["color-scheme: light;", ...elevationDecls(t, "light"), ...rootDecls(t)];
  return `${HEADER("Tailwind v4 theme")}\n${block("@theme static", theme)}\n${block(":root", root)}\n${sharedTail(t)}`;
}

const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const stack = (fonts: string[]) => fonts.map((f) => (/\s/.test(f) ? `'${f}'` : f)).join(", ");

/** Inline-style constants for email templates (email clients don't support CSS variables reliably). */
export function renderEmailTs(t: Tokens = defaultTokens): string {
  const colors = (theme: Theme) =>
    Object.fromEntries(Object.entries(semanticColors(theme, t)).map(([k, v]) => [camel(k), v]));
  const px = (name: string) => {
    const tok = t.text[name];
    if (!tok) throw new Error(`missing text token ${name}`);
    return "size" in tok ? tok.size : tok.max;
  };
  const value = {
    width: t.email.width,
    logoWidth: t.email.logoWidth,
    buttonHeight: t.email.buttonHeight,
    color: colors("light"),
    colorDark: colors("dark"),
    font: { sans: stack(t.email.fontSans), display: stack(t.email.fontDisplay) },
    text: {
      body: { size: t.email.bodySize, lineHeight: t.email.bodyLineHeight },
      h1: { size: px("h3"), lineHeight: 1.25 },
      h2: { size: px("h4"), lineHeight: 1.3 },
      sm: { size: px("sm"), lineHeight: 1.45 },
      caption: { size: px("caption"), lineHeight: 1.4 },
    },
    radius: t.radius.md ?? 8,
  };
  return `${HEADER("Email tokens").replace("/*", "//").replace(" */", "")}\nexport const emailTokens = ${JSON.stringify(value, null, 2)} as const;\n`;
}

/** Print foundations for PDF documents (A4); per-document templates build on these in packages/pdf. */
export function renderPrintCss(t: Tokens = defaultTokens): string {
  const p = t.print;
  const s = p.sizePt;
  const pt = (k: string) => `${s[k]}pt`;
  const light = semanticColors("light", t);
  const keep = [
    "text",
    "text-muted",
    "text-accent",
    "border",
    "accent-decor",
    "success",
    "warning",
    "danger",
    "info",
  ];
  const root = [
    ...keep.map((k) => decl(`color-${k}`, light[k] ?? "")),
    decl("font-display", fontStack(t.font.display)),
    decl("font-sans", fontStack(t.font.sans)),
    decl("font-mono", fontStack(t.font.mono)),
    ...Object.entries(s).map(([k, v]) =>
      decl(`print-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, `${v}pt`),
    ),
    decl("print-grid-columns", p.gridColumns),
    decl("print-gutter", `${p.gutterMm}mm`),
    decl("print-swoosh-rule", `${p.swooshRuleMm}mm`),
    decl("print-logo-width", `${p.logoWidthMm}mm`),
  ];
  const m = p.marginMm;
  return [
    HEADER("Print foundations for PDF documents"),
    block("@page", [
      `size: ${p.page} portrait;`,
      `margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;`,
    ]),
    block(":root", root),
    block("html", [
      "color: var(--color-text);",
      "background: #ffffff;",
      "font-family: var(--font-sans);",
      `font-size: ${pt("body")};`,
      `line-height: ${pt("bodyLeading")};`,
      "font-variant-numeric: tabular-nums lining-nums;",
      "print-color-adjust: exact;",
      "-webkit-print-color-adjust: exact;",
    ]),
    block("h1", ["font-family: var(--font-display);", `font-size: ${pt("title")};`, "font-weight: 500;"]),
    block("table", ["border-collapse: collapse;", `font-size: ${pt("table")};`]),
    block("thead", ["display: table-header-group;"]),
    block("tr", ["break-inside: avoid;"]),
  ].join("\n");
}
