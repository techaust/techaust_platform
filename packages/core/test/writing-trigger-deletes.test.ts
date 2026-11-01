// The 0064 triggers that WRITE (M6.2; early check 1 F1, early check 2 finding 9): `checkout_sessions_unlink_token` (BEFORE DELETE ON `doc_access_tokens`) and
// `checkout_sessions_unlink_contact` (BEFORE DELETE ON `contacts`) unlink a checkout from the token or contact being deleted. They would fire on ANY delete of
// those rows, so this test pins the only two places that delete them today: the contact's erase or access removal (`packages/db/src/contact-access.ts`, the
// tokens) and the contact's erase (`apps/admin/worker/clients.ts`, the contact). A new delete anywhere else fails here until it is checked against the triggers
// and added below with its reason. Scans apps/ and packages/ source (tests, build output and the migrations are left out; the triggers file is scanned, so a
// trigger that deletes them is caught too).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "generated", "fonts", "brand", "migrations"]);
const CODE = /\.(ts|tsx|mts|mjs|js)$/;
/** `DELETE FROM contacts`, `DELETE FROM "doc_access_tokens"` and so on (any quoting, any case), and Drizzle's `.delete(contacts)` / `.delete(docAccessTokens)`. */
const DELETES =
  /DELETE\s+FROM\s+[`"']?(contacts|doc_access_tokens)\b|\.delete\(\s*(contacts|docAccessTokens)\s*\)/gi;

/** File → the deletes it may hold, and why the writing triggers are right for them. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  "packages/db/src/contact-access.ts": {
    count: 1,
    why: "a contact's portal access removed or the contact erased: its document links go, and their checkouts keep document, amount, status and payment",
  },
  "apps/admin/worker/clients.ts": {
    count: 1,
    why: "the contact's erase: its checkouts are unlinked from it and keep document, amount, status and payment",
  },
};

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (CODE.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/[\\/]test[\\/]/.test(p)) yield p;
  }
}

describe("deletes that fire the 0064 writing triggers [M6.2, early check 2 finding 9]", () => {
  it("only the contact's access removal and erase delete doc_access_tokens or contacts", () => {
    const found: Record<string, number> = {};
    for (const top of ["apps", "packages"])
      for (const f of files(join(REPO, top))) {
        const n = [...readFileSync(f, "utf8").matchAll(DELETES)].length;
        if (n > 0) found[relative(REPO, f).replaceAll("\\", "/")] = n;
      }
    expect(found).toEqual(Object.fromEntries(Object.entries(ALLOWED).map(([k, v]) => [k, v.count])));
  });
});
