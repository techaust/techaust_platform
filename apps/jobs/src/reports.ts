// The owners' export alerts (M5.5b stage B; ADM-REP-07, ADM-INV-17, LD75, LD76, LD77; Q54, Q55; VERIFY WITH CA/LEGAL for every date). Two messages on the leads queue, both riding the 09:00 IST
// tick of M5.4 (the cron reads nothing; `hourlyMessages` in billing.ts decides what to queue):
//
//   `realisation.scan`  the export invoices that are in a FEMA or GST stage today (approaching or overdue): one page of at most 50 (`REALISATION_SCAN_SQL`: open exports old enough to be near a deadline, the
//                       stage worked out in SQL, a twin of the gst core (the core is SPA only, LD16)). Per (document, its CURRENT stage) and per active owner without that stage's bell: the EMAIL is queued
//                       first (entity `<documentId>:<stage>`, so the email log deduplicates a rerun), THEN the bell is written (`INSERT OR IGNORE`, one per owner, kind and document). Only the current
//                       stage alerts: an export that passed approaching and is overdue now has only the overdue bell and email. A 51st row queues the next page. The stored `tax` settings are read with
//                       the no-zod reader; a value it refuses skips the scan with `realisation.settings_invalid` (a retry cannot help; nothing is guessed).
//   `edf.reminder`      the monthly Export Declaration Form reminder: the invoice month's non-voided exports counted; none, nothing (Q55); else one email and one bell per active owner without the month's `edf.due`
//                       bell (entity `edf:YYYY-MM`), the email first. IST days 5, 6 and 7 queue it (6 and 7 catch a missed tick; the bell makes a second one a no-op).
// An anonymised client is named "Anonymised client" in the emails and bells (the snapshot name is personal data; VERIFY WITH CA/LEGAL). Words: 07-V §9 and §10 (the lead's draft, PENDING the owner).
// Bells never carry a client name: the document number only. No personal data in a log line.
import {
  addDays,
  type EmailMessage,
  edfReminderMessage,
  formatDate,
  parseIsoDate,
  realisationScanMessage,
} from "@techaust/core";
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { realisationParamsFromStoredTax } from "@techaust/core/invoices";
import { todayIst } from "@techaust/core/offers";
import { type AlertStage, STAGE_BELL_KIND } from "@techaust/db/realisation";
import {
  EDF_COUNT_SQL,
  REALISATION_BELLS_SQL,
  REALISATION_SCAN_SQL,
  REPORT_PAGE_SIZE,
  realisationScanBinds,
} from "@techaust/db/reports";
import { firstName, moneyText } from "./invoice-mail.ts";
import { logEvent } from "./log.ts";
import { sendChunked } from "./send-batch.ts";

const TAX_READ = "SELECT value FROM settings WHERE key = 'tax'";
const OWNERS_READ =
  "SELECT id, email, name FROM staff_users WHERE role = 'owner' AND status = 'active' ORDER BY id";

type Owner = { id: string; email: string; name: string };
type ScanRow = {
  id: string;
  number_display: string;
  issue_date: string;
  currency: string;
  balance_minor: number;
  client_code: string;
  client_name: string | null;
  client_anonymised: number | null;
  fema_due: string;
  gst_due: string;
  stage: AlertStage;
};
type BellRow = { user_id: string; kind: string; entity_id: string };

const adminBase = (env: Env) => env.ADMIN_URL.replace(/\/+$/, "");

/** The date of an ISO text as "03 Aug 2027" (the dates are SQL's, so they always parse). */
const dateText = (iso: string): string => {
  const d = parseIsoDate(iso);
  return d ? formatDate(d) : iso;
};

