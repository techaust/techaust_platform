// Test data of the offer routes (M4.5): sent, rendered proposals and estimates written straight to the database, with the frozen
// snapshot and the PDF in the local R2 bucket. The snapshot text is test-shaped (`{view, secrets}`): the injected viewer projects `view` only,
// so a test can prove the stored extras (catalogue rates, hidden sections, the sender's staff id) never reach the client.
import { env } from "cloudflare:workers";
import { newToken, tokenHash } from "@techaust/auth";
import { uuidv7 } from "@techaust/core";
import { todayIst } from "@techaust/core/offers";
import { pdfKeys } from "@techaust/core/pdf-jobs";
import type { FxContact, FxOrg } from "./fixtures.ts";
import type { OfferViewer } from "./offer-core.ts";

export const DAY = 86_400_000;
let seq = 0;

/** The projection the tests inject: the stored text's `view`. */
export const testViewer: OfferViewer = (text) => (JSON.parse(text) as { view: unknown }).view;

export const SECRETS = {
  catalogueRateMinor: 777_001,
  catalogueItemId: "cat-secret-item",
  staffId: "staff-secret-id",
  hidden: true,
};

export type Offer = {
  id: string;
  groupId: string;
  clientId: string;
  version: number;
  number: number;
  numberDisplay: string;
  pdfKey: string;
  snapshotKey: string;
  view: { title: string; marker: string };
};

export type OfferOpts = {
  type?: "proposal" | "estimate";
  status?: string;
  /** Days from today (IST) until `valid_until`; negative = in the past. */
  validInDays?: number;
  /** false: sent but the PDF is not rendered yet. */
  rendered?: boolean;
  groupId?: string;
  version?: number;
  number?: number;
  title?: string;
  total?: number;
  contactId?: string | null;
};

const istDay = (offset: number) => todayIst(Date.now() + offset * DAY);

/** A frozen, sent offer of `org`. A later version of a group passes `groupId` and `version`. */
export async function mkOffer(org: Pick<FxOrg, "id">, o: OfferOpts = {}): Promise<Offer> {
  const id = uuidv7();
  const type = o.type ?? "proposal";
  const number = o.number ?? 900 + ++seq;
  const version = o.version ?? 1;
  const groupId = o.groupId ?? id;
  const fy = "2026-27";
  const keys = pdfKeys({ type, fy, number, version });
  const numberDisplay = `TH/${type === "proposal" ? "PRP" : "EST"}/2627/${String(number).padStart(4, "0")}`;
  const draft = o.status === "draft";
  const rendered = o.rendered ?? true;
  const view = { title: o.title ?? `Offer ${number}`, marker: `view-${id}` };
  if (rendered) {
    await env.DOCS.put(keys.snapshot, JSON.stringify({ view, secrets: SECRETS }));
    await env.DOCS.put(keys.pdf, `%PDF-1.4 sample ${id}`);
  }
  await env.DB.prepare(
    "INSERT INTO documents (id, type, status, client_id, currency, version_group_id, version, series, fy, number, number_display, valid_until, title, total_minor, subtotal_minor, taxable_minor, snapshot_r2_key, snapshot_sha256, pdf_r2_key, pdf_sha256, frozen_at, sent_at, contact_id) VALUES (?1, ?2, ?3, ?4, 'INR', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?13, ?14, ?15, ?16, ?17, ?18, ?18, ?19)",
  )
    .bind(
      id,
      type,
      o.status ?? "sent",
      org.id,
      groupId,
      version,
      type,
      draft ? null : "2627",
      draft ? null : number,
      draft ? null : numberDisplay,
      istDay(o.validInDays ?? 14),
      view.title,
      o.total ?? 118_000_00,
      rendered ? keys.snapshot : null,
      rendered ? `snap-${id}` : null,
      rendered ? keys.pdf : null,
      rendered ? `pdfsha-${id}-${"0".repeat(20)}` : null,
      draft ? null : Date.now() - DAY,
      o.contactId ?? null,
    )
    .run();
  return {
    id,
    groupId,
    clientId: org.id,
    version,
    number,
    numberDisplay,
    pdfKey: keys.pdf,
    snapshotKey: keys.snapshot,
    view,
  };
}

/** Another contact of the organisation with portal access (for the double-accept and replay tests). */
export async function colleague(org: Pick<FxOrg, "id">, name = "Colleague"): Promise<FxContact> {
  const id = uuidv7();
  const email = `${name.toLowerCase()}-${id.slice(-6)}@example.test`;
  await env.DB.prepare(
    "INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance) VALUES (?1, ?2, ?3, ?4, 1, 0)",
  )
    .bind(id, org.id, name, email)
    .run();
  return { id, clientId: org.id, email, name, finance: false };
}

/** A live offer link (the real table), returns the raw token. The address is the contact's, lower-cased. */
export async function mkLink(
  offer: Offer,
  contact: FxContact,
  o: { purpose?: string; expiresIn?: number; revoked?: boolean; email?: string } = {},
): Promise<string> {
  const token = newToken();
  await env.DB.prepare(
    "INSERT INTO offer_links (token_hash, document_id, version_group_id, client_id, contact_id, email, purpose, expires_at, revoked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
  )
    .bind(
      await tokenHash(token),
      offer.id,
      offer.groupId,
      offer.clientId,
      contact.id,
      (o.email ?? contact.email).toLowerCase(),
      o.purpose ?? "offer",
      Date.now() + (o.expiresIn ?? 30 * DAY),
      o.revoked ? Date.now() : null,
    )
    .run();
  return token;
}

export const uuid = uuidv7;
