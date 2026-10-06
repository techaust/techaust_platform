// Recomputes every semantic colour pair and fails below its WCAG threshold (docs/06 §2.3).
// AAA text 7:1 · AA text 4.5:1 · large text / non-text UI (WCAG 1.4.11) 3:1.
import { describe, expect, it } from "vitest";
import { contrastRatio, semanticColors, type Theme } from "../src/tokens/model.ts";

const AAA = 7;
const AA = 4.5;
const UI = 3;

type Pair = [fg: string, bg: string, min: number, why: string];

const textOn = (bgs: string[], fgs: [string, number][]): Pair[] =>
  bgs.flatMap((bg) => fgs.map(([fg, min]): Pair => [fg, bg, min, `${fg} on ${bg}`]));

const PAIRS: Record<Theme, Pair[]> = {
  light: [
    ["text", "bg", AAA, "body text"],
    ["text-muted", "bg", AAA, "muted text"],
    ...textOn(
      ["bg", "surface", "surface-alt"],
      [
        ["text", AA],
        ["text-muted", AA],
        ["text-accent", AA],
        ["link", AA],
        ["link-hover", AA],
        ["success", AA],
        ["warning", AA],
        ["danger", AA],
        ["info", AA],
      ],
    ),
    ["text", "fill-subtle", AA, "table stripes / code background"],
    ["accent-decor", "bg", UI, "decorative verdigris: large text and non-text only"],
    ["btn-primary-fg", "btn-primary-bg", AA, "primary button"],
    ["btn-primary-fg", "btn-primary-hover", AA, "primary button, hover"],
    ["btn-secondary-fg", "bg", AA, "secondary button"],
    ["border-control", "bg", UI, "input borders"],
    ["border-control", "surface", UI, "input borders on cards"],
    ["focus", "bg", UI, "focus ring"],
    ["focus", "surface", UI, "focus ring on cards"],
  ],
  dark: [
    ["text", "bg", AAA, "body text"],
    ["text-muted", "bg", AAA, "muted text"],
    ["text-muted", "surface", AAA, "muted text on cards"],
    ...textOn(
      ["bg", "surface", "surface-alt", "surface-raised"],
      [
        ["text", AA],
        ["text-muted", AA],
        ["text-accent", AA],
        ["link", AA],
        ["link-hover", AA],
        ["success", AA],
        ["warning", AA],
        ["danger", AA],
        ["info", AA],
      ],
    ),
    ["btn-primary-fg", "btn-primary-bg", AA, "primary button (light verdigris)"],
    ["btn-primary-fg", "btn-primary-hover", AA, "primary button, hover"],
    ["btn-secondary-fg", "bg", AA, "secondary button"],
    ["border-control", "bg", UI, "input borders"],
    ["border-control", "surface", UI, "input borders on cards"],
    ["border-control", "surface-raised", UI, "input borders in dialogs"],
    ["focus", "bg", UI, "focus ring"],
    ["focus", "surface", UI, "focus ring on cards"],
    ["focus", "surface-raised", UI, "focus ring in dialogs"],
  ],
};

describe.each(["light", "dark"] as const)("%s theme contrast", (theme) => {
  const colors = semanticColors(theme);
  it.each(PAIRS[theme])("%s on %s ≥ %s:1 (%s)", (fg, bg, min) => {
    const a = colors[fg];
    const b = colors[bg];
    expect(a, `unknown token ${fg}`).toBeDefined();
    expect(b, `unknown token ${bg}`).toBeDefined();
    expect(contrastRatio(a as string, b as string)).toBeGreaterThanOrEqual(min);
  });
});

describe("contrast maths", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    // docs/06 §2.3: ink on stone is documented as 15.1:1
    expect(contrastRatio("#14231f", "#f6f7f5")).toBeCloseTo(15.15, 1);
  });

  it("body text never uses the decorative accent (docs/06 §2.3 rule)", () => {
    for (const theme of ["light", "dark"] as const) {
      const c = semanticColors(theme);
      expect(c.text).not.toBe(c["accent-decor"]);
      expect(c["text-muted"]).not.toBe(c["accent-decor"]);
    }
  });
});
