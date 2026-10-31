// The client's open documents for the M6.1 money dialogs (ADM-PAY-05, ADM-PAY-06; re-check findings 1, 5 and 7): one paged loader that Record a payment, the
// Owner's Confirm step and the client's Use credit share. It reads the three open statuses (issued, partly paid, partly credited) and follows each list's
// `next` until it ends, stopping at `OPEN_DOCS_CAP` rows (the screen then says "Showing the first 500.", 07-M); rows are de-duplicated by id, and the
// documents come back in due-date order (`openDocsOf`).
//
// Confirm also reads, by id, every document Staff asked for that the lists didn't return (`confirmDocsOf`): such a request is never dropped. A document that
// can still take the payment becomes a row like any other; one that can't (gone, voided, another client's) is a refused row the Owner has to clear before
// Confirm. A failed read throws, so the screen shows its failed-load state and keeps Confirm disabled.
import type { Currency } from "../api.ts";
import { RequestError } from "../api.ts";
import { type InvoiceListQuery, type InvoiceListRow, type InvoiceView, invoicesApi } from "./invoices-api.ts";
import { askedDocOf, byDueDate, type OpenDoc, openDocsOf, payErrorText } from "./payments.ts";

/** At most this many list rows are read for one dialog (ten pages of 50); past it the screen says it shows the first ones. */
export const OPEN_DOCS_CAP = 500;
/** The statuses an open document can have; each is read as its own keyset list. */
export const OPEN_STATUSES = ["issued", "partially_paid", "partially_credited"] as const;

type ListFn = (q: InvoiceListQuery) => Promise<{ invoices: InvoiceListRow[]; next: string | null }>;
type GetFn = (id: string) => Promise<InvoiceView>;

/** Every open-status row of the client (any type: callers filter with `openDocsOf`), de-duplicated, at most `cap` rows read; `capped` when more were left. */
export async function loadOpenRows(
  clientId: string,
  list: ListFn = invoicesApi.list,
  cap = OPEN_DOCS_CAP,
): Promise<{ rows: InvoiceListRow[]; capped: boolean }> {
  let read = 0;
  let capped = false;
  const byStatus = await Promise.all(
    OPEN_STATUSES.map(async (status) => {
      const out: InvoiceListRow[] = [];
      let after: string | null = null;
      do {
        if (read >= cap) {
          capped = true;
          break;
        }
        const page: { invoices: InvoiceListRow[]; next: string | null } = await list({
          clientId,
          status,
          limit: "50",
          ...(after ? { after } : {}),
        });
        read += page.invoices.length;
        out.push(...page.invoices);
        // an empty page ends the list even if it names a next one (re-check finding 6's rule, here too)
        after = page.invoices.length > 0 ? page.next : null;
      } while (after);
      return out;
    }),
  );
  const seen = new Set<string>();
  const rows: InvoiceListRow[] = [];
  for (const r of byStatus.flat()) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push(r);
  }
  // sorted before the cut, so a capped list keeps the earliest due across all three statuses (second re-check low 1)
  return { rows: byDueDate(rows).slice(0, cap), capped: capped || rows.length > cap };
}

/** The open documents a payment can go on (or a TDS entry, or credit), in due-date order, with whether the read stopped at the cap. */
export async function loadOpenDocs(
  clientId: string,
  opts: { kind: "payment" | "tds"; proformas: boolean },
  list: ListFn = invoicesApi.list,
): Promise<{ docs: (OpenDoc & { updatedAt: number })[]; capped: boolean }> {
  const { rows, capped } = await loadOpenRows(clientId, list);
  const stamp = new Map(rows.map((r) => [r.id, r.updatedAt]));
  return {
    docs: openDocsOf(rows, opts).map((d) => ({ ...d, updatedAt: stamp.get(d.id) ?? 0 })),
    capped,
  };
}

/** A requested document the Owner can't confirm the payment on, with why (a row the Owner clears before Confirm). */
export type RefusedDoc = { id: string; number: string | null; type: string | null; error: string };

export type ConfirmDocs =
  /** The request names a proforma: its tax invoice for the payment received confirms it (L5, line 12). */
  | { kind: "proforma"; id: string }
  | { kind: "ready"; docs: OpenDoc[]; refused: RefusedDoc[]; capped: boolean };

/** A refusal that names the document itself (gone, not this person's to see): the row says so. Anything else (offline, a server error) is a failed read. */
const refusedAnswer = (e: unknown) =>
  e instanceof RequestError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.code !== "network";

/**
 * What the Confirm step offers: every open document of the client, plus every document Staff asked for that the lists didn't return (past the first pages, or
 * past the cap), read by id. Nothing asked for is dropped: each is a row, prefilled by the caller with the amount asked, or a refused row with its reason.
 */
export async function confirmDocsOf(
  payment: { clientId: string; currency: Currency; requestedAllocations: readonly { documentId: string }[] },
  deps: { list?: ListFn; get?: GetFn } = {},
): Promise<ConfirmDocs> {
  const list = deps.list ?? invoicesApi.list;
  const get = deps.get ?? invoicesApi.get;
  const { rows, capped } = await loadOpenRows(payment.clientId, list);
  const asked = [...new Set(payment.requestedAllocations.map((a) => a.documentId))];
  // a request that names a proforma: its advance confirms it (L5)
  const listedProforma = rows.find((d) => d.type === "proforma" && asked.includes(d.id));
  if (listedProforma) return { kind: "proforma", id: listedProforma.id };
  const docs = openDocsOf(rows, { kind: "payment", proformas: false });
  const refused: RefusedDoc[] = [];
  const extra: OpenDoc[] = [];
  const missing = asked.filter((id) => !docs.some((d) => d.id === id));
  const answers = await Promise.all(
    missing.map((id) =>
      get(id).then(
        (view) => ({ id, view }) as const,
        (error: unknown) => {
          if (refusedAnswer(error)) return { id, error } as const;
          throw error;
        },
      ),
    ),
  );
  for (const a of answers) {
    if ("error" in a) {
      refused.push({ id: a.id, number: null, type: null, error: payErrorText(a.error) });
      continue;
    }
    const v = a.view;
    if (v.type === "proforma" && (OPEN_STATUSES as readonly string[]).includes(v.status))
      return { kind: "proforma", id: v.id };
    const r = askedDocOf(v, payment);
    if (r.ok) extra.push(r.doc);
    else refused.push({ id: v.id, number: v.number, type: v.type, error: r.error });
  }
  // The rows Staff asked for come first, in the order asked, so the Owner sees the request without scrolling; the rest in due-date order.
  const all = byDueDate([...docs, ...extra]);
  const first = asked.flatMap((id) => all.filter((d) => d.id === id));
  return { kind: "ready", docs: [...first, ...all.filter((d) => !asked.includes(d.id))], refused, capped };
}
