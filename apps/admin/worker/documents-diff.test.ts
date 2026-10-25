// Saving by diff [ADM-PROP-02, -03; M4.3 review fix 2]: the child rows of a draft are brought to the saved state by UPDATE / INSERT / DELETE,
// matched by id, and the result is the same rows a replace would have written. Every test reads the rows back from the database and checks
// that the stored content hash is the hash of exactly those rows.
import { contentHashOfBundle, loadDocument } from "@techaust/db/documents";
import { beforeAll, describe, expect, it } from "vitest";
import { putPaymentTerms } from "./test-catalogue.ts";
import { rows, sessionFor } from "./test-helpers.ts";
import { env, getDoc, type J, json, mkDraft, mkTerms, patchDoc } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

type Line = { id?: string; description: string; qtyMilli: number; unit: string; rateMinor: number };
const mk = (n: number, tag = "L"): Line[] =>
  Array.from({ length: n }, (_, i) => ({
    description: `${tag}${i}`,
    qtyMilli: 1000,
    unit: "fixed",
    rateMinor: 100 + i,
  }));

/** A draft with `n` plain lines; returns the session, the id and the current `updatedAt`. */
async function draftWith(n: number) {
  const o = await owner();
  const made = await mkDraft(o);
  const doc = await getDoc(o, made.id);
  const res = await patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: mk(n) });
  expect(res.status).toBe(200);
  const saved = await json(res);
  return { o, id: made.id, updatedAt: saved.updatedAt as number };
}

const lineRows = (id: string) =>
  rows<J>(
    "SELECT id, position, description, rate_minor, qty_milli, taxable_minor, line_total_minor FROM document_lines WHERE document_id = ? ORDER BY position",
    id,
  );

/** The rows are exactly positions 1..n, and the stored hash is the hash of the stored rows. */
async function consistent(id: string, expectLines: number) {
  const l = await lineRows(id);
  expect(l.map((r) => r.position)).toEqual(Array.from({ length: expectLines }, (_, i) => i + 1));
  const bundle = await loadDocument(env.DB, id);
  expect(bundle).not.toBeNull();
  if (!bundle) return;
  // a draft's `computed` is not parsed by the loader: read the stored column, as a sent version's is
  const row = (
    await rows<{ computed: string; content_sha256: string }>(
      "SELECT computed, content_sha256 FROM documents WHERE id = ?",
      id,
    )
  )[0];
  const sealed = {
    ...bundle,
    document: { ...bundle.document, computed: JSON.parse(row?.computed ?? "null") },
  };
  expect(await contentHashOfBundle(sealed)).toBe(row?.content_sha256);
  return l;
}

/** The rowids of the child rows: a row that was updated in place keeps its rowid, a deleted and re-inserted row gets a new one. */
const rowids = async (table: string, id: string) =>
  Object.fromEntries(
    (
      await rows<{ id: string; rowid: number }>(`SELECT id, rowid FROM ${table} WHERE document_id = ?`, id)
    ).map((r) => [r.id, r.rowid]),
  );

async function save(s: { o: Awaited<ReturnType<typeof owner>>; id: string; updatedAt: number }, body: J) {
  const res = await patchDoc(s.o, s.id, { expectedUpdatedAt: s.updatedAt, ...body });
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
  const saved = await json(res);
  s.updatedAt = saved.updatedAt;
  return saved;
}

/** The lines as the SPA sends them back: ids kept. */
const asSent = async (s: { o: Awaited<ReturnType<typeof owner>>; id: string }) =>
  (await getDoc(s.o, s.id)).lines.map((l: J) => ({
    id: l.id,
    description: l.description,
    qtyMilli: l.qtyMilli,
    unit: l.unit,
    rateMinor: l.rateMinor,
  })) as Line[];

