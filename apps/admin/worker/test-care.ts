// Fixtures of the care-plan, time-log and dashboard tests (M3.5): rows written straight to the test database, sessions that survive a
// faked clock, and the IST date. Codes use `T####` / `PRJ-T####` like the other fixtures so the API's own sequences are not disturbed.
import { env } from "cloudflare:workers";
import type { Role } from "@techaust/core";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import { insert, mkClient } from "./test-clients.ts";
import { sessionFor, type TestSession } from "./test-helpers.ts";
import { mkProject } from "./test-projects.ts";

/** Today in IST, as the API reads it. */
export const today = (now = Date.now()) => toIsoDate(istDate(now));

let tick = 1_700_000_000_000;
const next = () => ++tick;

/** A member with a session that stays valid whatever a test does to the clock. */
export async function longSession(role: Role, opts: { name?: string } = {}): Promise<TestSession> {
  const s = await sessionFor(role, opts);
  const far = 4_000_000_000_000;
  await env.DB.prepare("UPDATE staff_sessions SET idle_expires_at = ?2, abs_expires_at = ?2 WHERE id = ?1")
    .bind(s.sessionId, far)
    .run();
  return s;
}

export type PlanOpts = {
  clientId?: string;
  start?: string;
  billingDay?: number;
  tier?: string;
  price?: number;
  included?: number;
  rate?: number | null;
  rollover?: "none" | "one_month";
  currency?: "INR" | "USD";
};

/** A care plan with its first terms row and an active status row, as the API writes them (`by` is a member id). */
export async function mkPlan(by: string, o: PlanOpts = {}) {
  const id = uuidv7();
  const client =
    o.clientId ??
    (await mkClient(
      o.currency === "USD"
        ? { currency: "USD", gst_status: "overseas", state_code: null, country: "US" }
        : {},
    ));
  const start = o.start ?? "2026-01-01";
  const created = Date.now() - 1000;
  const row = {
    tier: o.tier ?? "growth",
    price_minor: o.price ?? 2_499_900,
    included_minutes: o.included ?? 600,
    ai_ops_minor: null,
    overage_rate_minor: o.rate === undefined ? 150_000 : o.rate,
    rollover: o.rollover ?? "none",
  };
  await insert("care_plans", {
    id,
    client_id: client,
    currency: o.currency ?? "INR",
    start_date: start,
    billing_day: o.billingDay ?? 1,
    status: "active",
    created_at: created,
    updated_at: created,
    ...row,
  });
  await insert("care_plan_terms", {
    id: uuidv7(),
    care_plan_id: id,
    effective_from: start,
    created_by: by,
    created_at: created,
    ...row,
  });
  await insert("care_plan_status_log", {
    id: uuidv7(),
    care_plan_id: id,
    status: "active",
    effective_on: start,
    created_by: by,
    created_at: created,
  });
  return { id, client, updatedAt: created };
}

/** An entry written straight to the database (the triggers still apply). */
export async function mkLog(
  userId: string,
  date: string,
  minutes: number,
  target: { project?: string; plan?: string },
  over: Record<string, unknown> = {},
) {
  const id = uuidv7();
  const t = next();
  await insert("time_logs", {
    id,
    user_id: userId,
    work_date: date,
    minutes,
    project_id: target.project ?? null,
    care_plan_id: target.plan ?? null,
    billable: 1,
    created_at: t,
    updated_at: t,
    ...over,
  });
  return { id, updatedAt: (over.updated_at as number | undefined) ?? t };
}

/** A project that takes time (planned, active, completed or cancelled). */
export async function mkOpenProject(status = "active", clientId?: string) {
  const client = clientId ?? (await mkClient());
  const p = await mkProject(client, { status });
  return { ...p, clientId: client };
}
