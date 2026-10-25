// M3.4 triggers and indexes (0024, 0025) [ADM-PRJ-01..05]: the integrity the API leans on, proved at the database.
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { all, insertClient, rejects, run } from "./helpers.ts";

let n = 0;
const project = async (clientId: string, sourceDocumentId: string | null = null) => {
  const id = uuidv7();
  n++;
  await run(
    "INSERT INTO projects (id, code, client_id, name, currency, source_document_id) VALUES (?, ?, ?, 'P', 'INR', ?)",
    id,
    `PRJ-T${n}`,
    clientId,
    sourceDocumentId,
  );
  return id;
};

describe("project triggers (0025)", () => {
  it("a note or file needs a client, and its project must belong to that client", async () => {
    const a = await insertClient("C-M34-A");
    const b = await insertClient("C-M34-B");
    const p = await project(a);
    await run("INSERT INTO notes (id, client_id, project_id, body_md) VALUES (?, ?, ?, 'x')", uuidv7(), a, p);
    await run("INSERT INTO notes (id, client_id, body_md) VALUES (?, ?, 'x')", uuidv7(), b);
    await rejects(
      run("INSERT INTO notes (id, client_id, project_id, body_md) VALUES (?, ?, ?, 'x')", uuidv7(), b, p),
      /project must belong/,
    );
    await rejects(run("INSERT INTO notes (id, body_md) VALUES (?, 'x')", uuidv7()), /needs a client/);
    await rejects(
      run(
        "INSERT INTO files (id, client_id, project_id, r2_key, filename, mime, size, sha256) VALUES (?, ?, ?, ?, 'f', 'text/plain', 1, 'h')",
        uuidv7(),
        b,
        p,
        `k-${uuidv7()}`,
      ),
      /project must belong/,
    );
    await rejects(
      run(
        "INSERT INTO files (id, r2_key, filename, mime, size, sha256) VALUES (?, ?, 'f', 'text/plain', 1, 'h')",
        uuidv7(),
        `k-${uuidv7()}`,
      ),
      /needs a client/,
    );
    const noteId = uuidv7();
    await run("INSERT INTO notes (id, client_id, project_id, body_md) VALUES (?, ?, ?, 'x')", noteId, a, p);
    await rejects(run("UPDATE notes SET client_id = ? WHERE id = ?", b, noteId), /project must belong/);
    await rejects(run("UPDATE notes SET client_id = NULL WHERE id = ?", noteId), /needs a client/);
    await run("UPDATE notes SET body_md = 'y' WHERE id = ?", noteId);
  });

  it("a project's client cannot change", async () => {
    const a = await insertClient("C-M34-C");
    const b = await insertClient("C-M34-D");
    const p = await project(a);
    await rejects(run("UPDATE projects SET client_id = ? WHERE id = ?", b, p), /client of a project cannot change/);
    await run("UPDATE projects SET name = 'Q', client_id = ? WHERE id = ?", a, p);
  });

  it("a milestone is an amount or a percentage, never both or neither, and never negative", async () => {
    const p = await project(await insertClient("C-M34-E"));
    const ins = (pos: number, amount: number | null, pct: number | null) =>
      run(
        "INSERT INTO milestones (id, project_id, position, title, amount_minor, pct_bp) VALUES (?, ?, ?, 'T', ?, ?)",
        uuidv7(),
        p,
        pos,
        amount,
        pct,
      );
    await ins(1, 100, null);
    await ins(2, null, 2500);
    await ins(3, 0, null);
    await rejects(ins(4, 100, 10), /not both/);
    await rejects(ins(5, null, null), /not both/);
    await rejects(ins(6, -1, null), /not negative/);
    const id = uuidv7();
    await run(
      "INSERT INTO milestones (id, project_id, position, title, amount_minor) VALUES (?, ?, 9, 'T', 5)",
      id,
      p,
    );
    await rejects(run("UPDATE milestones SET pct_bp = 5 WHERE id = ?", id), /not both/);
    await rejects(run("UPDATE milestones SET amount_minor = NULL WHERE id = ?", id), /not both/);
    await run("UPDATE milestones SET amount_minor = NULL, pct_bp = 100 WHERE id = ?", id);
    await run("UPDATE milestones SET title = 'U', status = 'ready_to_bill' WHERE id = ?", id);
  });

  it("a stored file changes only in its shared flag", async () => {
    const c = await insertClient("C-M34-F");
    const id = uuidv7();
    await run(
      "INSERT INTO files (id, client_id, r2_key, filename, mime, size, sha256) VALUES (?, ?, ?, 'f.txt', 'text/plain', 1, 'h')",
      id,
      c,
      `files/${c}/${id}`,
    );
    await run("UPDATE files SET shared = 1 WHERE id = ?", id);
    for (const set of [
      "filename = 'g'",
      "mime = 'x/y'",
      "size = 2",
      "sha256 = 'z'",
      "r2_key = 'other'",
      "uploaded_by = 'u'",
      "created_at = 1",
    ])
      await rejects(run(`UPDATE files SET ${set} WHERE id = ?`, id), /cannot change except/);
  });
});

describe("project indexes (0024)", () => {
  it("one project per source document, many without one", async () => {
    const c = await insertClient("C-M34-G");
    const doc = uuidv7();
    await project(c, doc);
    await rejects(project(c, doc), /UNIQUE constraint failed: projects.source_document_id/);
    await project(c);
    await project(c);
  });

  it("the filters have indexes", async () => {
    const names = async (t: string) =>
      (await all<{ name: string }>(`SELECT name FROM pragma_index_list('${t}')`)).map((i) => i.name);
    expect(await names("projects")).toEqual(
      expect.arrayContaining([
        "projects_created",
        "projects_status_updated",
        "projects_name_nocase",
        "projects_source_document",
      ]),
    );
    expect(await names("notes")).toContain("notes_client_visibility");
    expect(await names("files")).toContain("files_client_shared");
    expect(await names("milestones")).toContain("milestones_status_due");
  });
});
