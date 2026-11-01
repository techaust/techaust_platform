// The organisation's signed deeds of assignment in the portal (T11; run file docs/runs/t11-deed.md, L4, L5; POR-05, POR-03; 08-C RB-38(a)): only a SIGNED deed
// is listed or downloaded; a draft, a final or a cancelled one, another organisation's and a made-up id are one and the same 404; the PDF is named in the body.
// Owner's decision (2026-11-01, review M4): finance contacts only (portal access and "can see finance"), in the route table and in every query. Review L2: the
// list is read for one accepted version.
// All names, numbers and amounts are invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { DEED_PDF_SQL, DEEDS_LIST_SQL, FINANCE_CONTACT_SQL } from "./deeds.ts";
import { type Fixtures, fixtures } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import app from "./index.ts";
import { bodyOf, call, crossTenant, one, sessionFor } from "./test-helpers.ts";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
let seq = 0;

/** A deed of organisation `clientId` in `status`, behind an accepted proposal and a completed project, with its signed PDF in DOCS when signed. */
async function mkDeed(clientId: string, status: "draft" | "final" | "signed" | "cancelled") {
  const n = 8_000 + ++seq;
  const proposal = uuidv7();
  const project = uuidv7();
  const deed = uuidv7();
  const staff = uuidv7();
  const db = env.DB;
  await db.batch([
    db
      .prepare(
        "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Owner', 'owner', 'active')",
      )
      .bind(staff, `${staff}@example.test`),
    db
      .prepare(
        "INSERT INTO documents (id, type, status, client_id, currency, version_group_id, version, series, fy, number, number_display, frozen_at, decided_at, total_minor, content_sha256) VALUES (?1, 'proposal', 'accepted', ?2, 'INR', ?1, 1, 'proposal', '2627', ?3, ?4, 1000, 2000, 118000, 'c')",
      )
      .bind(proposal, clientId, n, `TH/PRP/2627/${n}`),
    db
      .prepare(
        "INSERT INTO projects (id, code, client_id, name, status, currency, source_document_id) VALUES (?1, ?2, ?3, 'Website', 'completed', 'INR', ?4)",
      )
      .bind(project, `PRJ-P${n}`, clientId, proposal),
    db
      .prepare(
        "INSERT INTO deeds (id, client_id, project_id, source_document_id, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'draft', 1, 1)",
      )
      .bind(deed, clientId, project, proposal),
  ]);
  await db
    .prepare(
      "UPDATE deeds SET sched_deliverables = 'a', sched_location = 'b', sched_delivered_dates = 'c', sched_tools = 'None', sched_third_party = 'None' WHERE id = ?1",
    )
    .bind(deed)
    .run();
  if (status === "cancelled")
    await db
      .prepare(
        "UPDATE deeds SET status = 'cancelled', cancelled_at = 5, cancelled_by = ?2, cancel_reason = 'x' WHERE id = ?1",
      )
      .bind(deed, staff)
      .run();
  if (status === "final" || status === "signed")
    await db
      .prepare(
        "UPDATE deeds SET status = 'final', fy = '2627', number = ?2, number_display = ?3, made_on = '2026-11-01', snapshot = '{}', snapshot_sha256 = 's', finalised_at = 10, finalised_by = ?4 WHERE id = ?1",
      )
      .bind(deed, n, `TH/DA/2627/${n}`, staff)
      .run();
  if (status === "signed") {
    const key = `deeds/${deed}/signed-${"a".repeat(64)}`;
    await env.DOCS.put(key, PDF);
    await db
      .prepare(
        "UPDATE deeds SET status = 'signed', signed_r2_key = ?2, signed_sha256 = ?3, signed_size = ?4, esign_at = ?5, esign_txn = 'ESIGN-77', signed_at = ?5, signed_by = ?6 WHERE id = ?1",
      )
      .bind(deed, key, "a".repeat(64), PDF.byteLength, Date.parse("2026-11-03T14:05:00.000+05:30"), staff)
      .run();
  }
  return { deed, proposal, number: `TH/DA/2627/${n}` };
}

type DeedFx = Fixtures & { mine: string; mineProposal: string; theirs: string; hidden: string[] };
async function deedFixtures(): Promise<DeedFx> {
  const f = await fixtures();
  const signed = await mkDeed(f.a.id, "signed");
  const mine = signed.deed;
  const theirs = (await mkDeed(f.b.id, "signed")).deed;
  const hidden = [
    (await mkDeed(f.a.id, "draft")).deed,
    (await mkDeed(f.a.id, "final")).deed,
    (await mkDeed(f.a.id, "cancelled")).deed,
  ];
  return { ...f, mine, mineProposal: signed.proposal, theirs, hidden };
}

