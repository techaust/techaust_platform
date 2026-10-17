// Brand wallpapers: the committed PNGs are exactly what the generator draws today (each PNG carries the SHA-256
// of its SVG source, so nothing is re-rendered here), they are sRGB at the exact sizes, the quiet zones really
// are quiet, and the mark keeps its geometry and its colour logic.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { color } from "../src/brand/compose.ts";
import { markPaths } from "../src/brand/geometry.ts";
import { pngInfo, sourceHash } from "../src/brand/png.ts";
import {
  constructionNodeSize,
  FORMATS,
  fitMark,
  wallpaperDimension,
  wallpaperMarkSize,
  wallpaperNetwork,
  wallpaperPlan,
  wallpaperSvg,
} from "../src/brand/wallpapers.ts";
import { tokens } from "../src/tokens/model.ts";

const dir = join(import.meta.dirname, "..", "brand", "wallpapers");
const plan = wallpaperPlan();
type Pt = [number, number];
const hex = (h: string) =>
  [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const lstar = ([r, g, b]: [number, number, number]) => {
  const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
};

describe("wallpaper files", () => {
  it("there are six, named wallpaper-<concept>-<format>.png, and nothing else", () => {
    expect(plan).toHaveLength(6);
    expect(readdirSync(dir).sort()).toEqual(plan.map((w) => w.file).sort());
  });

  it.each(plan.map((w) => [w.file, w] as const))("%s is current, sRGB and the exact size", (file, w) => {
    const info = pngInfo(readFileSync(join(dir, file)));
    expect([info.width, info.height]).toEqual([w.width, w.height]);
    expect(info.colourType, "opaque RGB").toBe(2);
    expect(info.bitDepth).toBe(8);
    expect(info.srgb).toBe(true);
    expect(info.iccp).toBe(false);
    expect(info.source, "rendered from today's SVG: run build:wallpapers").toBe(sourceHash(w.svg));
  });

  it("the sizes are the brief's: desktop 3840 × 2160, mobile 2160 × 4680", () => {
    expect(FORMATS.desktop).toMatchObject({ width: 3840, height: 2160 });
    expect(FORMATS.mobile).toMatchObject({ width: 2160, height: 4680 });
  });
});

describe("drawing rules", () => {
  const palette = new Set(Object.values(tokens.palette).map((h) => h.toUpperCase()));

  it.each(plan.map((w) => [w.file, w.svg] as const))("%s uses only palette colours, flat", (_, svg) => {
    for (const m of svg.matchAll(/#[0-9A-Fa-f]{6}\b/g))
      expect(palette.has(m[0].toUpperCase()), m[0]).toBe(true);
    expect(svg).not.toMatch(/Gradient|<filter|opacity|<text|<image/);
  });

  it("the fitted mark is geometry.ts snapped to whole pixels", () => {
    for (const size of [480, 1000, 1100, 1500, 1680]) {
      const m = fitMark(size);
      const k = size / 100;
      expect(m.fill).toEqual(
        markPaths({ v: 19 * k, h: 17.5 * k, stemX: 19.5 * k, crossbarY: 48.5 * k, size }, true),
      );
      const nums = [m.fill.base, m.fill.accent, m.outline.base, m.outline.accent].flatMap((d) =>
        (d.match(/-?\d*\.?\d+/g) ?? []).map(Number),
      );
      for (const n of nums) expect(Number.isInteger(n), `${size}: ${n}`).toBe(true);
      // The channel between the two 45° cuts stays one stroke wide (within half a pixel).
      expect(Math.abs((size - m.barEnd) / Math.SQRT2 - m.v)).toBeLessThan(0.5);
    }
  });

  it("colour logic: the T and shared stem are ink, the crossbar and right stem verdigris, never swapped", () => {
    const family = (prefix: string) =>
      new Set(
        Object.keys(tokens.palette)
          .filter((k) => k.startsWith(prefix))
          .map(color),
      );
    const want = { base: family("ink-"), accent: family("verdigris-") };
    const marks = { monolith: 2, cut: 0, construction: 2 };
    for (const w of plan) {
      const parts = [...w.svg.matchAll(/<path data-part="(base|accent)"([^>]*)>/g)];
      expect(parts, w.file).toHaveLength(marks[w.concept]);
      const size = wallpaperMarkSize(w.concept, w.format);
      if (size === undefined) continue;
      // each part is the shape geometry.ts calls that part, so swapping base and accent (shape or paint) fails
      const shapes = w.concept === "monolith" ? fitMark(size).fill : fitMark(size).outline;
      expect(parts.map(([, part]) => part).sort(), w.file).toEqual(["accent", "base"]);
      for (const [, part, attrs = ""] of parts) {
        const p = part as "base" | "accent";
        expect(/ d="([^"]+)"/.exec(attrs)?.[1], `${w.file} ${p} shape`).toBe(shapes[p]);
        const paint = /fill="none"/.test(attrs)
          ? /stroke="([^"]+)"/.exec(attrs)?.[1]
          : /fill="([^"]+)"/.exec(attrs)?.[1];
        expect(want[p].has(paint ?? ""), `${w.file} ${p} ${paint}`).toBe(true);
      }
    }
  });

  it("is deterministic", () => {
    for (const w of plan) expect(wallpaperSvg(w.concept, w.format)).toBe(w.svg);
  });
});

