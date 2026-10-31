// Fixtures of the deed tests (T11): an accepted proposal behind a project with one issued invoice on it, the Owner's payment through the real route, the
// Schedules, finalise and the signed upload as the SPA sends them. Used by deeds.test.ts and the audit scenarios of rbac.test.ts. All names, references and
// amounts are invented test data.

import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { expect } from "vitest";
import { insert } from "./test-clients.ts";
import { call, one, type TestSession, withDb } from "./test-helpers.ts";
import { type J, json } from "./test-invoices.ts";
import { putDoc, recordBody, recorded } from "./test-payments.ts";
import { mkProject, PDF_BYTES } from "./test-projects.ts";
import { addDoc, mkReportClient } from "./test-reports.ts";

/** addDoc's default line (100,000 taxable at 18 %). */
export const DEED_TOTAL = 118_000;

let seq = 0;

export type DeedSetup = {
  clientId: string;
  proposalId: string;
  projectId: string;
  inv: { id: string; number: string };
};

/** A client, an ACCEPTED proposal of `total`, a project made from it (status `status`), and one issued invoice of DEED_TOTAL on the project. */
export async function mkDeedProject(
  o: { status?: string; total?: number; clientOver?: Record<string, unknown> } = {},
): Promise<DeedSetup> {
  const clientId = await mkReportClient("INR", o.clientOver ?? {});
  const proposalId = uuidv7();
  const n = 7_000 + ++seq;
  await insert("documents", {
    id: proposalId,
    type: "proposal",
    status: "accepted",
    client_id: clientId,
    currency: "INR",
    version_group_id: proposalId,
    version: 1,
    series: "proposal",
    fy: "2627",
    number: n,
    number_display: `TH/PRP/2627/${n}`,
    frozen_at: 1_000,
    decided_at: Date.parse("2026-10-05T11:00:00.000+05:30"),
    subtotal_minor: o.total ?? DEED_TOTAL,
    taxable_minor: o.total ?? DEED_TOTAL,
    total_minor: o.total ?? DEED_TOTAL,
    content_sha256: "c".repeat(64),
    snapshot_sha256: "s".repeat(64),
    updated_at: 1_000,
  });
  const project = await mkProject(clientId, { source_document_id: proposalId, status: o.status ?? "active" });
  const inv = await addDoc({ clientId, issueDate: "2026-10-05", over: { project_id: project.id } });
  return { clientId, proposalId, projectId: project.id, inv };
}

export const deedRowOf = (projectId: string) =>
  one<Record<string, unknown>>("SELECT * FROM deeds WHERE project_id = ?", projectId);

/** The Owner pays the whole invoice (one confirmed payment through the real route). */
export const payAll = (s: TestSession, clientId: string, invId: string): Promise<J> =>
  recorded(s, recordBody(clientId, DEED_TOTAL, [{ documentId: invId, amountMinor: DEED_TOTAL }]));

export const SCHEDULES = {
  deliverables: "Website source code and design files",
  location: "Git repository handed over",
  deliveredDates: "28 Oct 2026",
  tools: "None",
  thirdParty: "Astro (MIT licence)",
};

/** A completed project paid in full by `s` (an Owner with a fresh code): its draft deed. */
export async function draftDeed(s: TestSession): Promise<DeedSetup & { deedId: string }> {
  const f = await mkDeedProject({ status: "completed" });
  await payAll(s, f.clientId, f.inv.id);
  const deed = (await deedRowOf(f.projectId)) as { id: string } | null;
  expect(deed).toBeTruthy();
  return { ...f, deedId: (deed as { id: string }).id };
}

export const deedStamp = async (deedId: string) =>
  (await one<{ updated_at: number }>("SELECT updated_at FROM deeds WHERE id = ?", deedId))?.updated_at;

/** The body of a Schedules save at the deed's current version. */
export const schedulesBody = async (deedId: string, over: Record<string, unknown> = {}) => ({
  expectedUpdatedAt: await deedStamp(deedId),
  ...SCHEDULES,
  ...over,
});

export const putSchedules = async (s: TestSession, deedId: string, over: Record<string, unknown> = {}) =>
  call(`/deeds/${deedId}/schedules`, {
    cookie: s.cookie,
    method: "PUT",
    body: await schedulesBody(deedId, over),
  });

export const finaliseDeed = async (s: TestSession, deedId: string) =>
  call(`/deeds/${deedId}/finalise`, {
    cookie: s.cookie,
    body: { expectedUpdatedAt: await deedStamp(deedId) },
  });

/** A finalised deed (Schedules filled, numbered). */
export async function finalisedDeed(s: TestSession) {
  const f = await draftDeed(s);
  expect((await putSchedules(s, f.deedId)).status).toBe(200);
  const res = await finaliseDeed(s, f.deedId);
  expect(res.status, await res.clone().text()).toBe(200);
  return { ...f, answer: await json(res) };
}

/**
 * Early check 9: an `env` whose DB counts every statement a request runs (each statement of a batch counts one, as on D1 Free's 50 queries per invocation;
 * the same counter as payments.test.ts's).
 */
export function statementCounter() {
  let n = 0;
  const real = new WeakMap<object, D1PreparedStatement>();
  const counted = (t: D1PreparedStatement): D1PreparedStatement => {
    const p = new Proxy(t, {
      get(target, k) {
        if (k === "bind") return (...v: unknown[]) => counted(target.bind(...v));
        if (k === "first" || k === "run" || k === "all" || k === "raw")
          return (...a: unknown[]) => {
            n++;
            return (Reflect.get(target, k) as (...x: unknown[]) => unknown).apply(target, a);
          };
        return Reflect.get(target, k);
      },
    });
    real.set(p, t);
    return p;
  };
  const db = {
    prepare: (q: string) => counted(env.DB.prepare(q)),
    batch: (stmts: D1PreparedStatement[]) => {
      n += stmts.length;
      return env.DB.batch(stmts.map((s) => real.get(s) ?? s));
    },
  } as unknown as D1Database;
  return { env: withDb(db), count: () => n };
}

/** D1 Free: at most 50 queries per Worker invocation (a batch's statements each count). */
export const D1_FREE_QUERIES = 50;

/** The eSign moment as the provider shows it in IST, to the second: a second ago (after the finalise, never in the future). */
export const istNowText = () => new Date(Date.now() + 19_800_000 - 1_000).toISOString().slice(0, 19);

/** The signed upload as the SPA sends it: raw PDF bytes, the eSign facts in headers. */
export async function putSigned(
  s: TestSession,
  deedId: string,
  bytes: Uint8Array = PDF_BYTES,
  o: {
    name?: string;
    at?: string;
    txn?: string;
    length?: string;
    expected?: number;
    headers?: Record<string, string>;
  } = {},
) {
  return putDoc(`/deeds/${deedId}/signed`, bytes, {
    cookie: s.cookie,
    name: o.name ?? "signed.pdf",
    ...(o.length ? { length: o.length } : {}),
    headers: {
      "X-Expected-Updated-At": String(o.expected ?? (await deedStamp(deedId))),
      "X-Esign-At": encodeURIComponent(o.at ?? istNowText()),
      "X-Esign-Txn": encodeURIComponent(o.txn ?? "ESIGN-TXN-0042"),
      ...o.headers,
    },
  });
}
