// The retention clean-up's families and cut-offs (M7.4 B.2; ADM-SET-09, NFR-9, JOB-CRON-01; run file docs/runs/m7.4-data-protection.md A.6). Pure: the
// nightly `retention.start` computes one cut-off per family from the stored `retention` settings and the run's `asOf`, and every page of that family (dry
// run and live alike) binds the same number, so the report and the deletion see one snapshot. `@techaust/db/retention` holds the SQL (B.5).
//
// Setting-driven figures are IST calendar months back from the start of the run's IST day; no setting can bring a cut-off closer than the database floor of
// 366 days (Rule 8(3)'s "minimum period of one year", across 29 February; Researched 2026-10-28, DPDP Rules 2025 Rule 8(3) (08-C RB-09); Settled by the
// lead on the safest reading, 2026-11-06 (08-C RB-48), L34), which the M7.4 triggers hold again on every DELETE and on the audit scrub. The `consent` family
// also ends the `erased` stop rows (L29; Settled by the lead on the safest reading, 2026-11-06 (08-C RB-46)). The fixed figures are lead decisions L12, L13,
// L15 (sessions and sign-in links 30 days after expiry, bells 90 days once read and 12 months in all, per-plan statistics 24 months); counters go after 2
// days; the run records after 13 months.
import { addMonths, fromIst, istDate } from "./dates.ts";
import { RETENTION_FLOORS } from "./schemas/settings.ts";

const DAY_MS = 86_400_000;

/**
 * The job families of the retention matrix (A.6), one `retention.page` message each per run. The lead purge keeps its own job (`lead.purge.scan`, under the
 * same live switch) and `statement_pdfs` keeps `statement.purge`; `r2_deletions` is drained by `r2.drain`.
 */
export const RETENTION_FAMILIES = [
  "email_log",
  "email_events",
  "access_log",
  "audit_ip",
  "sessions",
  "counters",
  "bells",
  "stats",
  "requests",
  "consent",
  "runs",
] as const;
export type RetentionFamily = (typeof RETENTION_FAMILIES)[number];
export const isRetentionFamily = (v: unknown): v is RetentionFamily =>
  typeof v === "string" && (RETENTION_FAMILIES as readonly string[]).includes(v);

/** The run modes (`retention_runs.mode`; pinned to the M7.4 trigger in A). */
export const RETENTION_MODES = ["dry_run", "live"] as const;
export type RetentionMode = (typeof RETENTION_MODES)[number];

/** The retention figures the cut-offs read (the stored `retention` setting; `requestsMonths` and `consentProofMonths` join it in A.8). */
export type RetentionFigures = {
  readonly emailLogMonths: number;
  readonly securityLogMonths: number;
  readonly requestsMonths: number;
  readonly consentProofMonths: number;
};

/**
 * The least each figure may be, in months: the settings floors (`RETENTION_FLOORS`, the one place they live; A.8 added `requestsMonths` and
 * `consentProofMonths`).
 */
export const FIGURE_FLOORS = {
  emailLogMonths: RETENTION_FLOORS.emailLogMonths,
  securityLogMonths: RETENTION_FLOORS.securityLogMonths,
  requestsMonths: RETENTION_FLOORS.requestsMonths,
  consentProofMonths: RETENTION_FLOORS.consentProofMonths,
} as const satisfies Record<keyof RetentionFigures, number>;

/** The database floor every DELETE trigger and the audit scrub hold (A, "Floors no setting can cross"): 366 days, so nothing goes before a full year across 29 February (L34). */
export const TRIGGER_FLOOR_DAYS = 366;

/**
 * Early check 1 L2: the cut-off stays this much further back than `asOf` minus the floor, so a Worker clock ahead of the database's (whose `unixepoch` the
 * triggers read) never selects a row the floor trigger then refuses, which would abort the whole page.
 */
export const CLOCK_SKEW_MARGIN_MS = 3_600_000;

/**
 * The families a database floor guards, and the triggers that hold it (each refuses a row younger than `TRIGGER_FLOOR_DAYS`; pinned to the installed
 * triggers by a db test). The audit scrub is an UPDATE of `ip` and `user_agent` to NULL and of the three `alert.*` summaries' `ua`, `city` and `country`
 * (Q3 A; L33), held by the re-created `audit_log_no_update`. The consent family also deletes the `erased` stop rows (L29); those have no floor trigger,
 * because the Owner's "Allow emails again" (M7.2) and the lift (L20) delete stop rows of any age: their floor is the job's predicate only.
 */
export const FLOORED_FAMILIES = {
  email_log: ["email_log_delete_floor"],
  email_events: ["email_events_delete_floor"],
  access_log: ["access_log_delete_floor"],
  audit_ip: ["audit_log_no_update"],
  requests: ["client_requests_delete_guard"],
  consent: ["consent_receipts_no_delete"],
} as const satisfies Partial<Record<RetentionFamily, readonly string[]>>;

/** Which setting drives each setting-driven family. */
const FIGURE_OF = {
  email_log: "emailLogMonths",
  email_events: "emailLogMonths",
  access_log: "securityLogMonths",
  audit_ip: "securityLogMonths",
  requests: "requestsMonths",
  consent: "consentProofMonths",
} as const satisfies Record<keyof typeof FLOORED_FAMILIES, keyof RetentionFigures>;

