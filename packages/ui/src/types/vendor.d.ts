// Minimal types for two untyped build-time libraries (only what scripts/ and src/brand/outline.ts use).
declare module "subset-font" {
  type Axes = Record<string, number | { min: number; max: number; default?: number }>;
  export default function subsetFont(
    font: Uint8Array,
    text: string,
    options?: { targetFormat?: "woff2" | "woff" | "truetype" | "sfnt"; variationAxes?: Axes },
  ): Promise<Buffer>;
}
declare module "fontverter" {
  const fontverter: {
    convert(font: Uint8Array, format: "sfnt" | "woff" | "woff2" | "truetype"): Promise<Buffer>;
  };
  export default fontverter;
}
