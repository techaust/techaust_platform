// Reads the committed font metrics (build script + drift test). Node-only; not exported to apps.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type MetricsFile, renderFontsCss } from "./metrics.ts";

export const readMetrics = (root: string) =>
  JSON.parse(readFileSync(join(root, "fonts/metrics.json"), "utf8")) as MetricsFile;

export const fontsCssFromDisk = (root: string) => renderFontsCss(readMetrics(root));