/** The fixed figures (lead decisions L12, L13, L15). */
export const FIXED_RETENTION = {
  /** `staff_sessions`, `client_sessions`, `magic_link_tokens`: 30 days after they expired (L12). */
  sessionsDays: 30,
  /** `auth_attempts` windows, `pdf_asks`, `hook_failures`: 2 days. */
  countersDays: 2,
  /** Bells: once read, 90 days (L13). */
  bellsReadDays: 90,
  /** Bells: any, 12 months (L13). */
  bellsMonths: 12,
  /** Per-plan `stats_daily` rows: 24 months; the aggregate rows are kept (L15). */
  statsMonths: 24,
  /** `retention_runs` and their counts: 13 months. */
  runsMonths: 13,
} as const;

/**
 * A family's cut-off: rows older than `before` (strictly) are due. `readBefore` is the bells' second rule (a read bell older than it is due as well).
 */
export type RetentionCutoff = { readonly before: number; readonly readBefore?: number };

const assertMs = (ms: number) => {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError(`Expected UTC milliseconds: ${ms}`);
};

/** The start of the IST day `months` calendar months before `asOf`'s IST day. */
const monthsBack = (asOf: number, months: number): number => fromIst(addMonths(istDate(asOf), -months));

/** A setting's figure raised to its floor; anything but a whole number is refused (a corrupted setting never moves a cut-off). */
function figureOf(figures: RetentionFigures, key: keyof RetentionFigures): number {
  const v = figures[key];
  if (!Number.isSafeInteger(v)) throw new RangeError(`Retention figure ${key} is not a whole number: ${v}`);
  return Math.max(v, FIGURE_FLOORS[key]);
}

/**
 * The cut-off of `family` for a run at `asOf` (UTC ms). Setting-driven families: the start of the IST day that many calendar months back, and never later
 * than `asOf` minus the one-year database floor and `CLOCK_SKEW_MARGIN_MS`. Throws on a malformed figure or time.
 */
export function cutoffOf(family: RetentionFamily, figures: RetentionFigures, asOf: number): RetentionCutoff {
  assertMs(asOf);
  switch (family) {
    case "sessions":
      return { before: asOf - FIXED_RETENTION.sessionsDays * DAY_MS };
    case "counters":
      return { before: asOf - FIXED_RETENTION.countersDays * DAY_MS };
    case "bells":
      return {
        before: monthsBack(asOf, FIXED_RETENTION.bellsMonths),
        readBefore: asOf - FIXED_RETENTION.bellsReadDays * DAY_MS,
      };
    case "stats":
      return { before: monthsBack(asOf, FIXED_RETENTION.statsMonths) };
    case "runs":
      return { before: monthsBack(asOf, FIXED_RETENTION.runsMonths) };
    case "email_log":
    case "email_events":
    case "access_log":
    case "audit_ip":
    case "requests":
    case "consent": {
      const months = figureOf(figures, FIGURE_OF[family]);
      return {
        before: Math.min(monthsBack(asOf, months), asOf - TRIGGER_FLOOR_DAYS * DAY_MS - CLOCK_SKEW_MARGIN_MS),
      };
    }
    default:
      throw new RangeError(`Unknown retention family: ${String(family satisfies never)}`);
  }
}

/** Every family's cut-off for one run (what `retention.start` puts on each `retention.page` message). */
export function cutoffsOf(figures: RetentionFigures, asOf: number): Record<RetentionFamily, RetentionCutoff> {
  const out = {} as Record<RetentionFamily, RetentionCutoff>;
  for (const f of RETENTION_FAMILIES) out[f] = cutoffOf(f, figures, asOf);
  return out;
}

/** A trial report older than this can't turn real deletion on (C.7; Q1 A). */
export const TRIAL_REPORT_MAX_AGE_MS = 7 * DAY_MS;

export type RetentionLiveVerdict = "ok" | "no_trial_report" | "trial_report_stale";

/**
 * Whether the Owner may turn real deletion on (Q1 A, C.7): only with a dry run that finished within the last 7 days. `lastDryRun` is the newest dry run (or
 * null); one still running has no `finishedAt`. Turning real deletion off is always allowed and needs no verdict. The route holds the same rule in its
 * UPDATE's WHERE (`TRIAL_REPORT_FRESH_SQL`).
 */
export function retentionLiveVerdict(input: {
  readonly lastDryRun: { readonly finishedAt: number | null } | null;
  readonly now: number;
}): RetentionLiveVerdict {
  const finished = input.lastDryRun?.finishedAt ?? null;
  if (finished === null || !Number.isSafeInteger(finished)) return "no_trial_report";
  return input.now - finished > TRIAL_REPORT_MAX_AGE_MS ? "trial_report_stale" : "ok";
}

/**
 * The real-deletion switch as it stands (C.7, L4): the newest `retention_switches` row (`live` 0/1, who, the dry run it relied on, when); no row is off. B2:
 * the brief's `retention_live` settings row can't exist (`settings.key` is held by a CHECK), so the switch is its own append-only table.
 */
export const RETENTION_SWITCH_SQL =
  "SELECT s.live, s.by, (SELECT name FROM staff_users WHERE id = s.by) AS by_name, s.run_id, s.at FROM retention_switches s INDEXED BY retention_switches_at ORDER BY s.at DESC, s.id DESC LIMIT 1";

/** The SQL twin of `retentionLiveVerdict(...) === "ok"` over `retention_runs` (`now` a placeholder or expression giving UTC ms). */
export const TRIAL_REPORT_FRESH_SQL = (now: string): string =>
  `EXISTS (SELECT 1 FROM retention_runs WHERE mode = 'dry_run' AND finished_at IS NOT NULL AND finished_at >= (${now}) - ${TRIAL_REPORT_MAX_AGE_MS})`;
