// Fixtures of the payment tests (M6.1): an issued invoice to pay, a record body as the SPA sends it, the Owner's and a Staff member's entries through the
// real routes, and a raw PUT for proofs and letters. All names, references and amounts are invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { issueDateOf } from "@techaust/core/invoices";
import { call, ORIGIN, one, send, type TestSession } from "./test-helpers.ts";
import { type J, json } from "./test-invoices.ts";
import { sha256Hex } from "./test-projects.ts";

export const today = () => issueDateOf(Date.now());

let refSeq = 0;
/** A bank reference no other test has used. */
export const ref = () => `UTR${Date.now().toString(36).toUpperCase()}${++refSeq}`;

/** A record body for money received, put whole or in part on `documentId` (none: kept as credit). */
export function recordBody(
  clientId: string,
  amountMinor: number,
  allocations: { documentId: string; amountMinor: number }[] = [],
  over: Record<string, unknown> = {},
) {
  return {
    id: uuidv7(),
    clientId,
    kind: "payment",
    currency: "INR",
    amountMinor,
    receivedOn: today(),
    mode: "neft",
    reference: ref(),
    allocations,
    ...over,
  };
}

/** A TDS body: whole onto one invoice. */
export function tdsBody(
  clientId: string,
  documentId: string,
  amountMinor: number,
  over: Record<string, unknown> = {},
) {
  return {
    id: uuidv7(),
    clientId,
    kind: "tds",
    currency: "INR",
    amountMinor,
    receivedOn: today(),
    allocations: [{ documentId, amountMinor }],
    tds: { section: "as the client's advice says", rateBp: 1000 },
    ...over,
  };
}

export const record = (s: TestSession, body: unknown) => call("/payments", { cookie: s.cookie, body });

/** Records and expects 201; returns the answer. */
export async function recorded(s: TestSession, body: Record<string, unknown>): Promise<J> {
  const res = await record(s, body);
  if (res.status !== 201) throw new Error(`could not record: ${res.status} ${await res.text()}`);
  return json(res);
}

export const paymentRow = (id: string) =>
  one<Record<string, unknown>>("SELECT * FROM payments WHERE id = ?", id) as Promise<Record<string, unknown>>;

export const ledgerOf = async (id: string) =>
  (await one<{
    status: string;
    paid_minor: number;
    tds_minor: number;
    credited_minor: number;
    balance_minor: number;
    total_minor: number;
    updated_at: number;
  }>(
    "SELECT status, paid_minor, tds_minor, credited_minor, balance_minor, total_minor, updated_at FROM documents WHERE id = ?",
    id,
  )) as {
    status: string;
    paid_minor: number;
    tds_minor: number;
    credited_minor: number;
    balance_minor: number;
    total_minor: number;
    updated_at: number;
  };

/** The Owner's check of a pending entry, read at its own `recorded_at`. */
export async function verify(
  s: TestSession,
  id: string,
  decision: "confirm" | "reject",
  over: Record<string, unknown> = {},
) {
  const row = await paymentRow(id);
  return call(`/payments/${id}/verify`, {
    cookie: s.cookie,
    body: { decision, expectedRecordedAt: row?.recorded_at, ...over },
  });
}

/** A raw PUT of a proof or a letter, as the SPA's XMLHttpRequest sends it. */
export async function putDoc(
  path: string,
  bytes: Uint8Array,
  o: {
    cookie: string;
    name?: string;
    sha?: string;
    headers?: Record<string, string>;
    length?: string;
    e?: Env;
  },
) {
  return send(
    `${ORIGIN}/api/v1${path}`,
    {
      method: "PUT",
      headers: {
        Origin: ORIGIN,
        Cookie: o.cookie,
        "Content-Type": "application/octet-stream",
        "Content-Length": o.length ?? String(bytes.byteLength),
        "X-File-Name": encodeURIComponent(o.name ?? "advice.pdf"),
        "X-File-Sha256": o.sha ?? (await sha256Hex(bytes)),
        ...o.headers,
      },
      body: bytes,
    },
    o.e ?? env,
  );
}
