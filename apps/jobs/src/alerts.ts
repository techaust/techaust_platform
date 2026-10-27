// The owners' daily alerts at 09:00 IST (M5.4; ADM-INV-19, ADM-INV-10, ADM-INV-18, LD61, LD67; Q20; VERIFY WITH CA/LEGAL for the number of days). One `alerts.daily` message from the cron (no D1 read there):
//
//   unbilled work     milestones marked ready to bill whose work was delivered `invoiceAlertDays` (default 25) or more days ago and that have no invoice document yet (`UNBILLED_SQL`);
//   proforma due      milestones whose work was delivered that long ago and whose PROFORMA still has a balance: the tax invoice is due (`PROFORMA_TAX_INVOICE_DUE_SQL`, Rule 47; the two lists never overlap);
//   LUT               the week's reminder (`decideLut`): the bell and the weekly email, only when the week's bell is new.
//
// Each item gets ONE bell and ONE email per active owner, ever (Q20): an item that already has its bell is not touched again. For the items that are new the EMAILS are queued FIRST (`sendBatch`,
// at most 100 a call; entity = the milestone, so the email consumer's log row deduplicates a rerun), THEN the bells are written (`INSERT OR IGNORE`): a run that dies in between is retried and the
// emails are deduplicated, a bell never exists without its email having been queued. Pages are 50 rows; a full page queues the next message (`first` false, one cursor per list; on a continuation a null
// cursor means that list is finished).
// The bell titles and the email words are the lead's 07-U, marked `[Placeholder]` until the owner approves them.
import { alertsDailyMessage, daysBetween, type EmailMessage, formatDate, istDate } from "@techaust/core";
import { alertDaysFromStoredTax, unbilledCutoff } from "@techaust/core/invoices";
import { todayIst } from "@techaust/core/offers";
import { UNBILLED_SQL } from "@techaust/db/billing";
import { PROFORMA_TAX_INVOICE_DUE_SQL } from "@techaust/db/issue";
import { firstName, moneyText } from "./invoice-mail.ts";
import { logEvent } from "./log.ts";
import { decideLut, ringLutBell } from "./lut-check.ts";

const PLACEHOLDER = "[Placeholder, 07-U] ";
const CHUNK = 100;

/** The page of one list with whether each item already has its bell (any owner): the existing lists, wrapped. */
const withBells = (inner: string, kind: string) =>
  `SELECT u.*, (SELECT count(*) FROM notifications n WHERE n.entity_type = 'milestone' AND n.entity_id = u.milestone_id AND n.kind = '${kind}') AS bells
   FROM (${inner}) u ORDER BY u.delivered_at, u.milestone_id`;
export const UNBILLED_PAGE_SQL = withBells(UNBILLED_SQL, "milestone.unbilled");
export const PROFORMA_PAGE_SQL = withBells(PROFORMA_TAX_INVOICE_DUE_SQL, "proforma.tax_invoice_due");

const SETTINGS_READ = "SELECT value FROM settings WHERE key = 'tax'";
const OWNERS_READ =
  "SELECT id, email, name FROM staff_users WHERE role = 'owner' AND status = 'active' ORDER BY id";

type Owner = { id: string; email: string; name: string };
type Row = {
  milestone_id: string;
  delivered_at: number;
  title: string;
  project_id: string;
  client_name: string;
  bells: number;
  proforma_id?: string;
  number_display?: string | null;
  currency?: string;
  balance_minor?: number;
};