describe("the routes [POR-05]", () => {
  it("are declared for finance contacts only (owner, 2026-11-01); every query holds the rule too; the PDF is a POST naming the deed in the body", () => {
    expect(ROUTES.find((r) => r.path === "/api/v1/deeds")).toMatchObject({
      method: "GET",
      access: "finance",
    });
    expect(ROUTES.find((r) => r.path === "/api/v1/deeds/pdf")).toMatchObject({
      method: "POST",
      access: "finance",
    });
    expect(DEEDS_LIST_SQL).toMatch(
      /d\.client_id = \?1 AND d\.source_document_id = \?3 AND d\.status = 'signed'/,
    );
    expect(DEED_PDF_SQL).toMatch(/d\.client_id = \?1 AND d\.id = \?3 AND d\.status = 'signed'/);
    for (const sql of [DEEDS_LIST_SQL, DEED_PDF_SQL]) expect(sql).toContain(FINANCE_CONTACT_SQL);
    expect(FINANCE_CONTACT_SQL).toMatch(
      /fc\.portal_access = 1 AND fc\.can_see_finance = 1 AND fc\.anonymised_at IS NULL/,
    );
  });

  it("lists only this organisation's signed deeds of the version asked for, with the accepted version and the eSign details", async () => {
    const f = await deedFixtures();
    const s = await sessionFor(f.a.finance);
    const res = await call(`/deeds?document=${f.mineProposal}`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deeds: Record<string, unknown>[] };
    expect(body.deeds.map((d) => d.id)).toEqual([f.mine]);
    expect(body.deeds[0]).toMatchObject({
      offer: { type: "proposal", version: 1 },
      esignMoment: "03 Nov 2026, 14:05 IST",
      esignTxn: "ESIGN-77",
      signatureLine:
        "Signed by the assignor with an Aadhaar-based electronic signature (eSign): Rupak Sarkar, sole proprietor, TecHaust Technologies · 03 Nov 2026, 14:05 IST · ESIGN-77.",
    });
    const proposal = await one<{ source_document_id: string }>(
      "SELECT source_document_id FROM deeds WHERE id = ?",
      f.mine,
    );
    expect(body.deeds[0]?.sourceDocumentId).toBe(proposal?.source_document_id);
  });

  it("reads one version only (review L2): another version's list is empty; a missing or malformed version is 400", async () => {
    const f = await deedFixtures();
    const s = await sessionFor(f.a.finance);
    const other = await call(`/deeds?document=${f.a.docs.proposal}`, { cookie: s.cookie });
    expect(other.status).toBe(200);
    expect(((await other.json()) as { deeds: unknown[] }).deeds).toEqual([]);
    expect((await call("/deeds", { cookie: s.cookie })).status).toBe(400);
    expect((await call("/deeds?document=a%20b", { cookie: s.cookie })).status).toBe(400);
    expect((await call(`/deeds?document=${"x".repeat(65)}`, { cookie: s.cookie })).status).toBe(400);
  });

  it("a contact without finance gets the plain 404 for the list and the PDF of their own organisation's signed deed (owner, 2026-11-01)", async () => {
    const f = await deedFixtures();
    const plain = await sessionFor(f.a.plain);
    const finance = await sessionFor(f.a.finance);
    const miss = await call("/deeds/pdf", { cookie: finance.cookie, body: { id: `no-such-${uuidv7()}` } });
    const list = await call(`/deeds?document=${f.mineProposal}`, { cookie: plain.cookie });
    expect(list.status).toBe(404);
    const pdf = await call("/deeds/pdf", { cookie: plain.cookie, body: { id: f.mine } });
    expect(pdf.status).toBe(404);
    const missBody = await bodyOf(miss);
    expect(await bodyOf(list)).toEqual(missBody);
    expect(await bodyOf(pdf)).toEqual(missBody);
  });

  it("the queries themselves hold the rule: bound with a contact without finance (or without portal access) they find nothing", async () => {
    const f = await deedFixtures();
    const list = (contact: string) =>
      env.DB.prepare(DEEDS_LIST_SQL).bind(f.a.id, contact, f.mineProposal).all();
    const pdf = (contact: string) => env.DB.prepare(DEED_PDF_SQL).bind(f.a.id, contact, f.mine).first();
    expect((await list(f.a.finance.id)).results).toHaveLength(1);
    expect(await pdf(f.a.finance.id)).not.toBeNull();
    // Finance on, but no portal access; finance on, but anonymised.
    const [noPortal, gone] = [uuidv7(), uuidv7()];
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance) VALUES (?1, ?2, 'No Portal', ?3, 0, 1)",
      ).bind(noPortal, f.a.id, `${noPortal}@example.test`),
      env.DB.prepare(
        "INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance, anonymised_at) VALUES (?1, ?2, 'Gone', ?3, 1, 1, 1)",
      ).bind(gone, f.a.id, `${gone}@example.test`),
    ]);
    for (const c of [f.a.plain.id, noPortal, gone, f.b.finance.id]) {
      expect((await list(c)).results).toHaveLength(0);
      expect(await pdf(c)).toBeNull();
    }
  });

  it("serves the signed PDF; a bad body is 400", async () => {
    const f = await deedFixtures();
    const s = await sessionFor(f.a.finance);
    const res = await call("/deeds/pdf", { cookie: s.cookie, body: { id: f.mine } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/TH-DA-2627-\d+-signed\.pdf/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    expect(
      (await call("/deeds/pdf", { cookie: s.cookie, body: { id: f.mine, clientId: f.b.id } })).status,
    ).toBe(400);
  });
});

describe("cross-tenant: another organisation's, a missing, a draft, a final and a cancelled deed are one 404 [POR-03]", () => {
  crossTenant(
    app,
    [
      {
        name: "POST /deeds/pdf",
        request: (id) => ({ path: "/deeds/pdf", init: { body: { id } } }),
        finance: true,
        hidden: (f) => (f as DeedFx).hidden,
      },
    ],
    deedFixtures,
    (f) => (f as DeedFx).mine,
    (f) => (f as DeedFx).theirs,
  );
});