/** 07-V §9, word for word (approved by the lead 2026-10-28; "GST date", not "GST refund date"): the bell of each stage. The number only, never a name. */
export const REALISATION_BELL_TITLE: Record<AlertStage, (number: string, date: string) => string> = {
  fema_approaching: (n, d) => `${n}: FEMA date in 30 days (${d})`,
  fema_overdue: (n, d) => `${n}: past the FEMA date (${d})`,
  gst_approaching: (n, d) => `${n}: GST date in 30 days (${d})`,
  gst_overdue: (n, d) => `${n}: past the GST date (${d})`,
};
/** Where a realisation bell and email lead: the export realisation report, on that invoice. */
export const realisationLink = (documentId: string): string => `/reports/realisation?doc=${documentId}`;
/** The due date a stage is about: the FEMA date for the FEMA stages, the GST date for the GST ones. */
const dueOf = (r: Pick<ScanRow, "stage" | "fema_due" | "gst_due">): string =>
  r.stage === "gst_approaching" || r.stage === "gst_overdue" ? r.gst_due : r.fema_due;

/** One bell per (owner, kind, document) written after the emails: `?1` is a JSON array of `{u, k, d, t, l}`. */
export const REALISATION_BELLS_INSERT = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), json_extract(j.value, '$.u'), json_extract(j.value, '$.k'), 'document', json_extract(j.value, '$.d'),
         substr(json_extract(j.value, '$.t'), 1, 300), json_extract(j.value, '$.l')
  FROM json_each(?1) j`;

export type ScanResult =
  | { kind: "invalid_message" | "invalid_settings" | "no_owners" }
  | { kind: "done"; rows: number; alerts: number; continued: boolean };

/** One `realisation.scan` message: one page, its alerts, and the next page when there is one. */
export async function processRealisationScan(env: Env, body: unknown, now = Date.now()): Promise<ScanResult> {
  const parsed = realisationScanMessage.safeParse(body);
  if (!parsed.success) {
    logEvent("realisation.invalid_message");
    return { kind: "invalid_message" };
  }
  const [tax, owners] = await env.DB.batch([env.DB.prepare(TAX_READ), env.DB.prepare(OWNERS_READ)]);
  let stored: unknown = null;
  try {
    const value = (tax?.results[0] as { value: string } | undefined)?.value;
    stored = value ? JSON.parse(value) : null;
  } catch {
    stored = null;
  }
  const rules = realisationParamsFromStoredTax(stored);
  if (!rules.ok) {
    logEvent("realisation.settings_invalid");
    return { kind: "invalid_settings" };
  }
  const ownerRows = (owners?.results ?? []) as Owner[];
  if (ownerRows.length === 0) {
    logEvent("realisation.no_owners");
    return { kind: "no_owners" };
  }
  const after = parsed.data.after;
  const { results } = await env.DB.prepare(REALISATION_SCAN_SQL(after !== undefined))
    .bind(...realisationScanBinds(todayIst(now), rules, after))
    .all<ScanRow>();
  const page = results.slice(0, REPORT_PAGE_SIZE);
  const more = results.length > REPORT_PAGE_SIZE;

  const emails: EmailMessage[] = [];
  const bells: { u: string; k: string; d: string; t: string; l: string }[] = [];
  if (page.length > 0) {
    const existing = (
      await env.DB.prepare(REALISATION_BELLS_SQL)
        .bind(JSON.stringify(page.map((r) => r.id)))
        .all<BellRow>()
    ).results;
    const have = new Set(existing.map((b) => `${b.user_id}|${b.kind}|${b.entity_id}`));
    for (const r of page) {
      const kind = STAGE_BELL_KIND[r.stage];
      const client = r.client_anonymised ? ANONYMISED_CLIENT : (r.client_name ?? r.client_code);
      const due = dateText(dueOf(r));
      for (const o of ownerRows) {
        if (have.has(`${o.id}|${kind}|${r.id}`)) continue;
        emails.push({
          template: "realisation.alert",
          to: o.email,
          data: {
            owner_first_name: firstName(o.name),
            stage: r.stage,
            number: r.number_display,
            client,
            currency: r.currency,
            outstanding: moneyText(r.balance_minor, r.currency),
            due_date: due,
            link: `${adminBase(env)}${realisationLink(r.id)}`,
          },
          entity: { type: "document", id: `${r.id}:${r.stage}` },
        });
        bells.push({
          u: o.id,
          k: kind,
          d: r.id,
          t: REALISATION_BELL_TITLE[r.stage](r.number_display, due),
          l: realisationLink(r.id),
        });
      }
    }
  }
  // The emails first (chunks within the Queues limits), then the bells: a run that dies in between is retried and the email log deduplicates, so a bell never exists without its email.
  await sendChunked(env.EMAIL_QUEUE, emails);
  if (bells.length > 0) await env.DB.prepare(REALISATION_BELLS_INSERT).bind(JSON.stringify(bells)).run();
  const last = page.at(-1);
  if (more && last) {
    await env.LEADS_QUEUE.send({
      v: 1,
      kind: "realisation.scan",
      after: { d: last.issue_date, id: last.id },
    });
  }
  logEvent("realisation.scan", { rows: page.length, alerts: bells.length, continued: more });
  return { kind: "done", rows: page.length, alerts: bells.length, continued: more };
}

// ---- the EDF reminder ---------------------------------------------------------------------------------------------------------------------------------

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** The owners without this month's `edf.due` bell (`?1` the entity `edf:YYYY-MM`). */
export const OWNERS_WITHOUT_EDF_BELL = `SELECT u.id, u.email, u.name FROM staff_users u
   WHERE u.role = 'owner' AND u.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.kind = 'edf.due' AND n.entity_id = ?1)
   ORDER BY u.id`;

export const EDF_BELLS_INSERT = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), json_extract(j.value, '$.u'), 'edf.due', 'report', ?1, ?2, ?3 FROM json_each(?4) j`;