/** One bell per owner per item, written after the emails. `?1` kind, `?2` JSON `[{id, title, link}]`. */
const BELLS_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, ?1, 'milestone', json_extract(j.value, '$.id'), substr(json_extract(j.value, '$.title'), 1, 300), json_extract(j.value, '$.link')
  FROM staff_users u JOIN json_each(?2) j WHERE u.role = 'owner' AND u.status = 'active'`;
const LUT_EMAIL_STATE = { next_fy_due: "next_fy_due", current_missing: "current_missing" } as const;

export type AlertsResult = {
  unbilled: number;
  proforma: number;
  lut: "none" | "queued" | "already";
  continued: boolean;
};

const adminBase = (env: Env) => env.ADMIN_URL.replace(/\/+$/, "");

async function sendInChunks(env: Env, messages: EmailMessage[]): Promise<void> {
  for (let i = 0; i < messages.length; i += CHUNK)
    await env.EMAIL_QUEUE.sendBatch(messages.slice(i, i + CHUNK).map((body) => ({ body })));
}

export async function processAlertsDaily(
  env: Env,
  body: unknown,
  now = Date.now(),
): Promise<AlertsResult | "invalid"> {
  const parsed = alertsDailyMessage.safeParse(body);
  if (!parsed.success) {
    logEvent("alerts.invalid_message");
    return "invalid";
  }
  const msg = parsed.data;
  const [tax, owners] = await env.DB.batch([env.DB.prepare(SETTINGS_READ), env.DB.prepare(OWNERS_READ)]);
  const ownerRows = (owners?.results ?? []) as Owner[];
  let stored: unknown = null;
  try {
    const value = (tax?.results[0] as { value: string } | undefined)?.value;
    stored = value ? JSON.parse(value) : null;
  } catch {
    stored = null;
  }
  const cutoff = unbilledCutoff(now, alertDaysFromStoredTax(stored));
  // The first message starts both lists; a continuation continues only the lists that still have a cursor.
  const startUnbilled = msg.first || msg.unbilledAfter !== null;
  const startProforma = msg.first || msg.proformaAfter !== null;
  const unbilledCursor: [number, string] = msg.unbilledAfter
    ? [msg.unbilledAfter.at, msg.unbilledAfter.id]
    : [-1, ""];
  const proformaCursor: [number, string] = msg.proformaAfter
    ? [msg.proformaAfter.at, msg.proformaAfter.id]
    : [-1, ""];
  const reads = [
    ...(startUnbilled ? [env.DB.prepare(UNBILLED_PAGE_SQL).bind(cutoff, ...unbilledCursor)] : []),
    ...(startProforma ? [env.DB.prepare(PROFORMA_PAGE_SQL).bind(cutoff, ...proformaCursor)] : []),
  ];
  const pages = reads.length > 0 ? await env.DB.batch(reads) : [];
  const unbilled = startUnbilled ? ((pages.shift()?.results ?? []) as Row[]) : [];
  const proforma = startProforma ? ((pages.shift()?.results ?? []) as Row[]) : [];

  const nowDate = istDate(now);
  const emails: EmailMessage[] = [];
  const itemBells = (rows: Row[], kind: string, linkOf: (r: Row) => string, title: (r: Row) => string) => {
    const fresh = rows.filter((r) => r.bells === 0);
    return {
      kind,
      fresh,
      json: JSON.stringify(fresh.map((r) => ({ id: r.milestone_id, title: title(r), link: linkOf(r) }))),
    };
  };
  const unbilledBells = itemBells(
    unbilled,
    "milestone.unbilled",
    (r) => `/projects/${r.project_id}`,
    (r) => `${PLACEHOLDER}Work delivered for ${r.client_name} has no invoice yet.`,
  );
  const proformaBells = itemBells(
    proforma,
    "proforma.tax_invoice_due",
    (r) => `/invoices/${r.proforma_id}`,
    (r) =>
      `${PLACEHOLDER}A proforma for ${r.client_name} is still unpaid and the work is delivered: the tax invoice is due.`,
  );
  const daysSince = (r: Row) => String(daysBetween(istDate(r.delivered_at), nowDate));
  for (const o of ownerRows) {
    for (const r of unbilledBells.fresh)
      emails.push({
        template: "alert.unbilled",
        to: o.email,
        data: {
          owner_first_name: firstName(o.name),
          client_name: r.client_name,
          admin_url: `${adminBase(env)}/projects/${r.project_id}`,
          milestone_title: r.title,
          delivered_date: formatDate(istDate(r.delivered_at)),
          days_since: daysSince(r),
        },
        entity: { type: "milestone", id: r.milestone_id },
      });
    for (const r of proformaBells.fresh)
      emails.push({
        template: "alert.proforma_due",
        to: o.email,
        data: {
          owner_first_name: firstName(o.name),
          client_name: r.client_name,
          admin_url: `${adminBase(env)}/invoices/${r.proforma_id}`,
          milestone_title: r.title,
          delivered_date: formatDate(istDate(r.delivered_at)),
          days_since: daysSince(r),
          proforma_number: r.number_display ?? "",
          balance: moneyText(r.balance_minor ?? 0, r.currency ?? "INR"),
        },
        entity: { type: "milestone", id: r.milestone_id },
      });
  }

  // The LUT check rides the first message only (one a day): the bell is the week's, the email goes out with it.
  let lut: AlertsResult["lut"] = "none";
  const decision = msg.first ? await decideLut(env, { kind: "lut.check", asOf: todayIst(now) }) : null;
  if (decision) {
    const exists = await env.DB.prepare(
      "SELECT 1 AS x FROM notifications WHERE entity_type = 'settings' AND entity_id = ?1 AND kind = 'lut.reminder' LIMIT 1",
    )
      .bind(decision.entity)
      .first();
    if (exists) lut = "already";
    else {
      lut = "queued";
      for (const o of ownerRows)
        emails.push({
          template: "lut.reminder",
          to: o.email,
          data: {
            owner_first_name: firstName(o.name),
            fy_label: decision.fyLabel,
            state: LUT_EMAIL_STATE[decision.bell],
            admin_url: `${adminBase(env)}/settings/tax`,
          },
          entity: { type: "settings", id: decision.entity },
        });
    }
  }

  // The emails first (chunks of at most 100), then the bells.
  await sendInChunks(env, emails);
  const writes = [
    ...(unbilledBells.fresh.length > 0
      ? [env.DB.prepare(BELLS_SQL).bind(unbilledBells.kind, unbilledBells.json)]
      : []),
    ...(proformaBells.fresh.length > 0
      ? [env.DB.prepare(BELLS_SQL).bind(proformaBells.kind, proformaBells.json)]
      : []),
  ];
  if (writes.length > 0) await env.DB.batch(writes);
  if (decision && lut === "queued")
    await ringLutBell(env, { kind: "lut.check", asOf: todayIst(now) }, decision);

  // A full page queues the next message; a finished list has no cursor.
  const lastU = unbilled[unbilled.length - 1];
  const lastP = proforma[proforma.length - 1];
  const nextU = unbilled.length === 50 && lastU ? { at: lastU.delivered_at, id: lastU.milestone_id } : null;
  const nextP = proforma.length === 50 && lastP ? { at: lastP.delivered_at, id: lastP.milestone_id } : null;
  const continued = nextU !== null || nextP !== null;
  if (continued)
    await env.LEADS_QUEUE.send({
      kind: "alerts.daily",
      first: false,
      unbilledAfter: nextU,
      proformaAfter: nextP,
    });
  logEvent("alerts.daily", {
    unbilled: unbilledBells.fresh.length,
    proforma: proformaBells.fresh.length,
    lut,
    continued,
  });
  return { unbilled: unbilledBells.fresh.length, proforma: proformaBells.fresh.length, lut, continued };
}
