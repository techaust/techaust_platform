// The leads consumer (FRM-02, FRM-05, FRM-06, ADM-LEAD-01 web leads). One message = one unit of work:
//   validate -> (redelivery? just make sure the emails are queued) -> in ONE db.batch(): count against the per-address
//   limits and insert the lead if both are within them -> queue the acknowledgement and the internal alert.
// A message over the limits creates no lead and no email; only a counter moved and a line without personal data is
// logged (keeping a spammer's details has no purpose under DPDP, docs/13 2026-10-23).
//
// Idempotency: the lead's id is derived from the message (ref as first made + submittedAt + ipHash), so a redelivery is
// found by id even after a reference clash gave the lead a different `ref`. Counting happens in the same transaction as
// the insert, so a retry of a message that already made its lead never counts again.
import {
  budgetBandLabel,
  type Currency,
  countryName,
  type EmailMessage,
  generateLeadRef,
  type LeadMessage,
  labelOf,
  leadMessage,
  SETTINGS_DEFAULTS,
  stableId,
  TIMELINE_LABELS,
  TOOL_LABELS,
  uuidv7,
} from "@techaust/core";
import { CATALOGUE } from "@techaust/db/catalogue";
import { countStatements, limitKeys, withinLimitsSql } from "./form-limits.ts";
import { logEvent } from "./log.ts";

export type LeadResult = "created" | "duplicate" | "limited" | "invalid";

const NOT_SURE = "Not sure yet";
const GENERAL = "General enquiry";
const NOT_STATED = "not stated";

const serviceName = (code: string | undefined): string => {
  if (!code) return GENERAL;
  if (code === "not-sure") return NOT_SURE;
  // The seed's names use "&"; text the visitor reads says "and" (docs/07 §1).
  return (CATALOGUE.find((s) => s.code === code)?.name ?? code).replaceAll(" & ", " and ");
};