export type EdfResult =
  | { kind: "invalid_message" | "no_exports" | "nobody_to_tell" }
  | { kind: "done"; exports: number; owners: number };

/** One `edf.reminder` message for the invoice month `year`-`month`. */
export async function processEdfReminder(env: Env, body: unknown): Promise<EdfResult> {
  const parsed = edfReminderMessage.safeParse(body);
  if (!parsed.success) {
    logEvent("edf.invalid_message");
    return { kind: "invalid_message" };
  }
  const { year, month } = parsed.data;
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  // the last day of the invoice month (day 0 of the next month in UTC calendar arithmetic)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
  const entity = `edf:${year}-${mm}`;
  const [count, owners] = await env.DB.batch([
    env.DB.prepare(EDF_COUNT_SQL).bind(first, last),
    env.DB.prepare(OWNERS_WITHOUT_EDF_BELL).bind(entity),
  ]);
  const n = (count?.results[0] as { n: number } | undefined)?.n ?? 0;
  if (n === 0) {
    logEvent("edf.no_exports");
    return { kind: "no_exports" };
  }
  const ownerRows = (owners?.results ?? []) as Owner[];
  if (ownerRows.length === 0) {
    logEvent("edf.nobody_to_tell");
    return { kind: "nobody_to_tell" };
  }
  const lastDate = parseIsoDate(last);
  // Due by: the last day of the invoice month plus 30 days (VERIFY WITH CA/LEGAL, as `meta.edfDue` of the EDF report)
  const due = lastDate ? formatDate(addDays(lastDate, 30)) : last;
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const emails: EmailMessage[] = ownerRows.map((o) => ({
    template: "edf.reminder",
    to: o.email,
    data: {
      owner_first_name: firstName(o.name),
      month_label: monthLabel,
      count: String(n),
      due_date: due,
      link: `${adminBase(env)}/reports/edf?month=${year}-${mm}`,
    },
    entity: { type: "report", id: entity },
  }));
  await sendChunked(env.EMAIL_QUEUE, emails);
  await env.DB.prepare(EDF_BELLS_INSERT)
    .bind(
      entity,
      `EDF list for ${monthLabel} is due by ${due}`,
      `/reports/edf?month=${year}-${mm}`,
      JSON.stringify(ownerRows.map((o) => ({ u: o.id }))),
    )
    .run();
  logEvent("edf.reminder", { exports: n, owners: ownerRows.length });
  return { kind: "done", exports: n, owners: ownerRows.length };
}