describe("the node network (Construction and Cut; none on the Monolith)", () => {
  it.each(plan.map((w) => [w.file, w] as const))(
    "%s: a designed diagram on whole pixels, clear of the quiet zones",
    (file, w) => {
      const net = wallpaperNetwork(w.concept, w.format);
      if (w.concept === "monolith") {
        expect(net.nodes, file).toHaveLength(0);
        expect(w.svg).not.toContain("data-net");
        return;
      }
      // a real network: 12–20 nodes; one continuous signal across 3–5 nodes, arriving at the mark or the channel
      expect(net.nodes.length).toBeGreaterThanOrEqual(12);
      expect(net.nodes.length).toBeLessThanOrEqual(20);
      const signalNodes = net.nodes.filter((n) => n.signal);
      expect(signalNodes.length).toBeGreaterThanOrEqual(3);
      expect(signalNodes.length).toBeLessThanOrEqual(5);
      const signal = net.wires.filter((x) => x.signal);
      expect(signal).toHaveLength(1);
      const key = ([x, y]: [number, number]) => `${x},${y}`;
      const anchors = new Set(net.anchors.map(key));
      const nodes = new Set(net.nodes.map((n) => key(n.at)));
      const route = signal[0]?.pts ?? [];
      for (const n of signalNodes)
        expect(route.map(key), `${file}: signal node off the path`).toContain(key(n.at));
      expect(anchors.has(key(route.at(-1) as [number, number])), `${file}: the signal arrives`).toBe(true);
      // every wire starts and ends at a node or on the mark or channel (no floating traces)
      for (const wire of net.wires)
        for (const end of [wire.pts[0], wire.pts.at(-1)] as [number, number][])
          expect(nodes.has(key(end)) || anchors.has(key(end)), `${file}: loose end at ${key(end)}`).toBe(
            true,
          );
      // branching: at least two junctions where three or more runs meet
      const degree = new Map<string, number>();
      for (const wire of net.wires)
        wire.pts.forEach((p, i) => {
          const runs = (i > 0 ? 1 : 0) + (i < wire.pts.length - 1 ? 1 : 0);
          degree.set(key(p), (degree.get(key(p)) ?? 0) + runs);
        });
      const junctions = [...nodes].filter((n) => (degree.get(n) ?? 0) >= 3);
      expect(junctions.length, `${file}: junctions`).toBeGreaterThanOrEqual(2);
      // the SVG draws exactly this network
      expect(w.svg.match(/data-net="(signal-)?node"/g)?.length).toBe(net.nodes.length);
      expect(w.svg.match(/data-net="(signal-)?wire"/g)?.length).toBe(net.wires.length);
      const f = FORMATS[w.format];
      const pts = [...net.nodes.map((n) => n.at), ...net.wires.flatMap((x) => x.pts)];
      for (const [x, y] of pts) {
        expect(Number.isInteger(x) && Number.isInteger(y), `${file}: ${x},${y} on whole pixels`).toBe(true);
        expect(x > 0 && x < f.width && y > 0 && y < f.height, `${file}: ${x},${y} in frame`).toBe(true);
      }
      // every wire runs at 0°, 90° or 45°
      for (const wire of net.wires)
        for (let i = 1; i < wire.pts.length; i++) {
          const [ax, ay] = wire.pts[i - 1] as [number, number];
          const [bx, by] = wire.pts[i] as [number, number];
          const dx = Math.abs(bx - ax);
          const dy = Math.abs(by - ay);
          expect(dx === 0 || dy === 0 || dx === dy, `${file}: ${ax},${ay} to ${bx},${by}`).toBe(true);
        }
      // nothing within 60 px of a quiet zone: every wire segment's box and every node, with margin
      const margin = 60;
      const boxes = [
        ...net.nodes.map((n) => [n.at[0], n.at[1], n.at[0], n.at[1]]),
        ...net.wires.flatMap((x) =>
          x.pts.slice(1).map((b, i) => {
            const a = x.pts[i] as [number, number];
            return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
          }),
        ),
      ];
      for (const [x0, y0, x1, y1] of boxes as [number, number, number, number][])
        for (const q of f.quiet) {
          const apart =
            x1 + margin <= q.x || x0 - margin >= q.x + q.w || y1 + margin <= q.y || y0 - margin >= q.y + q.h;
          expect(apart, `${file}: ${x0},${y0} to ${x1},${y1} near the zone at ${q.x},${q.y}`).toBe(true);
        }
    },
  );
});