/** `delete_after` = submission time plus the leads retention (settings default, in calendar months). */
export function deleteAfter(submittedAt: number, months = SETTINGS_DEFAULTS.retention.leadsMonths): number {
  const d = new Date(submittedAt);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

/**
 * The lead's row id: a UUIDv7 (time-ordered like every row id) whose random part is derived from the message's
 * identity (the reference as the web Worker made it, `submittedAt` and `ipHash`). The same message always gives the same
 * id, whatever reference the lead ended up with.
 */
export function leadId(m: Pick<LeadMessage, "ref" | "submittedAt" | "ipHash">): string {
  const digest = stableId(`lead:${m.ref}:${m.submittedAt}:${m.ipHash}`).replace(/-/g, "");
  const random = Uint8Array.from({ length: 10 }, (_, i) =>
    Number.parseInt(digest.slice(i * 2, i * 2 + 2), 16),
  );
  return uuidv7(m.submittedAt, random);
}

/** The values of the internal alert (docs/07 §8) with human labels: no raw codes. */
export function alertData(env: Env, m: LeadMessage, ref: string): Record<string, string> {
  const p = m.payload;
  const quote =
    m.kind === "quote" ? (m.payload as Extract<LeadMessage, { kind: "quote" }>["payload"]) : undefined;
  const currency: Currency | undefined = quote?.currency ?? m.currency;
  return {
    ref,
    service_name: serviceName(quote?.service),
    budget_band: quote ? budgetBandLabel(quote.currency, quote.budget) : NOT_STATED,
    country: quote ? countryName(quote.country) : NOT_STATED,
    name: p.name,
    email: p.email,
    phone: p.phone ?? "",
    company: p.company ?? "",
    timeline: quote ? labelOf(TIMELINE_LABELS, quote.timeline) : "",
    currency: currency ?? "",
    tools: quote ? quote.tools.map((t) => labelOf(TOOL_LABELS, t)).join(", ") : "",
    call_window: quote?.callWindow ?? "",
    message: quote?.goals ?? (m.payload as { message?: string }).message ?? "",
    source_page: m.sourcePage ?? "",
    type: m.type ?? "",
    plan: m.plan ?? "",
    admin_url: env.ADMIN_URL,
  };
}

function emailsFor(env: Env, m: LeadMessage, ref: string): EmailMessage[] {
  const data = alertData(env, m, ref);
  const entity = { type: "lead", id: ref };
  return [
    {
      template: "lead.acknowledgement",
      to: m.payload.email,
      data: {
        first_name: m.payload.name.split(/\s+/)[0] ?? m.payload.name,
        service_name: data.service_name ?? "",
        ref,
        cal_link: "",
      },
      entity,
    },
    { template: "lead.alert", to: env.LEAD_ALERT_TO, data, entity },
  ];
}

const clash = (e: unknown, column: string) =>
  new RegExp(`UNIQUE constraint failed: leads\\.${column}`).test(
    String(e) + String((e as Error)?.cause ?? ""),
  );

/** The insert, written as INSERT ... SELECT so it happens only while both counters are within their limits. */
function insertStatement(env: Env, m: LeadMessage, ref: string): D1PreparedStatement {
  const p = m.payload;
  const quote =
    m.kind === "quote" ? (m.payload as Extract<LeadMessage, { kind: "quote" }>["payload"]) : undefined;
  const [keyShort, keyDay] = limitKeys(m.ipHash);
  const rest = Array.from({ length: 21 }, (_, i) => `?${i + 3}`).join(", "); // ?3 .. ?23
  return env.DB.prepare(
    `INSERT INTO leads (id, ref, source, form_version, service_code, request_type, plan, budget_band, timeline,
       currency, message, tools, contact_name, contact_email, contact_phone, contact_company, contact_country,
       call_window, utm, source_page, referrer_host, consent, last_activity_at, delete_after)
     SELECT ?1, ?2, 'web', ${rest} WHERE ${withinLimitsSql(24, 25)}`,
  ).bind(
    leadId(m),
    ref,
    m.formVersion,
    quote?.service ?? null,
    m.type ?? null,
    m.plan ?? null,
    quote?.budget ?? null,
    quote?.timeline ?? null,
    quote?.currency ?? m.currency ?? null,
    quote?.goals ?? (m.payload as { message?: string }).message ?? null,
    quote ? JSON.stringify(quote.tools) : null,
    p.name,
    p.email,
    p.phone ?? null,
    p.company ?? null,
    quote?.country ?? null,
    quote?.callWindow ?? null,
    JSON.stringify(m.utm),
    m.sourcePage ?? null,
    m.referrerHost ?? null,
    JSON.stringify({
      noticeVersion: m.noticeVersion,
      purposes: ["respond_to_enquiry", ...(p.marketing ? ["marketing_updates"] : [])],
      at: m.submittedAt,
      ipHash: m.ipHash,
      marketing: p.marketing,
      withdrawnAt: null,
    }),
    m.submittedAt,
    deleteAfter(m.submittedAt),
    keyShort,
    keyDay,
  );
}

export async function processLead(env: Env, body: unknown, now = Date.now()): Promise<LeadResult> {
  const parsed = leadMessage.safeParse(body);
  if (!parsed.success) {
    // Acknowledged, never retried: the same message would fail again.
    logEvent("lead.invalid_message", { issues: parsed.error.issues.length });
    return "invalid";
  }
  const m = parsed.data;
  const id = leadId(m);

  // A redelivery of a message that already made its lead: the lead stays and nothing is counted again; the emails
  // are queued again (the email consumer sends each (template, lead, recipient) once).
  const redelivered = async (): Promise<boolean> => {
    const existing = await env.DB.prepare("SELECT ref FROM leads WHERE id = ?1")
      .bind(id)
      .first<{ ref: string }>();
    if (!existing) return false;
    await env.EMAIL_QUEUE.sendBatch(emailsFor(env, m, existing.ref).map((body) => ({ body })));
    logEvent("lead.redelivered", { ref: existing.ref });
    return true;
  };
  if (await redelivered()) return "duplicate";

  let ref = m.ref;
  for (let attempt = 0; ; attempt++) {
    try {
      // One transaction: count both windows, then insert only while both are within their limits.
      const results = await env.DB.batch([
        ...countStatements(env.DB, m.ipHash, now),
        insertStatement(env, m, ref),
      ]);
      if ((results[2]?.meta.changes ?? 0) === 0) {
        logEvent("lead.rate_limited", { kind: m.kind });
        return "limited";
      }
      break;
    } catch (e) {
      // The same message was inserted by a concurrent delivery: it is a redelivery after all.
      if (clash(e, "id") && (await redelivered())) return "duplicate";
      if (!clash(e, "ref") || attempt >= 5) throw e;
      ref = generateLeadRef(); // the rare unique clash: a new reference, carried by the acknowledgement email
    }
  }
  await env.EMAIL_QUEUE.sendBatch(emailsFor(env, m, ref).map((body) => ({ body })));
  logEvent("lead.created", { ref, kind: m.kind, formVersion: m.formVersion });
  return "created";
}
