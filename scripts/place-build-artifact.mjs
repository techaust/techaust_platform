// M7.5 L57 (re-check of review 1, finding 1): puts the build job's artifact into the deploy job's checkout, and only the build outputs.
// The artifact comes from a job that installed and ran package code, so its contents are not trusted: downloaded with `path: .` it could have overwritten
// any file of the trusted checkout (scripts/deploy-worker.mjs, the deploy-tools wrangler, apps/jobs/wrangler.jsonc that the seed step runs wrangler with) or
// added an `apps/<app>/.env`, which wrangler loads from its working folder into `process.env` (`CLOUDFLARE_API_BASE_URL` could send the token elsewhere).
// The deploy jobs download it into `$RUNNER_TEMP` instead, and this script, run from the checkout before any step that holds a secret, refuses the whole
// artifact when one entry is outside the build outputs the build job uploads (PLACEMENTS, kept equal to the upload step by
// apps/web/test/deploy-workflow.test.ts), is a `.env*` or `.dev.vars*` file or folder anywhere, is a symlink or anything but a file or a folder, or when a
// destination already exists in the checkout. Only then does it copy the files into place (never over an existing file).
//
//   node scripts/place-build-artifact.mjs staging "$RUNNER_TEMP/staging-build"
//   node scripts/place-build-artifact.mjs production "$RUNNER_TEMP/production-build"
import { constants, copyFileSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * Per scope, the build outputs the artifact may hold: `from` (a path inside the artifact, "" for its whole root) goes to `to` (a path in the checkout).
 * staging: the upload step of deploy-staging.yml's build job names several paths, so the artifact keeps them relative to the repository root.
 * production: deploy-prod.yml's build job uploads `apps/web/dist` alone, so the artifact's root is that folder's contents.
 */
export const PLACEMENTS = Object.freeze({
  staging: Object.freeze([
    { from: ".deploy/seed.sql", to: ".deploy/seed.sql", type: "file" },
    { from: "apps/admin/dist", to: "apps/admin/dist", type: "dir" },
    { from: "apps/admin/.wrangler/deploy", to: "apps/admin/.wrangler/deploy", type: "dir" },
    { from: "apps/portal/dist", to: "apps/portal/dist", type: "dir" },
    { from: "apps/portal/.wrangler/deploy", to: "apps/portal/.wrangler/deploy", type: "dir" },
    { from: "apps/web/dist", to: "apps/web/dist", type: "dir" },
    { from: "apps/web/.wrangler/dist-staging", to: "apps/web/.wrangler/dist-staging", type: "dir" },
    { from: "apps/jobs/dist-staging", to: "apps/jobs/dist-staging", type: "dir" },
  ]),
  production: Object.freeze([{ from: "", to: "apps/web/dist", type: "dir" }]),
});

/** A local secrets file or folder: never placed, whatever folder it is in (wrangler reads `.env*` and `.dev.vars*`). */
export const SECRET_NAME = /^\.(env|dev\.vars)/i;

/** Every entry under `dir`, as `{ rel, path, stat }` with `rel` in forward slashes; symlinks are listed, never followed. */
function walk(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    const stat = lstatSync(path);
    out.push({ rel, path, stat });
    if (stat.isDirectory() && !stat.isSymbolicLink()) out.push(...walk(path, rel));
  }
  return out;
}

/** The placement a file at `rel` belongs to (undefined: outside the build outputs). */
function placementOf(placements, rel) {
  return placements.find((p) =>
    p.type === "file" ? rel === p.from : p.from === "" || rel.startsWith(`${p.from}/`),
  );
}

/** A folder at `rel` may be a placed folder, inside one, or a parent of one (`apps`, `apps/admin/.wrangler`). */
function folderAllowed(placements, rel) {
  return placements.some(
    (p) =>
      (p.type === "dir" && (p.from === "" || rel === p.from || rel.startsWith(`${p.from}/`))) ||
      p.from.startsWith(`${rel}/`),
  );
}

const exists = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/** The checkout path of a placed file. */
function destinationOf(p, rel, root) {
  const tail = p.type === "file" ? "" : p.from === "" ? rel : rel.slice(p.from.length + 1);
  return tail === "" ? join(root, p.to) : join(root, p.to, tail);
}

/**
 * The problems of placing the artifact downloaded at `fromDir` into the checkout at `root` (an empty list: place it). Every rule is checked before
 * anything is copied, so a refused artifact leaves the checkout untouched.
 */
export function placementProblems(scope, fromDir, root = ROOT) {
  const placements = PLACEMENTS[scope];
  if (!placements) return [`unknown scope ${scope} (known: ${Object.keys(PLACEMENTS).join(", ")})`];
  let top;
  try {
    top = lstatSync(fromDir);
  } catch {
    return [`${fromDir} is missing: download the artifact there first`];
  }
  if (!top.isDirectory() || top.isSymbolicLink()) return [`${fromDir} is not a folder: refused`];
  const problems = [];
  const entries = walk(fromDir);
  for (const { rel, stat } of entries) {
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    if (stat.isSymbolicLink()) problems.push(`${rel} is a symlink: refused`);
    else if (SECRET_NAME.test(name)) problems.push(`${rel} is a local secrets file (.env*, .dev.vars*): refused`);
    else if (stat.isDirectory()) {
      if (!folderAllowed(placements, rel)) problems.push(`${rel} is outside the build outputs: refused`);
    } else if (!stat.isFile()) problems.push(`${rel} is not a file or a folder: refused`);
    else if (!placementOf(placements, rel)) problems.push(`${rel} is outside the build outputs: refused`);
  }
  for (const p of placements) {
    const present =
      p.from === ""
        ? entries.some((e) => e.stat.isFile())
        : entries.some((e) => e.rel === p.from && (p.type === "file" ? e.stat.isFile() : e.stat.isDirectory()));
    if (!present) problems.push(p.from === "" ? "the artifact holds no file" : `${p.from} is missing from the artifact`);
    if (exists(join(root, p.to)))
      problems.push(`${p.to} already exists in the checkout: refused (the artifact never overwrites it)`);
  }
  return problems;
}

/** Places the artifact (after `placementProblems` found nothing); returns the problems, or the number of files copied. */
export function placeArtifact(scope, fromDir, root = ROOT) {
  const problems = placementProblems(scope, fromDir, root);
  if (problems.length > 0) return { problems, copied: 0 };
  const placements = PLACEMENTS[scope];
  let copied = 0;
  for (const { rel, path, stat } of walk(fromDir)) {
    if (!stat.isFile()) continue;
    const dest = destinationOf(placementOf(placements, rel), rel, root);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(path, dest, constants.COPYFILE_EXCL);
    copied++;
  }
  return { problems: [], copied };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [scope, fromDir] = process.argv.slice(2);
  if (!scope || !fromDir) {
    console.error("usage: node scripts/place-build-artifact.mjs staging|production <downloaded artifact folder>");
    process.exit(2);
  }
  const { problems, copied } = placeArtifact(scope, resolve(fromDir));
  if (problems.length > 0) {
    for (const p of problems.slice(0, 50)) console.error(`place-build-artifact (${scope}): ${p}`);
    if (problems.length > 50) console.error(`  … and ${problems.length - 50} more`);
    console.error("Nothing was placed.");
    process.exit(1);
  }
  console.log(`place-build-artifact (${scope}): ${copied} files placed`);
}
