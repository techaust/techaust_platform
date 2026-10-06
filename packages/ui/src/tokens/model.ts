// Token model + pure helpers (no I/O). The JSON in tokens/tokens.json is the single source.
import raw from "../../tokens/tokens.json" with { type: "json" };

export type Theme = "light" | "dark";
type Fluid = { min: number; max: number };
type Fixed = { size: number };
export type TextToken = (Fluid | Fixed) & {
  lineHeight: number;
  weight: number;
  family: "display" | "sans" | "mono";
  letterSpacing?: string;
};
/** `metricFallback` names the metric-matched @font-face in fonts.css; `stretch` is the font-stretch to use. */
export type FontToken = { family: string; stretch?: string; fallback: string[]; metricFallback?: string };

export type Tokens = {
  palette: Record<string, string>;
  semantic: Record<string, Record<Theme, string>>;
  font: Record<"display" | "sans" | "mono", FontToken>;
  fluid: { minViewport: number; maxViewport: number };
  text: Record<string, TextToken>;
  space: Record<string, number>;
  rhythm: Record<string, { base: number; md: number; lg: number }>;
  breakpoint: Record<string, number>;
  container: Record<string, string>;
  app: Record<string, number>;
  radius: Record<string, number>;
  shadow: Record<string, Record<Theme, string>>;
  duration: Record<string, number>;
  ease: Record<string, string>;
  target: { min: number };
  print: {
    page: string;
    marginMm: { top: number; right: number; bottom: number; left: number };
    gridColumns: number;
    gutterMm: number;
    sizePt: Record<string, number>;
    swooshRuleMm: number;
    logoWidthMm: number;
  };
  email: {
    width: number;
    logoWidth: number;
    buttonHeight: number;
    bodySize: number;
    bodyLineHeight: number;
    fontSans: string[];
    fontDisplay: string[];
  };
};

const { $description: _description, ...data } = raw;
export const tokens = data as Tokens;

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** A semantic value is either a palette key or a literal hex colour. Returns lower-case hex. */
export function resolveColor(value: string, t: Tokens = tokens): string {
  const hex = HEX.test(value) ? value : t.palette[value];
  if (!hex || !HEX.test(hex)) throw new Error(`Unknown colour "${value}"`);
  return hex.toLowerCase();
}

export function semanticColors(theme: Theme, t: Tokens = tokens): Record<string, string> {
  return Object.fromEntries(Object.entries(t.semantic).map(([k, v]) => [k, resolveColor(v[theme], t)]));
}

/** WCAG 2.x relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const round = (n: number, places = 4) => Number(n.toFixed(places)).toString();
export const rem = (px: number) => (px === 0 ? "0" : `${round(px / 16)}rem`);

/** Fluid size between the min and max viewport (rem intercept keeps browser zoom working, WCAG 1.4.4). */
export function fluidSize(min: number, max: number, t: Tokens = tokens): string {
  const { minViewport: v0, maxViewport: v1 } = t.fluid;
  const slope = (max - min) / (v1 - v0);
  const intercept = min - slope * v0;
  return `clamp(${rem(min)}, ${rem(intercept)} + ${round(slope * 100)}vw, ${rem(max)})`;
}

export function textSize(tok: TextToken, t: Tokens = tokens): string {
  return "size" in tok ? rem(tok.size) : fluidSize(tok.min, tok.max, t);
}

const quoteFamily = (f: string) => (/^[a-z-]+$/.test(f) ? f : `"${f}"`);
/** CSS font stack: web font, its metric-matched fallback face, then system fallbacks. */
export function fontStack(f: FontToken): string {
  const names = [f.family, ...(f.metricFallback ? [f.metricFallback] : []), ...f.fallback];
  return names.map(quoteFamily).join(", ");
}