describe("the child rows are written by diff", () => {
  it("an edit changes only that row: the others keep their rowid and the removed row is gone", async () => {
    const s = await draftWith(5);
    const before = await rowids("document_lines", s.id);
    const sent = await asSent(s);
    sent[2] = { ...sent[2], description: "edited" } as Line;
    await save(s, { lines: sent });
    expect(await rowids("document_lines", s.id)).toEqual(before);
    const l = await consistent(s.id, 5);
    expect(l?.[2]?.description).toBe("edited");
    expect(l?.map((r) => r.description)).toEqual(["L0", "L1", "edited", "L3", "L4"]);
  });

  it("append, insert in the middle and insert first shift the positions and keep the rows", async () => {
    const s = await draftWith(4);
    const ids = (await asSent(s)).map((l) => l.id);
    let sent = await asSent(s);
    await save(s, { lines: [...sent, { description: "end", qtyMilli: 1000, unit: "fixed", rateMinor: 7 }] });
    expect((await consistent(s.id, 5))?.map((r) => r.description)).toEqual(["L0", "L1", "L2", "L3", "end"]);
    sent = await asSent(s);
    sent.splice(2, 0, { description: "middle", qtyMilli: 1000, unit: "fixed", rateMinor: 8 });
    await save(s, { lines: sent });
    expect((await consistent(s.id, 6))?.map((r) => r.description)).toEqual([
      "L0",
      "L1",
      "middle",
      "L2",
      "L3",
      "end",
    ]);
    sent = await asSent(s);
    sent.unshift({ description: "first", qtyMilli: 1000, unit: "fixed", rateMinor: 9 });
    await save(s, { lines: sent });
    const l = await consistent(s.id, 7);
    expect(l?.map((r) => r.description)).toEqual(["first", "L0", "L1", "middle", "L2", "L3", "end"]);
    // the first four lines still have their ids
    expect(l?.filter((r) => ids.includes(r.id)).map((r) => r.description)).toEqual(["L0", "L1", "L2", "L3"]);
  });

  it("removing rows, from the middle and from the ends, closes the gap", async () => {
    const s = await draftWith(6);
    let sent = await asSent(s);
    sent.splice(2, 1); // L2
    await save(s, { lines: sent });
    expect((await consistent(s.id, 5))?.map((r) => r.description)).toEqual(["L0", "L1", "L3", "L4", "L5"]);
    sent = (await asSent(s)).slice(1, 4); // drop the first and the last
    await save(s, { lines: sent });
    expect((await consistent(s.id, 3))?.map((r) => r.description)).toEqual(["L1", "L3", "L4"]);
  });

  it("a swap, a reversal and a rotation (cycles) pass the unique position index", async () => {
    const s = await draftWith(6);
    let sent = await asSent(s);
    [sent[0], sent[5]] = [sent[5] as Line, sent[0] as Line];
    await save(s, { lines: sent });
    expect((await consistent(s.id, 6))?.map((r) => r.description)).toEqual([
      "L5",
      "L1",
      "L2",
      "L3",
      "L4",
      "L0",
    ]);
    sent = (await asSent(s)).reverse();
    await save(s, { lines: sent });
    expect((await consistent(s.id, 6))?.map((r) => r.description)).toEqual([
      "L0",
      "L4",
      "L3",
      "L2",
      "L1",
      "L5",
    ]);
    sent = await asSent(s);
    sent.push(sent.shift() as Line);
    await save(s, { lines: sent });
    expect((await consistent(s.id, 6))?.map((r) => r.description)).toEqual([
      "L4",
      "L3",
      "L2",
      "L1",
      "L5",
      "L0",
    ]);
  });

  it("a mix in one save: delete, edit, move and insert together", async () => {
    const s = await draftWith(8);
    const sent = await asSent(s);
    const next: Line[] = [
      sent[7] as Line, // moved to the front
      { ...(sent[1] as Line), description: "edited" },
      { description: "new", qtyMilli: 2000, unit: "fixed", rateMinor: 55 },
      sent[3] as Line,
      sent[4] as Line,
      // 0, 2, 5, 6 removed
    ];
    await save(s, { lines: next });
    const l = await consistent(s.id, 5);
    expect(l?.map((r) => r.description)).toEqual(["L7", "edited", "new", "L3", "L4"]);
    // quantity 2 x 55: the figures follow
    expect(l?.[2]?.taxable_minor).toBe(110);
  });

  it("random edits of a 30-line draft always leave the rows and the hash consistent (seeded)", async () => {
    const s = await draftWith(30);
    let seed = 20_261_026;
    const rnd = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    let count = 30;
    for (let round = 0; round < 12; round++) {
      const sent = await asSent(s);
      const op = rnd(4);
      if (op === 0 && sent.length > 2) sent.splice(rnd(sent.length), 1);
      else if (op === 1 && sent.length < 40)
        sent.splice(rnd(sent.length + 1), 0, {
          description: `n${round}`,
          qtyMilli: 1000,
          unit: "fixed",
          rateMinor: 10 + round,
        });
      else if (op === 2) {
        const a = rnd(sent.length);
        const b = rnd(sent.length);
        [sent[a], sent[b]] = [sent[b] as Line, sent[a] as Line];
      } else {
        const a = rnd(sent.length);
        sent[a] = { ...(sent[a] as Line), description: `e${round}` };
      }
      count = sent.length;
      await save(s, { lines: sent });
      const l = await consistent(s.id, count);
      expect(l?.map((r) => r.description)).toEqual(sent.map((x) => x.description));
    }
  });

  it("a section edit touches one section; hiding and showing keeps the order; the schedule follows the total", async () => {
    const s = await draftWith(2);
    const doc = await getDoc(s.o, s.id);
    const ids = await rowids("document_sections", s.id);
    const sections = doc.sections.map((x: J) => ({
      id: x.id,
      kind: x.kind,
      title: x.title,
      bodyMd: x.bodyMd,
      hidden: x.hidden,
    }));
    sections[0] = { ...sections[0], bodyMd: "Only this one changed." };
    await save(s, { sections });
    expect(await rowids("document_sections", s.id)).toEqual(ids);
    const after = await rows<J>(
      "SELECT body_md, hidden FROM document_sections WHERE document_id = ? ORDER BY position",
      s.id,
    );
    expect(after[0]?.body_md).toBe("Only this one changed.");
    // a section is added and one is removed
    const withCustom = [...sections, { kind: "custom", title: "Extra", bodyMd: "An added section." }];
    await save(s, { sections: withCustom });
    expect((await rows("SELECT id FROM document_sections WHERE document_id = ?", s.id)).length).toBe(
      withCustom.length,
    );
    const trimmed = withCustom.slice(0, -1);
    await save(s, { sections: trimmed });
    expect((await rows("SELECT id FROM document_sections WHERE document_id = ?", s.id)).length).toBe(
      trimmed.length,
    );
    // the schedule: new percentages move the amounts; unchanged steps are not rewritten
    const sched = await rows<J>(
      "SELECT id, label, pct_bp, amount_minor FROM payment_schedules WHERE document_id = ? ORDER BY position",
      s.id,
    );
    expect(sched.length).toBeGreaterThan(0);
    await save(s, {
      schedule: [
        { id: sched[0]?.id, label: "First", trigger: "on_accept", pctBp: 4000 },
        { label: "Second", trigger: "delivery", pctBp: 6000 },
      ],
    });
    const two = await rows<J>(
      "SELECT label, pct_bp, amount_minor FROM payment_schedules WHERE document_id = ? ORDER BY position",
      s.id,
    );
    expect(two.map((r) => r.label)).toEqual(["First", "Second"]);
    const total =
      (await getDoc(s.o, s.id)).totals?.totalMinor ?? (await getDoc(s.o, s.id)).computed?.totalMinor;
    expect(two.reduce((a, r) => a + (r.amount_minor as number), 0)).toBe(total);
  });

  it("a save that changes nothing writes no child row", async () => {
    const s = await draftWith(3);
    const before = JSON.stringify(
      await rows("SELECT rowid, * FROM document_lines WHERE document_id = ? ORDER BY position", s.id),
    );
    await save(s, { lines: await asSent(s) });
    expect(
      JSON.stringify(
        await rows("SELECT rowid, * FROM document_lines WHERE document_id = ? ORDER BY position", s.id),
      ),
    ).toBe(before);
  });

  it("a stale save still leaves every child row as it was", async () => {
    const s = await draftWith(4);
    const before = JSON.stringify(
      await rows("SELECT rowid, * FROM document_lines WHERE document_id = ? ORDER BY position", s.id),
    );
    const sent = await asSent(s);
    sent.reverse();
    const res = await patchDoc(s.o, s.id, { expectedUpdatedAt: s.updatedAt - 1, lines: sent });
    expect(res.status).toBe(409);
    expect(
      JSON.stringify(
        await rows("SELECT rowid, * FROM document_lines WHERE document_id = ? ORDER BY position", s.id),
      ),
    ).toBe(before);
  });
});
