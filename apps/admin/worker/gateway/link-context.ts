// What every payment link starts with, whatever the gateway (M6.2's `makeLink` prefix, made generic in M6.3; run file C `PortalPayments`, early check 1 "What B2 must
// not forget" 1 to 3): ONE read batch (the document and its client, the actor, the open checkout, Settings › Payment terms and Gateways, the client's links of the
// last hour, and whether a gateway payment still waits on the document), then every rule from the ids alone: the contact or the emailed link may pay this
// document, the document is payable online through THIS gateway (core `payableOnline` with its row of the rule table, the online maximum and the waiting payment),
// the amount is within the bounds (core `payAmountVerdict`: the provider's floor, its maximum, whole rupees only on a Razorpay proforma). Staff never make a card
// link (L7: `use_portal`). Nothing is written and no gateway is called here.
import type { CreateLinkResult } from "@techaust/core/gateway-rpc";
import { payAmountVerdict, payableOnline } from "@techaust/core/online-pay";
import {
  DOCUMENT_CLIENT_LINKS_SINCE_SQL,
  LINKS_PER_CLIENT_HOUR,
  OPEN_CHECKOUT_SQL,
} from "@techaust/db/gateway";
import type { RequestInfo } from "@techaust/db/log";
import { gatewayPaymentPendingSql } from "@techaust/db/sql-rules";
import { cachedSetting } from "../settings-cache.ts";
import { type CheckoutRow, DOC_STATE_SQL, type GatewayEnv } from "./settle.ts";

export type LinkActor =
  | { kind: "contact"; contactId: string }
  | { kind: "token"; tokenHash: string }
  | { kind: "staff"; memberId: string; role: "owner" | "staff" };

export type MakeLinkArgs = {
  provider: "razorpay" | "stripe";
  clientId: string | null;
  documentId: string;
  amountMinor: number;
  actor: LinkActor;
  returnTo: "invoice" | "pay_return";
  /** The staff route's stale check (`expectedUpdatedAt` of the document as the member saw it). */
  expectedUpdatedAt?: number;
  request?: RequestInfo;
};

export type MakeLinkResult =
  | (CreateLinkResult & { ok: true; checkoutId: string })
  | (Extract<CreateLinkResult, { ok: false }> & { stale?: boolean });

export type DocRow = {
  id: string;
  client_id: string;
  type: string;
  status: string;
  frozen_at: number | null;
  currency: string;
  balance_minor: number;
  number_display: string | null;
  updated_at: number;
  withdrawn: number;
  anonymised_at: number | null;
  country: string;
  gst_status: string;
};

/** Everything a gateway's own flow needs once the shared rules have passed. */
export type LinkContext = {
  doc: DocRow;
  clientId: string;
  /** The open (`creating` or `live`) checkout of the document, if any. */
  open: CheckoutRow | undefined;
  /** The client made `LINKS_PER_CLIENT_HOUR` links in the last hour (checked before any link is cancelled). */
  limited: boolean;
  /** The contact the link is made for (the signed-in one, or the emailed link's), null for staff. */
  linkContactId: string | null;
  actorOf: RequestInfo & {
    actorType: "staff" | "contact";
    actorId: string | null;
    role: "owner" | "staff" | null;
  };
  floorMinor: number;
  /** The online maximum (Stripe: `overseasOnlineMaxUsdMinor`, L9), or null: none (Razorpay). */
  maxMinor: number | null;
  /** Settings › Gateways' mode of this gateway. */
  mode: "test" | "live";
};

const DOC_SQL = DOC_STATE_SQL.replace("SELECT d.type,", "SELECT d.id, d.client_id, d.updated_at, d.type,");
const CONTACT_OK_SQL =
  "SELECT id FROM contacts WHERE id = ?1 AND client_id = ?2 AND portal_access = 1 AND can_see_finance = 1 AND anonymised_at IS NULL";
/** The emailed link's live, unrevoked token for this document and client, bound to its live contact whose address still matches: the contact's id. */
const TOKEN_CONTACT_SQL = `SELECT c.id FROM doc_access_tokens t JOIN contacts c ON c.id = t.contact_id AND c.client_id = t.client_id
   WHERE t.token_hash = ?1 AND t.document_id = ?2 AND t.client_id = ?3 AND t.purpose = 'view_pay' AND t.revoked_at IS NULL AND t.expires_at > ?4
     AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL AND lower(c.email) = t.email`;
const TERMS_SQL = "SELECT value, version FROM settings WHERE key = 'payment_terms'";
/** M6.3 (early check 1, "What B2 must not forget" 3; core `payment_pending`): a gateway payment still waits on the document (one primary-key read). */
const PENDING_SQL = `SELECT ${gatewayPaymentPendingSql("d")} AS pending FROM documents d WHERE d.id = ?1`;

export const NO_REQUEST: RequestInfo = { requestId: null, ip: null, ua: null };

