// Subsets the pinned @fontsource files into packages/ui/fonts/, measures metrics, writes generated/fonts.css.
// Run: pnpm --filter @techaust/ui build:fonts
//   --measure-system  also re-measure Arial from the local Windows font (CI has no Arial, so its numbers
//                     are committed in fonts/metrics.json).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";
import { codePoints, FACES, fontFileName, MAIN_RANGES } from "../src/fonts/config.ts";
import { fontsCssFromDisk } from "../src/fonts/disk.ts";
import { type Metrics, type MetricsFile, measure, parseFont } from "../src/fonts/metrics.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const fontsDir = join(root, "fonts");
mkdirSync(fontsDir, { recursive: true });

const metricsPath = join(fontsDir, "metrics.json");
const previous: MetricsFile = existsSync(metricsPath)
  ? JSON.parse(readFileSync(metricsPath, "utf8"))
  : { web: {}, system: {} };
const web: Record<string, Metrics> = {};

for (const face of FACES) {
  for (const file of face.files) {
    const src = readFileSync(require.resolve(file.source));
    const out = await subsetFont(src, String.fromCodePoint(...codePoints(file.ranges)), {
      targetFormat: "woff2",
      ...(face.axes ? { variationAxes: face.axes } : {}),
    });
    writeFileSync(join(fontsDir, fontFileName(face, file)), out);
    console.log(`${fontFileName(face, file)}  ${(out.length / 1024).toFixed(1)} KB`);
  }
  // Each fallback is matched to the web font at one instance (e.g. Archivo body text vs expanded headings).
  const latin = face.files.find((f) => f.suffix === "latin");
  for (const fb of face.fallbacks ?? []) {
    if (!latin) continue;
    const pinned = await subsetFont(
      readFileSync(require.resolve(latin.source)),
      String.fromCodePoint(...codePoints(MAIN_RANGES)),
      { targetFormat: "truetype", variationAxes: fb.instance },
    );
    web[fb.family] = measure(parseFont(pinned));
  }
}

let system = previous.system;
if (process.argv.includes("--measure-system")) {
  const path = "C:/Windows/Fonts/arial.ttf";
  if (!existsSync(path)) throw new Error(`${path} not found (run on Windows)`);
  system = { Arial: { ...measure(parseFont(readFileSync(path))), source: "Windows 11 arial.ttf" } };
}
writeFileSync(metricsPath, `${JSON.stringify({ web, system }, null, 2)}\n`);

// The OFL requires the copyright + licence to travel with the font files.
const pkgs = [...new Set(FACES.map((f) => f.files[0]?.source.split("/files/")[0] ?? ""))];
const licences = pkgs.map((pkg) => {
  const meta = JSON.parse(readFileSync(require.resolve(`${pkg}/package.json`), "utf8")) as {
    version: string;
  };
  return `## ${pkg} ${meta.version}\n\n${readFileSync(require.resolve(`${pkg}/LICENSE`), "utf8").trim()}\n`;
});
writeFileSync(
  join(fontsDir, "LICENSES.md"),
  `# Font licences\n\nSubset by packages/ui/scripts/build-fonts.ts from the packages below. The copyright notices below declare no Reserved Font Name, so the subsets keep the family names.\n\n${licences.join("\n")}`,
);

writeFileSync(join(root, "generated/fonts.css"), fontsCssFromDisk(root));
console.log("wrote fonts/metrics.json, fonts/LICENSES.md, generated/fonts.css");
