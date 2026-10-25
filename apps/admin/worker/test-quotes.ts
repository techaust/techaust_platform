// Fixtures of the proposal and estimate tests (M4.3): proposal terms, a client with a contact, a service, and short helpers that make a draft through
// the API as the SPA would, so the tests exercise the routes and not the tables.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { mkItem } from "./test-catalogue.ts";
import { insert, mkClient, mkContact } from "./test-clients.ts";
import { call, one, type TestSession } from "./test-helpers.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
export type J = Record<string, any>;
export const json = async (res: Response): Promise<J> => (await res.json()) as J;
export const codeOf = async (res: Response): Promise<string> => ((await res.json()) as J).error?.code;

/** The newest proposal terms. A draft pins the newest when it is made, so make them before the drafts of a file. */
export async function mkTerms(): Promise<string> {
  const n =
    ((await one<{ v: number | null }>("SELECT max(version) AS v FROM terms_versions WHERE kind = 'proposal'"))
      ?.v ?? 0) + 1;
  const id = uuidv7();
  await insert("terms_versions", {
    id,
    kind: "proposal",
    version: n,
    body_md: `Terms version ${n}`,
    sha256: `sha-${n}`,
  });
  return id;
}

/** An INR business client in West Bengal with a primary contact (intra-state tax with the default company state 19). */
export async function mkQuoteClient(over: Record<string, unknown> = {}) {
  const clientId = await mkClient({ gst_status: "unregistered", state_code: "19", ...over });
  const contact = await mkContact(clientId, { is_primary: 1, name: "Asha Rao" });
  return { clientId, contactId: contact.id, email: contact.email };
}

/** A catalogue item priced `price` paise (and 1/10 of it in cents), 100 % on acceptance. */
export async function mkService(price = 100_000, over: Record<string, unknown> = {}) {
  return mkItem({ price_inr_minor: price, price_usd_minor: Math.floor(price / 10), ...over });
}

export type Made = { id: string; updatedAt: number; clientId: string; itemId: string; contactId: string };

/** A draft made through POST /documents for a fresh client and service. */
export async function mkDraft(
  s: TestSession,
  opts: {
    type?: "proposal" | "estimate";
    price?: number;
    clientId?: string;
    contactId?: string;
    item?: { id: string };
  } = {},
): Promise<Made> {
  const client = opts.clientId
    ? { clientId: opts.clientId, contactId: opts.contactId }
    : await mkQuoteClient();
  const item = opts.item ?? (await mkService(opts.price));
  const res = await call("/documents", {
    cookie: s.cookie,
    body: {
      type: opts.type ?? "proposal",
      clientId: client.clientId,
      ...(client.contactId ? { contactId: client.contactId } : {}),
      services: [{ catalogueItemId: item.id }],
    },
  });
  if (res.status !== 201) throw new Error(`could not make a draft: ${res.status} ${await res.text()}`);
  const body = await json(res);
  return {
    id: body.id,
    updatedAt: body.updatedAt,
    clientId: client.clientId,
    itemId: item.id,
    contactId: client.contactId ?? "",
  };
}

export const getDoc = async (s: TestSession, id: string) =>
  json(await call(`/documents/${id}`, { cookie: s.cookie }));

export const patchDoc = (s: TestSession, id: string, body: unknown) =>
  call(`/documents/${id}`, { method: "PATCH", cookie: s.cookie, body });

export const sendDoc = (s: TestSession, id: string, expectedUpdatedAt: number) =>
  call(`/documents/${id}/send`, { cookie: s.cookie, body: { expectedUpdatedAt } });

/** Set a document discount through a save; returns the saved document. */
export async function discount(s: TestSession, id: string, kind: "fixed" | "percent", value: number) {
  const doc = await getDoc(s, id);
  const res = await patchDoc(s, id, {
    expectedUpdatedAt: doc.updatedAt,
    fields: { discount: { kind, value } },
  });
  if (res.status !== 200) throw new Error(`discount: ${res.status} ${await res.text()}`);
  return json(res);
}

export const counter = async (series = "proposal") => {
  const row = await one<{ next_no: number }>(
    "SELECT next_no FROM doc_counters WHERE series = ?1 ORDER BY fy DESC LIMIT 1",
    series,
  );
  return row?.next_no ?? 1;
};

export const dbRow = (id: string) =>
  one<Record<string, unknown>>(
    "SELECT status, version, series, fy, number, number_display, frozen_at, valid_until, issue_date FROM documents WHERE id = ?1",
    id,
  );

export { env };
