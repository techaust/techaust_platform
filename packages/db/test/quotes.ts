// Fixtures of the proposal and estimate tests (M4.3): a draft, its send batch, and an approval, written straight to the database.
import { env } from "cloudflare:workers";
import { defaultFormat, sqlPrintfPattern, uuidv7 } from "@techaust/core";
import { sendStatements } from "../src/issue.ts";
import { insertClient, run } from "./helpers.ts";

export const FY = "2627";
export const PROPOSAL_PATTERN = sqlPrintfPattern(defaultFormat("proposal"));
export const ESTIMATE_PATTERN = sqlPrintfPattern(defaultFormat("estimate"));

/** A staff member (approvals and sends name one). Made once per test file. */
let staff: string | undefined;
export async function staffId(): Promise<string> {
  if (!staff) {
    staff = uuidv7();
    await run(
      "INSERT INTO staff_users (id, email, name, role) VALUES (?1, ?2, 'Sender', 'owner')",
      staff,
      `${staff}@example.com`,
    );
  }
  return staff;
}

export type Quote = {
  id: string;
  groupId: string;
  clientId: string;
  type: "proposal" | "estimate";
  version: number;
};

/** A draft proposal or estimate. A new group by default; `groupId` makes it a later version of that group. */
export async function mkQuote(
  over: {
    clientId?: string;
    type?: "proposal" | "estimate";
    groupId?: string;
    version?: number;
    updatedAt?: number;
    contentSha256?: string;
    currency?: string;
  } = {},
): Promise<Quote> {
  const id = uuidv7();
  const type = over.type ?? "proposal";
  const clientId = over.clientId ?? (await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`));
  const groupId = over.groupId ?? id;
  const version = over.version ?? 1;
  await run(
    "INSERT INTO documents (id, type, client_id, currency, version_group_id, version, content_sha256, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    id,
    type,
    clientId,
    over.currency ?? "INR",
    groupId,
    version,
    over.contentSha256 ?? `hash-${id}`,
    over.updatedAt ?? 1_000,
  );
  return { id, groupId, clientId, type, version };
}

type SendOver = {
  now?: number;
  fy?: string;
  updatedAt?: number;
  contentSha256?: string;
  numberingVersion?: number | null;
  approvalNeeded?: boolean;
  /** Skip the unguarded `issue_result` (to prove what it protects). */
  skipPostAudit?: boolean;
};

/** The statements of a send, `main` then `postAudit` (the admin writes its audit row between them). */
export async function sendBatch(q: Quote, over: SendOver = {}) {
  const pattern = q.type === "proposal" ? PROPOSAL_PATTERN : ESTIMATE_PATTERN;
  const s = sendStatements(env.DB, {
    documentId: q.id,
    series: q.type,
    fy: over.fy ?? FY,
    pattern: pattern.pattern,
    argOrder: pattern.argOrder,
    isFirstVersion: q.version === 1,
    groupId: q.groupId,
    version: q.version,
    now: over.now ?? 5_000,
    issueDate: "2026-10-25",
    validUntil: "2026-11-09",
    recipient: { legalName: "Example Traders", country: "IN" },
    issuer: {
      company: { tradeName: "TecHaust", legalName: null, address: null, gstin: null, stateCode: "19" },
      sender: { staffId: "staff-1", name: "Rupak", email: "contact@example.com" },
    },
    computedJson: "{}",
    snapshotSha256: "snap",
    issuedBy: await staffId(),
    expected: {
      updatedAt: over.updatedAt ?? 1_000,
      contentSha256: over.contentSha256 ?? `hash-${q.id}`,
      numberingVersion: over.numberingVersion ?? null,
      approvalNeeded: over.approvalNeeded ?? false,
    },
  });
  return over.skipPostAudit ? s.main : [...s.main, ...s.postAudit];
}

export const send = async (q: Quote, over: SendOver = {}) => env.DB.batch(await sendBatch(q, over));

/** A draft made, then sent. */
export async function sentQuote(over: Parameters<typeof mkQuote>[0] = {}, sendOver: SendOver = {}) {
  const q = await mkQuote(over);
  await send(q, sendOver);
  return q;
}

export async function mkApproval(
  documentId: string,
  contentSha256: string,
  status = "pending",
): Promise<string> {
  const id = uuidv7();
  const requestedBy = await staffId();
  await run(
    "INSERT INTO approvals (id, kind, document_id, requested_by, content_sha256, status) VALUES (?1, 'discount', ?2, ?3, ?4, ?5)",
    id,
    documentId,
    requestedBy,
    contentSha256,
    status,
  );
  return id;
}