describe("the Construction's channel dimension stands clear of the network", () => {
  // distance from point p to segment a–b
  const toSegment = ([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  // distance from point p to a node's square (centred on c, n px wide)
  const toNode = ([px, py]: Pt, [cx, cy]: Pt, n: number) =>
    Math.hypot(Math.max(0, Math.abs(px - cx) - n / 2), Math.max(0, Math.abs(py - cy) - n / 2));

  it.each(["desktop", "mobile"] as const)("%s: no node or wire within 2 × tick of either end", (format) => {
    const { a, b, tick } = wallpaperDimension(format);
    const net = wallpaperNetwork("construction", format);
    const n = constructionNodeSize(format);
    for (const end of [a, b]) {
      for (const node of net.nodes)
        expect(toNode(end, node.at, n), `node at ${node.at} near ${end}`).toBeGreaterThanOrEqual(2 * tick);
      for (const wire of net.wires)
        for (let i = 1; i < wire.pts.length; i++) {
          const p = wire.pts[i - 1] as Pt;
          const q = wire.pts[i] as Pt;
          expect(toSegment(end, p, q), `wire ${p} to ${q} near ${end}`).toBeGreaterThanOrEqual(2 * tick);
        }
    }
  });
});

describe("quiet zones (measured in the committed PNGs)", () => {
  const ground = lstar(hex(color("ink-950")));
  const verdigris = Object.entries(tokens.palette)
    .filter(([k]) => k.startsWith("verdigris-"))
    .map(([, v]) => v.toUpperCase());

  it.each(plan.map((w) => [w.file, w] as const))("%s: only the ground or tone-on-tone", async (file, w) => {
    for (const q of FORMATS[w.format].quiet) {
      const { data, info } = await sharp(join(dir, file))
        .extract({ left: q.x, top: q.y, width: q.w, height: q.h })
        .raw()
        .toBuffer({ resolveWithObject: true });
      let worst = 0;
      const seen = new Set<string>();
      for (let o = 0; o < data.length; o += info.channels) {
        const c: [number, number, number] = [data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0];
        const key = c.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        worst = Math.max(worst, Math.abs(lstar(c) - ground));
        const h = `#${c.map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        expect(verdigris, `${file}: verdigris in a quiet zone`).not.toContain(h);
      }
      // ΔL* ≤ 6 on ink-950 keeps white icon labels (and their shadows) fully readable.
      expect(worst, `${file} ${q.x},${q.y}`).toBeLessThanOrEqual(6);
    }
  });
});
