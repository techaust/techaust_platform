// What a client may see of the notes and files staff keep about it (M3.4, ADM-PRJ-03/-04): only items marked `shared`, and only its
// own (`client_id`). The portal routes that serve these arrive with POR-04 (M7.1); the queries live here now so that rule is written
// once, next to the tables, and tested before any portal route exists. Every function takes the client id from the portal SESSION
// (the caller), never from the request, and returns a prepared statement so a route can run it inside a batch.
// Subpath export (`@techaust/db/portal-shared`) so a Worker importing it does not pull in the Drizzle schema.

/** Notes shared with the client, newest first. `after` is the cursor (created_at, id) of the last row of the previous page. */
export function sharedNotesFor(
  db: D1Database,
  clientId: string,
  limit = 25,
  after?: { createdAt: number; id: string },
): D1PreparedStatement {
  const n = Math.min(Math.max(Math.trunc(limit), 1), 50);
  return db
    .prepare(
      `SELECT id, project_id, body_md, created_at, updated_at FROM notes
       WHERE client_id = ?1 AND visibility = 'shared'${after ? " AND (created_at, id) < (?2, ?3)" : ""}
       ORDER BY created_at DESC, id DESC LIMIT ${n}`,
    )
    .bind(clientId, ...(after ? [after.createdAt, after.id] : []));
}

/** Files shared with the client, newest first (no R2 key: the download reads it with `sharedFileFor`). */
export function sharedFilesFor(
  db: D1Database,
  clientId: string,
  limit = 25,
  after?: { createdAt: number; id: string },
): D1PreparedStatement {
  const n = Math.min(Math.max(Math.trunc(limit), 1), 50);
  return db
    .prepare(
      `SELECT id, project_id, filename, mime, size, created_at FROM files
       WHERE client_id = ?1 AND shared = 1${after ? " AND (created_at, id) < (?2, ?3)" : ""}
       ORDER BY created_at DESC, id DESC LIMIT ${n}`,
    )
    .bind(clientId, ...(after ? [after.createdAt, after.id] : []));
}

/** One shared file of this client, with what a download needs. Another client's file, or an unshared one, is no row. */
export function sharedFileFor(db: D1Database, clientId: string, fileId: string): D1PreparedStatement {
  return db
    .prepare(
      "SELECT id, project_id, r2_key, filename, mime, size FROM files WHERE id = ?1 AND client_id = ?2 AND shared = 1",
    )
    .bind(fileId, clientId);
}
