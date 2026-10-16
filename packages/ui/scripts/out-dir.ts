// The --out folder for build-social.ts. The script deletes the folder before writing, so it accepts only a folder
// strictly inside <repo>/.logs/ (git-ignored scratch space): never .logs itself, the repo, a source folder or
// another drive. Node-only (node:path); used by the script and test/social.test.ts.
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** The folder named after `--out` in `args`, or `fallback` without the flag; throws on anything unsafe. */
export function outDir(args: string[], repo: string, fallback: string, cwd = process.cwd()): string {
  const at = args.indexOf("--out");
  if (at < 0) return fallback;
  const value = args[at + 1];
  if (value === undefined || value === "" || value.startsWith("--"))
    throw new Error("--out needs a folder inside .logs/, e.g. --out .logs/social/kit");
  const logs = join(repo, ".logs");
  const dir = resolve(cwd, value);
  const rel = relative(logs, dir);
  if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error(`--out must be a folder inside ${logs}: ${dir}`);
  return dir;
}
