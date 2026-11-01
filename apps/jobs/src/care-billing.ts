// The recurring care-plan invoices in the jobs Worker (M5.4; ADM-CARE-02, LD57, LD58, LD59, LD66; Researched 2026-10-28, s.31(5) CGST Act (08-C RA-24) for the invoice date and the first-period price). The cron only enqueues (06:00 IST):
//
//   care.scan  -> `CARE_DUE_SQL` (active plans whose current period is not billed, 50 a page, keyset by `(created_at, id)`): one `care.bill` per plan, and the next `care.scan` when the page was full;
//   care.bill  -> the admin API's `draftCarePlan` over the `BillingJobs` entrypoint (it drafts the invoice for the period ONCE: `care_invoices` and `last_billed_period`). When the draft may be issued
//                 by the system (`autoEligible`) the next message is `care.issue`. That includes the answer `already_billed` of a draft that is still waiting (an earlier `care.issue` was never queued):
//                 the enqueue is repeated, and it is idempotent. A failed enqueue throws, so the queue retries this message (early check finding 2);
//   care.issue -> the admin API's `issueCareDraft` (authority `care_auto`: it issues only when every Owner-set rule still holds; otherwise the draft stays and the owners are told).
// Drafting and issuing are two messages on purpose (one unit of work each, 10 ms CPU). Neither takes a clock, a period or an amount from the message: ids and cursors only.
import { planPeriodOf } from "@techaust/core/care";
import { periodWords } from "@techaust/core/care-billing";
import { todayIst } from "@techaust/core/offers";
import { CARE_DUE_SQL } from "@techaust/db/billing";
import { billingJobs } from "./billing-rpc.ts";
import { logEvent } from "./log.ts";

const PAGE = 50;

export type CareScanResult = { plans: number; continued: boolean };

export async function processCareScan(
  env: Env,
  body: { after: { at: number; id: string } | null },
  now = Date.now(),
): Promise<CareScanResult> {
  const [at, id] = body.after ? [body.after.at, body.after.id] : [-1, ""];
  const { results } = await env.DB.prepare(CARE_DUE_SQL)
    .bind(todayIst(now), at, id)
    .all<{ id: string; created_at: number }>();
  if (results.length === 0) {
    logEvent("care.scan", { plans: 0 });
    return { plans: 0, continued: false };
  }
  const last = results[results.length - 1];
  const continued = results.length === PAGE && last !== undefined;
  await env.LEADS_QUEUE.sendBatch([
    ...results.map((r) => ({ body: { kind: "care.bill", planId: r.id } })),
    ...(continued ? [{ body: { kind: "care.scan", after: { at: last.created_at, id: last.id } } }] : []),
  ]);
  logEvent("care.scan", { plans: results.length, continued });
  return { plans: results.length, continued };
}

export type CareBillResult = "drafted" | "already_billed" | "not_due" | "skipped";

export async function processCareBill(env: Env, body: { planId: string }): Promise<CareBillResult> {
  const answer = await billingJobs(env).draftCarePlan({ planId: body.planId });
  // A draft the system may issue gets its own message; so does a draft that is still waiting from an earlier run (finding 2). A failed `send` throws and the queue retries the whole message.
  if (
    answer.documentId &&
    answer.autoEligible &&
    (answer.result === "drafted" || answer.result === "already_billed")
  )
    await env.LEADS_QUEUE.send({ kind: "care.issue", documentId: answer.documentId });
  logEvent("care.bill", {
    result: answer.result,
    autoEligible: answer.autoEligible,
    why: answer.why,
  });
  return answer.result;
}

export async function processCareIssue(
  env: Env,
  body: { documentId: string },
): Promise<"issued" | "refused" | "already_issued" | "not_found"> {
  const answer = await billingJobs(env).issueCareDraft({ documentId: body.documentId });
  logEvent("care.issue", { result: answer.result, reasons: answer.reasons.length });
  return answer.result;
}

// ---- a message that ran out of tries -------------------------------------------------------------------------------------------

/** One bell per owner for a plan or draft that could not be billed, once per IST day (the entity carries the day, the bell's unique index does the rest). */
const FAILED_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'care.billing_failed', ?1, ?2, ?3, ?4 FROM staff_users u WHERE u.role = 'owner' AND u.status = 'active'`;

/**
 * A `care.bill` or `care.issue` that ran out of tries: the owners are told once per plan (or draft) per IST day, so a broken night does not bury them. The title names no client and no amount.
 * Tomorrow's scan lists the plan again (its period is still not billed), so nothing else is needed.
 */
export async function processCareDeadLetter(
  env: Env,
  body: { kind: "care.bill"; planId: string } | { kind: "care.issue"; documentId: string },
  now = Date.now(),
): Promise<void> {
  // An issue whose invoice is already frozen failed only at its PDF request (admin `care-billing.ts` throws so the issue is retried): the invoice WAS issued, so the
  // "could not be issued" bell would be false. The 03:30 IST sweep asks for the PDF again (review L4).
  if (body.kind === "care.issue") {
    const issued = await env.DB.prepare(
      "SELECT 1 AS issued FROM documents WHERE id = ?1 AND frozen_at IS NOT NULL",
    )
      .bind(body.documentId)
      .first<{ issued: number }>();
    if (issued) {
      logEvent("care.dead_letter_issued", { kind: body.kind });
      return;
    }
  }
  const day = todayIst(now);
  const [entityType, id, link] =
    body.kind === "care.bill"
      ? ["care_plan", body.planId, `/care-plans/${body.planId}`]
      : ["document", body.documentId, `/invoices/${body.documentId}`];
  // 07-U §7 "Care invoice failed": the client and the period. A plan that cannot be read keeps a plain line; the two lines without a plan or for an issue failure are approved in 07-W §2 (word for word).
  const plan =
    body.kind === "care.bill"
      ? await env.DB.prepare(
          "SELECT p.start_date, p.billing_day, k.display_name FROM care_plans p JOIN clients k ON k.id = p.client_id WHERE p.id = ?1",
        )
          .bind(body.planId)
          .first<{ start_date: string; billing_day: number; display_name: string }>()
      : null;
  const period = plan
    ? planPeriodOf(day, { startDate: plan.start_date, billingDay: plan.billing_day })
    : null;
  const title =
    body.kind === "care.bill"
      ? plan && period
        ? `The care invoice for ${plan.display_name} (${periodWords(period)}) couldn't be drafted. Open the care plan to see why.`
        : `A care invoice couldn't be drafted. Open the care plan to see why.`
      : `A care invoice draft could not be issued by itself. Check the draft.`;
  await env.DB.prepare(FAILED_BELL_SQL).bind(entityType, `${id}:${day}`, title, link).run();
  logEvent("care.dead_letter", { kind: body.kind });
}