/** The shared reads and rules, or the refusal to answer with. */
export async function linkContext(
  env: GatewayEnv,
  a: MakeLinkArgs,
  now: number,
): Promise<{ ok: true; ctx: LinkContext } | { ok: false; refusal: MakeLinkResult }> {
  const db = env.DB;
  const no = (refusal: MakeLinkResult) => ({ ok: false, refusal }) as const;
  const actorRead =
    a.actor.kind === "contact"
      ? db.prepare(CONTACT_OK_SQL).bind(a.actor.contactId, a.clientId ?? "")
      : a.actor.kind === "token"
        ? db.prepare(TOKEN_CONTACT_SQL).bind(a.actor.tokenHash, a.documentId, a.clientId ?? "", now)
        : db
            .prepare(
              "SELECT id FROM staff_users WHERE id = ?1 AND status = 'active' AND role IN ('owner', 'staff')",
            )
            .bind(a.actor.memberId);
  const [docR, actorR, openR, termsR, linksR, modeR, pendingR] = await db.batch([
    db.prepare(DOC_SQL).bind(a.documentId),
    actorRead,
    db.prepare(OPEN_CHECKOUT_SQL).bind(a.documentId),
    db.prepare(TERMS_SQL),
    db.prepare(DOCUMENT_CLIENT_LINKS_SINCE_SQL).bind(a.documentId, now - 3_600_000),
    db.prepare("SELECT value, version FROM settings WHERE key = 'gateways'"),
    db.prepare(PENDING_SQL).bind(a.documentId),
  ]);
  const doc = docR?.results[0] as DocRow | undefined;
  // Another client's document, an unknown id, a contact or link that may not pay it: the same 404 as a thing that is not there.
  if (!doc || (a.clientId !== null && doc.client_id !== a.clientId))
    return no({ ok: false, error: "not_found" });
  const actorRow = actorR?.results[0] as { id: string } | undefined;
  if (!actorRow) return no({ ok: false, error: "not_found" });
  if (doc.anonymised_at !== null) return no({ ok: false, error: "client_gone" });
  if (a.expectedUpdatedAt !== undefined && doc.updated_at !== a.expectedUpdatedAt)
    return no({ ok: false, error: "not_found", stale: true });
  // L7: staff never make a card link; the client pays a USD document from the portal (or its emailed link), where each Checkout page lasts an hour.
  if (a.actor.kind === "staff" && (a.provider === "stripe" || doc.currency === "USD"))
    return no({ ok: false, error: "not_payable_online", reason: "use_portal" });
  const terms = cachedSetting(
    "payment_terms",
    termsR?.results[0] as { value: string; version: number } | undefined,
  );
  const stripe = a.provider === "stripe";
  const floorMinor = stripe ? terms.onlineMinPartialUsdMinor : terms.razorpayMinPartialInrMinor;
  // Early check 1, "What B2 must not forget" 2: the Stripe maximum everywhere (L9; Researched 2026-10-28, RBI PA Directions 2025, para 11(d) (08-C RB-07); for
  // Stripe, not a PA-CB, the safest setting, not a legal limit).
  const maxMinor = stripe ? terms.overseasOnlineMaxUsdMinor : null;
  const paymentPending = (pendingR?.results[0] as { pending: number } | undefined)?.pending === 1;
  const payable = payableOnline(
    {
      type: doc.type,
      currency: doc.currency,
      frozen: doc.frozen_at !== null,
      status: doc.status,
      withdrawn: doc.withdrawn === 1,
      balanceMinor: doc.balance_minor,
      paymentPending,
    },
    { country: doc.country, gstStatus: doc.gst_status, anonymised: false },
    a.provider,
    { floorMinor, maxMinor },
  );
  if (!payable.ok)
    // "What B2 must not forget" 3 (lead's answer to B1, deviation 11): a payment already waiting on it, Razorpay's included: "no need to pay again".
    return no(
      payable.reason === "payment_pending"
        ? { ok: false, error: "payment_processing" }
        : { ok: false, error: "not_payable_online", reason: payable.reason },
    );
  const verdict = payAmountVerdict({
    amountMinor: a.amountMinor,
    balanceMinor: doc.balance_minor,
    floorMinor,
    maxMinor,
    // "What B2 must not forget" 1: whole units only where the provider's row says so (a Razorpay proforma; Stripe takes cents).
    wholeRupees: !stripe && doc.type === "proforma",
  });
  if (!verdict.ok)
    return no(
      verdict.code === "amount_below_minimum"
        ? { ok: false, error: verdict.code, minimumMinor: verdict.minimumMinor }
        : verdict.code === "amount_above_balance"
          ? { ok: false, error: verdict.code, balanceMinor: verdict.balanceMinor }
          : verdict.code === "amount_above_maximum"
            ? { ok: false, error: verdict.code, maximumMinor: verdict.maximumMinor }
            : { ok: false, error: verdict.code },
    );
  const gateways = cachedSetting(
    "gateways",
    (modeR?.results[0] as { value: string; version: number } | undefined) ?? undefined,
  );
  const made = (linksR?.results[0] as { n: number } | undefined)?.n ?? 0;
  const linkContactId =
    a.actor.kind === "staff" ? null : a.actor.kind === "contact" ? a.actor.contactId : actorRow.id;
  return {
    ok: true,
    ctx: {
      doc,
      clientId: doc.client_id,
      open: openR?.results[0] as CheckoutRow | undefined,
      limited: made >= LINKS_PER_CLIENT_HOUR,
      linkContactId,
      actorOf: {
        ...(a.request ?? NO_REQUEST),
        actorType: a.actor.kind === "staff" ? "staff" : "contact",
        actorId: a.actor.kind === "staff" ? a.actor.memberId : linkContactId,
        role: a.actor.kind === "staff" ? a.actor.role : null,
      },
      floorMinor,
      maxMinor,
      mode: gateways[a.provider].mode,
    },
  };
}
