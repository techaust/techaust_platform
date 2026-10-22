// The leads consumer (FRM-02, FRM-05, FRM-06, ADM-LEAD-01 web leads). One message = one unit of work:
//   validate -> (redelivery? just make sure the emails are queued) -> count against the per-address limits
//   -> insert the lead -> queue the acknowledgement and the internal alert.
// A message over the limits creates no lead and no email; only a counter moved and a line without personal data is
// logged (keeping a spammer's details has no purpose under DPDP, docs/13 2026-10-23).
import {
  type EmailMessage,
  generateLeadRef,
  type LeadMessage,
  leadMessage,
  SETTINGS_DEFAULTS,
  uuidv7,
} from "@techaust/core";
import { CATALOGUE } from "@techaust/db/catalogue";
import { countSubmission } from "./form-limits.ts";
import { logEvent } from "./log.ts";

export type LeadResult = "created" | "duplicate" | "limited" | "invalid";

const NOT_SURE = "Not sure yet";
const GENERAL = "General enquiry";
const NOT_STATED = "not stated";

const serviceName = (code: string | undefined): string => {
  if (!code) return GENERAL;
  if (code === "not-sure") return NOT_SURE;
  return CATALOGUE.find((s) => s.code === code)?.name ?? code;
};

/** `delete_after` = submission time plus the leads retention (settings default, in calendar months). */
export function deleteAfter(submittedAt: number, months = SETTINGS_DEFAULTS.retention.leadsMonths): number {
  const d = new Date(submittedAt);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

type Existing = { ref: string; contact_email: string; consent: string | null };

function emailsFor(env: Env, m: LeadMessage, ref: string): EmailMessage[] {
  const p = m.payload;
  const quote =
    m.kind === "quote" ? (m.payload as Extract<LeadMessage, { kind: "quote" }>["payload"]) : undefined;
  const name = serviceName(quote?.service);
  const budget = quote?.budget ?? NOT_STATED;
  const country = quote?.country ?? NOT_STATED;
  const entity = { type: "lead", id: ref };
  return [
    {
      template: "lead.acknowledgement",
      to: p.email,
      data: { first_name: p.name.split(/\s+/)[0] ?? p.name, service_name: name, ref, cal_link: "" },
      entity,
    },
    {
      template: "lead.alert",
      to: env.LEAD_ALERT_TO,
      data: {
        ref,
        service_name: name,
        budget_band: budget,
        country,
        name: p.name,
        email: p.email,
        phone: p.phone ?? "",
        company: p.company ?? "",
        timeline: quote?.timeline ?? "",
        currency: quote?.currency ?? m.currency ?? "",
        tools: quote?.tools.join(", ") ?? "",
        call_window: quote?.callWindow ?? "",
        message: quote?.goals ?? (m.payload as { message?: string }).message ?? "",
        source_page: m.sourcePage ?? "",
        admin_url: env.ADMIN_URL,
      },
      entity,
    },
  ];
}

const isRefClash = (e: unknown) =>
  /UNIQUE constraint failed: leads\.ref/.test(String(e) + String((e as Error)?.cause));

async function insertLead(env: Env, m: LeadMessage, ref: string): Promise<void> {
  const p = m.payload;
  const quote =
    m.kind === "quote" ? (m.payload as Extract<LeadMessage, { kind: "quote" }>["payload"]) : undefined;
  await env.DB.prepare(
    `INSERT INTO leads (id, ref, source, form_version, service_code, budget_band, timeline, currency, message, tools,
       contact_name, contact_email, contact_phone, contact_company, contact_country, call_window, utm, source_page,
       referrer_host, consent, last_activity_at, delete_after)
     VALUES (?1, ?2, 'web', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)`,
  )
    .bind(
      uuidv7(m.submittedAt),
      ref,
      m.formVersion,
      quote?.service ?? null,
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
      }),
      m.submittedAt,
      deleteAfter(m.submittedAt),
    )
    .run();
}

export async function processLead(env: Env, body: unknown, now = Date.now()): Promise<LeadResult> {
  const parsed = leadMessage.safeParse(body);
  if (!parsed.success) {
    // Acknowledged, never retried: the same message would fail again.
    logEvent("lead.invalid_message", { issues: parsed.error.issues.length });
    return "invalid";
  }
  const m = parsed.data;

  // A redelivery of a message that already made its lead: the lead stays, the emails are queued again (the email
  // consumer sends each (template, lead, recipient) once). A different submission with the same ref is a clash.
  const existing = await env.DB.prepare("SELECT ref, contact_email, consent FROM leads WHERE ref = ?1")
    .bind(m.ref)
    .first<Existing>();
  if (existing) {
    const at = (JSON.parse(existing.consent ?? "{}") as { at?: number }).at;
    if (existing.contact_email === m.payload.email && at === m.submittedAt) {
      await env.EMAIL_QUEUE.sendBatch(emailsFor(env, m, existing.ref).map((body) => ({ body })));
      logEvent("lead.redelivered", { ref: existing.ref });
      return "duplicate";
    }
  }

  if (!(await countSubmission(env.DB, m.ipHash, now))) {
    logEvent("lead.rate_limited", { kind: m.kind });
    return "limited";
  }

  let ref = existing ? generateLeadRef() : m.ref;
  for (let attempt = 0; ; attempt++) {
    try {
      await insertLead(env, m, ref);
      break;
    } catch (e) {
      if (!isRefClash(e) || attempt >= 5) throw e;
      ref = generateLeadRef(); // the rare unique clash: a new reference, carried by the acknowledgement email
    }
  }
  await env.EMAIL_QUEUE.sendBatch(emailsFor(env, m, ref).map((body) => ({ body })));
  logEvent("lead.created", { ref, kind: m.kind, formVersion: m.formVersion });
  return "created";
}
