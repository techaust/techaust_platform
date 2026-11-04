// What a client may see of the notes and files staff keep about it (M3.4, ADM-PRJ-03/-04): only items marked `shared`, and only its
// own (`client_id`). The portal routes that serve these arrive with POR-04 (M7.1); the queries live here so that rule is written once,
// next to the tables, and tested before any portal route exists. Every function takes the client id from the portal SESSION (the
// caller), never from the request, and returns a prepared statement so a route can run it inside a batch. Every statement binds the
// client as `?1` and says `client_id = ?1`, the shape the portal's `forClient` requires, so a route can also run the exported SQL text
// through `forClient(db, scope(c), SQL, ...)` (M7.1 B). Pages are keyset pages of at most 50 rows, newest first, on the M7.1 partial
// indexes `notes_shared_client`, `files_shared_client`, `notes_shared_project` and `files_shared_project` (0071; EXPLAIN test).
// Subpath export (`@techaust/db/portal-shared`) so a Worker importing it does not pull in the Drizzle schema.

type After = { createdAt: number; id: string };

const pageSize = (limit: number) => Math.min(Math.max(Math.trunc(limit), 1), 50);
/** The cursor condition (the parameters after the fixed ones) and its values. */
const cursor = (after: After | undefined, first: number) =>
  after
    ? { sql: ` AND (x.created_at, x.id) < (?${first}, ?${first + 1})`, params: [after.createdAt, after.id] }
    : { sql: "", params: [] };

const NOTE_COLUMNS = "x.id, x.project_id, x.body_md, x.created_at, x.updated_at";
/** No R2 key: the download reads it with `sharedFileFor`. */
const FILE_COLUMNS = "x.id, x.project_id, x.filename, x.mime, x.size, x.created_at";

/**
 * The FROM and WHERE of a client's (`?1`) shared items in one of its projects (`?2`): the item is the client's and the project is too (`projects p … WHERE
 * p.client_id = ?1`), so another client's project gives no rows even though the 0025 scope triggers already tie an item's project to its client.
 */
export const sharedProjectSql = (table: "notes" | "files"): string =>
  `FROM ${table} x JOIN projects p ON p.id = x.project_id WHERE p.client_id = ?1 AND x.client_id = ?1 AND x.project_id = ?2 AND ${
    table === "notes" ? "x.visibility = 'shared'" : "x.shared = 1"
  }`;

/** Notes shared with the client, newest first. `after` is the cursor (created_at, id) of the last row of the previous page. */
export function sharedNotesFor(
  db: D1Database,
  clientId: string,
  limit = 25,
  after?: After,
): D1PreparedStatement {
  const c = cursor(after, 2);
  return db
    .prepare(
      `SELECT ${NOTE_COLUMNS} FROM notes x INDEXED BY notes_shared_client
       WHERE x.client_id = ?1 AND x.visibility = 'shared'${c.sql}
       ORDER BY x.created_at DESC, x.id DESC LIMIT ${pageSize(limit)}`,
    )
    .bind(clientId, ...c.params);
}

/** Files shared with the client, newest first (no R2 key). */
export function sharedFilesFor(
  db: D1Database,
  clientId: string,
  limit = 25,
  after?: After,
): D1PreparedStatement {
  const c = cursor(after, 2);
  return db
    .prepare(
      `SELECT ${FILE_COLUMNS} FROM files x INDEXED BY files_shared_client
       WHERE x.client_id = ?1 AND x.shared = 1${c.sql}
       ORDER BY x.created_at DESC, x.id DESC LIMIT ${pageSize(limit)}`,
    )
    .bind(clientId, ...c.params);
}

/** Notes shared with the client in one of its projects, newest first. A project that is not the client's gives no rows. */
export function sharedNotesForProject(
  db: D1Database,
  clientId: string,
  projectId: string,
  limit = 25,
  after?: After,
): D1PreparedStatement {
  const c = cursor(after, 3);
  return db
    .prepare(
      `SELECT ${NOTE_COLUMNS} ${sharedProjectSql("notes").replace("FROM notes x", "FROM notes x INDEXED BY notes_shared_project")}${c.sql}
       ORDER BY x.created_at DESC, x.id DESC LIMIT ${pageSize(limit)}`,
    )
    .bind(clientId, projectId, ...c.params);
}

/** Files shared with the client in one of its projects, newest first (no R2 key). A project that is not the client's gives no rows. */
export function sharedFilesForProject(
  db: D1Database,
  clientId: string,
  projectId: string,
  limit = 25,
  after?: After,
): D1PreparedStatement {
  const c = cursor(after, 3);
  return db
    .prepare(
      `SELECT ${FILE_COLUMNS} ${sharedProjectSql("files").replace("FROM files x", "FROM files x INDEXED BY files_shared_project")}${c.sql}
       ORDER BY x.created_at DESC, x.id DESC LIMIT ${pageSize(limit)}`,
    )
    .bind(clientId, projectId, ...c.params);
}

/** One shared file of the client (`?1`), by id (`?2`), with what a download needs. Another client's file, or an unshared one, is no row. */
export const SHARED_FILE_SQL =
  "SELECT id, project_id, r2_key, filename, mime, size FROM files WHERE client_id = ?1 AND id = ?2 AND shared = 1";

/** One shared file of this client, with what a download needs. Another client's file, or an unshared one, is no row. */
export function sharedFileFor(db: D1Database, clientId: string, fileId: string): D1PreparedStatement {
  return db.prepare(SHARED_FILE_SQL).bind(clientId, fileId);
}
