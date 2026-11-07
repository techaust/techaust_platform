// Test-only: empties tables between tests although M7.4's delete guards (0079: the 366-day floors on `email_log`, `email_events`, `access_log`, the legal
// hold on `leads`, `contacts`, `files`, `notes`) refuse such deletes in every real path. Each BEFORE DELETE trigger that aborts is dropped for the one batch
// and put back exactly as installed (its text read from `sqlite_master`), so the guards stay under test everywhere else.
import { env } from "cloudflare:workers";

export async function wipe(...tables: string[]): Promise<void> {
  const db = env.DB;
  const guards: { name: string; sql: string }[] = [];
  for (const t of tables) {
    const { results } = await db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?1 AND sql LIKE '%BEFORE DELETE%' AND sql LIKE '%RAISE(ABORT%'",
      )
      .bind(t)
      .all<{ name: string; sql: string }>();
    guards.push(...results);
  }
  for (const g of guards) await db.prepare(`DROP TRIGGER \`${g.name}\``).run();
  try {
    await db.batch(tables.map((t) => db.prepare(`DELETE FROM ${t}`)));
  } finally {
    for (const g of guards) await db.prepare(g.sql).run();
  }
}
