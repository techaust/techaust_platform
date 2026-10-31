// Settings API [ADM-SET-01..10, ADM-G-06, ADM-AUD-01]: the ten groups of docs/04 section 5.18. Eight are JSON documents in
// `settings` (company, tax, numbering, payment terms, gateways, email, retention, flags), validated by the shared schemas of
// `@techaust/core/settings`; bank details are `bank_accounts` rows; document terms are the append-only version tables.
//
// Rules that hold for every save:
//  - optimistic concurrency on the row's `version` (409 `stale_version`); one conditional statement + its audit row + its access
//    row in ONE batch (`mutate`), so a lost race writes nothing;
//  - the audit row carries a before -> after diff of the CHANGED fields only; bank account numbers are masked there ("[masked]")
//    and in every response (last four characters only), and are never logged;
//  - a stored row is read as the defaults merged under it (`resolveSetting`), so rows saved before a field existed still read;
//  - changes affect new documents only (nothing here edits an issued document).

import { hex } from "@techaust/auth";
import { auditSummary } from "@techaust/core/audit";
import { ACCOUNT_NO, cleanAccountNo, IFSC, SWIFT } from "@techaust/core/bank";
import { formatIstDateTime, fyOf } from "@techaust/core/dates";
import { EMAIL_TEMPLATES, type EmailTemplate } from "@techaust/core/email-templates";
import { uuidv7 } from "@techaust/core/ids";
import {
  HOUSE_RULE_ITEMS,
  INVOICE_CHECKLIST,
  isHouseRuleItem,
  issueDateOf,
  lutFor,
  lutReminder,
  PURPOSE_CODE,
} from "@techaust/core/invoices";
import { deleteAfterSql, LEAD_DELETABLE_SQL, LEAD_PURGE_NOTICE_DAYS } from "@techaust/core/lead-lifecycle";
import {
  canSetNextNumber,
  maxNumber,
  numberingClashes,
  SERIES,
  type Series,
  validateFormat,
} from "@techaust/core/numbering";
import { type Action, decide } from "@techaust/core/permissions";
import {
  BRAND_LOGOS,
  foldLegacyLut,
  GATEWAY_SECRETS,
  GATEWAYS,
  legacyLutFate,
  numberingClashMessage,
  panOf,
  resolveSetting,
  SETTINGS_DEFAULTS,
  SETTINGS_SCHEMAS,
  type SeededSettingKey,
  type Settings,
  storedNumberingSettings,
} from "@techaust/core/settings";
import { lutsOf } from "@techaust/core/tax";
import {
  TERMS_BLOCK_IDS,
  TERMS_BLOCKS,
  type TermsBlockId,
  termsBody,
  termsDueDays,
  termsDueDaysMismatch,
  termsTarget,
} from "@techaust/core/terms";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import {
  type ApiError,
  type AppEnv,
  actor,
  type Ctx,
  err,
  mutate,
  NOT_FOUND,
  type SideGuard,
} from "./context.ts";
import { sampleData, TEMPLATE_NAMES } from "./email-fixtures.ts";
import { param } from "./http.ts";
import { queueEmail } from "./mail.ts";
import { ANNUAL_RETURN_FUTURE } from "./note-model.ts";

/** 07-S §3: the hint of a statutory checklist item. */
const CHECKLIST_STATUTORY = {
  code: "checklist_item_statutory",
  message: "Required by GST law, so it can't be turned off.",
} as const;

/** FX-5 (full audit C4): the proposal terms state due days other than Settings › Payment terms. The SPA shows its own line (07-Z §2). */
const TERMS_DUE_DAYS_MISMATCH = {
  code: "terms_due_days_mismatch",
  message: "The terms give a different number of days to pay than Settings › Payment terms",
} as const;

/** The notice before a lead is deleted: a re-dated lead is never due sooner than this (Researched 2026-10-28, DPDP Act s.8(7), Rule 8 (08-C RB-10)). */
const LEAD_NOTICE_MS = LEAD_PURGE_NOTICE_DAYS * 86_400_000;

const STALE: ApiError = {
  code: "stale_version",
  message: "Someone saved these settings since you opened them. Reload to see the latest, then try again",
};
const LIVE_LOCKED: ApiError = { code: "live_locked", message: "Live is locked until go-live" };
const SERIES_IN_USE: ApiError = {
  code: "series_in_use",
  message:
    "That numbering series has already issued a number this financial year, so its format and next number can't change",
};
const SERIES_LOCK_REASON = "A number from this series has been issued this financial year";
const NEXT_LOWER: ApiError = {
  code: "next_number_lower",
  message: "The next number can only go up, never down",
};
const TEST_LIMIT: ApiError = {
  code: "rate_limited",
  message: "Five test emails an hour is the limit. Try again later",
};
const FORBIDDEN_GROUP: ApiError = { code: "forbidden", message: "You can't do that" };

/** The groups served by `/settings/groups/:group` (bank, gateways and terms have their own routes). */
const GENERIC = ["company", "tax", "numbering", "payment_terms", "email", "retention", "flags"] as const;
type Generic = (typeof GENERIC)[number];
const READ_ACTION: Record<Generic, Action> = {
  company: "settings.manage",
  tax: "settings.taxNumbering.read",
  numbering: "settings.taxNumbering.read",
  payment_terms: "settings.manage",
  email: "settings.manage",
  retention: "settings.manage",
  flags: "settings.manage",
};
// Which list in 08-C §5 holds a group's open questions (FX-3: a pointer, never a bare "VERIFY WITH" tag). The SPA shows the researched-settings note
// when it is present and names the lawyer when it says so (settings/kit.tsx).
const VERIFY: Partial<Record<Generic | "gateways", string>> = {
  tax: "08-C §5: CA",
  payment_terms: "08-C §5: CA and lawyer",
  retention: "08-C §5: CA and lawyer",
};

const groupParam = z.object({ group: z.enum(GENERIC) });
const kindParam = z.object({ kind: z.enum(["INR", "USD_SWIFT"]) });
const blockParam = z.object({ block: z.string().check(z.minLength(1), z.maxLength(40)) });

/** `{ error, fields }` for a body that failed its schema: the field paths and our own messages, never the values. */
const invalid = (c: Ctx, issues: readonly { path: readonly PropertyKey[]; message: string }[]) =>
  c.json(
    {
      error: { code: "invalid", message: "Check the form and try again" },
      fields: issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
      request_id: c.var.rid,
    },
    400,
  );

async function bodyOf(c: Ctx): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

type Row = { value: unknown; version: number; updatedAt: number };
export async function loadRow(db: D1Database, key: SeededSettingKey): Promise<Row | null> {
  const r = await db
    .prepare("SELECT value, version, updated_at FROM settings WHERE key = ?1")
    .bind(key)
    .first<{ value: string; version: number; updated_at: number }>();
  return r ? { value: JSON.parse(r.value), version: r.version, updatedAt: r.updated_at } : null;
}

/** The conditional write: inserts the row, or updates it only while it is still at the version the person saw. */
/**
 * The conditional write: inserts the row, or updates it only while it is still at the version the person saw. `guard` adds a
 * condition that is checked by the same statement (numbering: no series being changed may have an issued document this year, L-d),
 * so there is no gap between the check and the write.
 */
export const upsert = (guard = "") => `INSERT INTO settings (key, value, version, updated_by, updated_at)
 SELECT ?1, ?2, ?3 + 1, ?4, ?5 WHERE (SELECT coalesce(max(version), 0) FROM settings WHERE key = ?1) = ?3${guard}
 ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = excluded.version, updated_by = excluded.updated_by, updated_at = excluded.updated_at
 WHERE settings.version = ?3`;

type Opts<K extends SeededSettingKey> = {
  /** A rule that depends on the stored value or the environment; returns the refusal, or null. */
  rule?: (before: Settings[K], after: Settings[K]) => Promise<Response | null> | Response | null;
  /** Extra audit fields and statements (numbering's next numbers). */
  extra?: Extra;
  /** A condition (SQL over numbered params from ?6) that must hold in the write itself; if the write is refused, `refused` says why. */
  guardFor?: (before: Settings[K], after: Settings[K]) => Guard | undefined;
  /** The schema the value is parsed with, instead of the group's save schema (numbering: lenient on a stored format; `rule` then holds the changed ones to the strict rules). */
  schema?: (typeof SETTINGS_SCHEMAS)[K];
  /** The same, decided from the before and after values (retention re-dates the leads only when the leads figure changed). */
  extraFor?: (before: Settings[K], after: Settings[K]) => Extra | undefined;
};
type Guard = { sql: string; params: unknown[]; refused: () => Promise<Response | null> };
type Extra = { summary: Record<string, unknown>; side: (g: SideGuard) => D1PreparedStatement[] };

/** Validate, check the version, diff, and write one JSON settings document with its audit row. */
async function save<K extends SeededSettingKey>(
  c: Ctx,
  key: K,
  value: unknown,
  version: number,
  opts: Opts<K> = {},
) {
  const parsed = (opts.schema ?? SETTINGS_SCHEMAS[key]).safeParse(value);
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const after = parsed.data as Settings[K];
  const row = await loadRow(c.env.DB, key);
  const current = row?.version ?? 0;
  if (version !== current)
    return c.json({ error: STALE, current_version: current, request_id: c.var.rid }, 409);
  const before = resolveSetting(key, row?.value);
  const refused = await opts.rule?.(before, after);
  if (refused) return refused;
  const diff = auditSummary(before as Record<string, unknown>, after as Record<string, unknown>);
  const extra = opts.extra ?? opts.extraFor?.(before, after);
  const guard = opts.guardFor?.(before, after);
  if (!Object.keys(diff).length && !extra) return c.json({ ok: true, changed: false, version: current });
  const u = actor(c);
  const done = await mutate(c, {
    main: c.env.DB.prepare(upsert(guard ? ` AND ${guard.sql}` : "")).bind(
      key,
      JSON.stringify(after),
      current,
      u.id,
      Date.now(),
      ...(guard?.params ?? []),
    ),
    action: `settings.${key}.update`,
    entityType: "settings",
    entityId: key,
    summary: { ...diff, ...extra?.summary },
    ...(extra ? { side: (g) => extra.side(g) } : {}),
  });
  if (!done)
    return (
      (await guard?.refused()) ??
      c.json({ error: STALE, current_version: current, request_id: c.var.rid }, 409)
    );
  return c.json({ ok: true, changed: true, version: current + 1 });
}

const envelope = z.object({ version: z.int().check(z.gte(0)), value: z.unknown() });
const numberingEnvelope = z.object({
  version: z.int().check(z.gte(0)),
  value: z.unknown(),
  nextNumbers: z.optional(
    z.partialRecord(z.enum(Object.keys(SERIES) as [Series, ...Series[]]), z.int().check(z.gte(1))),
  ),
});

// ---- reading -------------------------------------------------------------------------------------------------------

/** Live mode is allowed only once the owner's go-live sets the deploy-time variable (ADM-SET-06, Phase 7). The type is the literal from wrangler.jsonc, so compare as text. */
const liveAllowed = (env: Env) => (env.PAYMENTS_LIVE_ALLOWED as string) === "true";

type GatewayStatus = Record<(typeof GATEWAYS)[number], { configured: boolean; missing: readonly string[] }>;
/** Which Worker secrets exist, by name (a value is never read out or returned). */
const gatewayStatus = (env: Env): GatewayStatus => {
  const has = (name: string) => Boolean((env as unknown as Record<string, unknown>)[name]);
  const one = (g: (typeof GATEWAYS)[number]) => {
    const missing = GATEWAY_SECRETS[g].filter((name) => !has(name));
    return { configured: missing.length === 0, missing };
  };
  return { razorpay: one("razorpay"), stripe: one("stripe"), paypal: one("paypal") };
};

type CounterRow = { series: string; next_no: number };
const counters = async (db: D1Database, fy: string) =>
  (await db.prepare("SELECT series, next_no FROM doc_counters WHERE fy = ?1").bind(fy).all<CounterRow>())
    .results;

/**
 * The series that have an issued document this financial year (a number is assigned only at issue, so `number IS NOT NULL` is
 * "issued"; a voided document keeps its number). Served by the unique index (series, fy, number). Once a series is in this set,
 * its format and next number are locked: changing either would leave a gap or a different style inside the printed run
 * (CGST Rule 46(b); Researched 2026-10-28, Rule 46 CGST Rules (08-C RA-05)).
 */
const issuedSeries = async (db: D1Database, fy: string): Promise<Set<string>> => {
  const names = Object.keys(SERIES);
  const marks = names.map((_, i) => `?${i + 2}`).join(", ");
  const { results } = await db
    .prepare(
      `SELECT DISTINCT series FROM documents WHERE fy = ?1 AND series IN (${marks}) AND number IS NOT NULL`,
    )
    .bind(fy, ...names)
    .all<{ series: string }>();
  return new Set(results.map((r) => r.series));
};

type BankRow = {
  id: string;
  kind: string;
  account_name: string;
  account_no: string;
  ifsc: string | null;
  swift: string | null;
  bank_name: string;
  branch: string | null;
  bank_address: string | null;
  intermediary: string | null;
  purpose_code: string | null;
  updated_at: number;
};
const BANK_COLUMNS =
  "id, kind, account_name, account_no, ifsc, swift, bank_name, branch, bank_address, intermediary, purpose_code, updated_at";
const bankRows = async (db: D1Database) =>
  (
    await db
      .prepare(`SELECT ${BANK_COLUMNS} FROM bank_accounts WHERE active = 1 ORDER BY created_at DESC, id DESC`)
      .all<BankRow>()
  ).results;

/** Last four characters only; the number itself never leaves the database in an admin response (ADM-SET-02). */
const last4 = (n: string) => n.slice(-4);
const bankView = (kind: "INR" | "USD_SWIFT", r: BankRow | undefined) => ({
  kind,
  exists: r !== undefined,
  accountName: r?.account_name ?? null,
  accountNoLast4: r ? last4(r.account_no) : null,
  ifsc: r?.ifsc ?? null,
  swift: r?.swift ?? null,
  bankName: r?.bank_name ?? null,
  branch: r?.branch ?? null,
  bankAddress: r?.bank_address ?? null,
  intermediary: r?.intermediary ?? null,
  /** M5.2 (LD30): the RBI purpose code printed on a USD invoice's SWIFT block. */
  purposeCode: r?.purpose_code ?? null,
  updatedAt: r?.updated_at ?? null,
});

async function groupMeta(c: Ctx, group: Generic | "gateways", value: unknown) {
  const verify = VERIFY[group];
  switch (group) {
    case "company":
      return { pan: panOf((value as Settings["company"]).gstin), logos: BRAND_LOGOS };
    case "numbering": {
      const fy = fyOf(Date.now()).token;
      const [rows, issued] = await Promise.all([counters(c.env.DB, fy), issuedSeries(c.env.DB, fy)]);
      return {
        fy,
        series: Object.keys(SERIES).map((s) => {
          const nextNo = rows.find((r) => r.series === s)?.next_no ?? 1;
          // `used` = a document of this series was issued this FY; `locked` is the same fact for the screen (format and next
          // number read-only, with `lockReason`). A start number set before the first issue does not lock anything.
          const locked = issued.has(s);
          return { series: s, nextNo, used: locked, locked, lockReason: locked ? SERIES_LOCK_REASON : null };
        }),
      };
    }
    case "tax":
      // M5.2 (ADM-INV-18): the derived, unstored LUT reminder for today (IST): `due` in March while the next FY has no letter, `currentMissing` while the running FY has none.
      return {
        verify,
        lutStatus: lutReminder(
          issueDateOf(Date.now()),
          lutsOf((value as Settings["tax"]) ?? SETTINGS_DEFAULTS.tax),
        ),
        // The checklist of 07-S §3 with its house rules marked (owner 2026-10-28): only `houseRule` items can be switched off (`checklist_item_statutory` otherwise).
        checklist: INVOICE_CHECKLIST.map((i) => ({
          id: i.id,
          houseRule: isHouseRuleItem(i.id),
          available: i.available,
        })),
        houseRuleItems: HOUSE_RULE_ITEMS,
      };
    case "payment_terms": {
      // FX-5 (full audit C4): the newest proposal terms' "due within N days", so the screen can say when a changed due-days setting no longer
      // matches them (the terms save refuses a mismatch; the setting is saved first, then the terms).
      const terms = await c.env.DB.prepare(
        "SELECT body_md FROM terms_versions WHERE kind = 'proposal' ORDER BY version DESC LIMIT 1",
      ).first<{ body_md: string }>();
      const stated = terms ? termsDueDays(terms.body_md) : [];
      const dueDays = (value as Settings["payment_terms"]).dueDays;
      return { verify, termsDueDays: { stated, matches: stated.every((n) => n === dueDays) } };
    }
    case "retention":
      return {
        verify,
        notes:
          "Legal hold and the nightly deletion job arrive in M7.4; these figures are stored and enforced as minimums only.",
      };
    default:
      return verify ? { verify } : {};
  }
}

// ---- routes --------------------------------------------------------------------------------------------------------

export const settings = new Hono<AppEnv>()
  // The overview: which groups this role may open, with a short "needs attention" note each.
  .get("/", async (c) => {
    const u = actor(c);
    const { results } = await c.env.DB.prepare("SELECT key, value, version, updated_at FROM settings").all<{
      key: string;
      value: string;
      version: number;
      updated_at: number;
    }>();
    const stored = new Map(results.map((r) => [r.key, r]));
    const get = <K extends SeededSettingKey>(k: K) =>
      resolveSetting(k, JSON.parse(stored.get(k)?.value ?? "null"));
    const can = (a: Action) => decide(u.role, a) !== "deny";
    const groups: { group: string; version: number | null; updatedAt: number | null; attention: string[] }[] =
      [];
    const row = (group: string, key: string, attention: string[] = []) =>
      groups.push({
        group,
        version: stored.get(key)?.version ?? null,
        updatedAt: stored.get(key)?.updated_at ?? null,
        attention,
      });
    if (can("settings.manage")) {
      const company = get("company");
      row(
        "company",
        "company",
        company.legalName && company.gstin && company.address ? [] : ["Company details not entered yet"],
      );
    }
    if (can("bank.readMasked")) {
      const banks = await bankRows(c.env.DB);
      groups.push({
        group: "bank",
        version: null,
        updatedAt: banks[0]?.updated_at ?? null,
        attention: banks.length ? [] : ["No bank details entered yet"],
      });
    }
    if (can("settings.taxNumbering.read")) {
      const tax = get("tax");
      // The LUT of the FY that is running (the list of M5.2, and the legacy single letter): none saved means an export under LUT is blocked.
      const noLut = lutFor(fyOf(Date.now()).token, lutsOf(tax)) === null;
      row("tax", "tax", tax.exportMode === "lut" && noLut ? ["LUT ARN missing"] : []);
      row("numbering", "numbering");
    }
    if (can("settings.manage")) {
      row("payment_terms", "payment_terms");
      const status = gatewayStatus(c.env);
      const open = GATEWAYS.filter((g) => !status[g].configured).length;
      row("gateways", "gateways", open ? [`${open} of ${GATEWAYS.length} gateways have no keys yet`] : []);
      row("email", "email");
      groups.push({ group: "terms", version: null, updatedAt: null, attention: [] });
      row("retention", "retention");
      row("flags", "flags");
    }
    return c.json({ groups });
  })

  .get("/groups/:group", param(groupParam), async (c) => {
    const { group } = c.req.valid("param");
    if (decide(actor(c).role, READ_ACTION[group]) === "deny") return err(c, FORBIDDEN_GROUP, 403);
    const row = await loadRow(c.env.DB, group);
    const resolved = resolveSetting(group, row?.value);
    // The old single `lut` is shown as a list entry (and cleared), so a letter deleted from the list is never sent back by the old key.
    const value = group === "tax" ? foldLegacyLut(resolved as Settings["tax"]) : resolved;
    return c.json({
      group,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? null,
      value,
      meta: await groupMeta(c, group, value),
    });
  })

  .put("/groups/:group", param(groupParam), async (c) => {
    const { group } = c.req.valid("param");
    const raw = await bodyOf(c);
    if (group === "numbering") return saveNumbering(c, raw);
    const env = envelope.safeParse(raw);
    if (!env.success) return invalid(c, env.error.issues);
    // The leads retention (ADM-SET-09): a new figure re-dates the deletion date of every lead the clean-up may delete, in the same
    // batch (after the settings write, so the shared SQL expression reads the new months). Converted leads and leads under legal
    // hold are left alone. A lowered figure never puts a date earlier than 14 days from now, so the notice period is kept
    // (the clean-up never deletes a lead the same day the owner lowers the months). Researched 2026-10-28, DPDP Act s.8(7), Rule 8 (08-C RB-10).
    if (group === "retention")
      return save(c, "retention", env.data.value, env.data.version, {
        extraFor: (before, after) =>
          before.leadsMonths === after.leadsMonths
            ? undefined
            : {
                summary: { leadsRedated: true },
                side: (g) => [
                  c.env.DB.prepare(
                    `UPDATE leads SET delete_after = max(${deleteAfterSql("coalesce(last_activity_at, created_at)")}, ${Date.now() + LEAD_NOTICE_MS}) WHERE ${LEAD_DELETABLE_SQL} AND ${g.sql(1)}`,
                  ).bind(...g.params),
                ],
              },
      });
    // The company form can neither set nor clear the signature image (only PUT/DELETE /settings/signature do): whatever the body says,
    // the stored reference is kept, so a form that never heard of the field cannot drop it.
    // T10 (rt2): the Udyam registration is the form's own field: `udyam: {number, category}` sets it and only an explicit `udyam: null` clears it (L8, lead
    // 2026-10-31); a body without the key keeps the stored number, so a tab opened before the field existed cannot wipe it. The schema accepts only the
    // canonical `UDYAM-XX-00-0000000` (L5: the form trims and upper-cases first), so anything else is 400 with 07-ZC line 4 on `udyam.number`. An issued tax invoice
    // keeps the number it froze (the issuer block is sealed), whatever is saved later.
    if (group === "company") {
      const stored = resolveSetting("company", (await loadRow(c.env.DB, "company"))?.value);
      const value = env.data.value;
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const keepUdyam = !Object.hasOwn(value, "udyam") && stored.udyam ? { udyam: stored.udyam } : {};
        return save(c, "company", { ...value, ...keepUdyam, signature: stored.signature }, env.data.version);
      }
    }
    // M5.2 (early check 3): a saved `tax` row never keeps the deprecated single `lut`: it is folded into `luts` (unless that FY is listed) and cleared.
    if (group === "tax") {
      // Owner 2026-10-28 (07-S §3; Researched 2026-10-28, Rule 46 CGST Rules, 08-C RA-05): only the house rules of the checklist may be switched; naming a statutory item is 400
      // `checklist_item_statutory` ("Required by GST law, so it can't be turned off."), whatever its value.
      const sent = (env.data.value as { invoiceChecklist?: unknown } | null)?.invoiceChecklist;
      if (typeof sent === "object" && sent !== null && !Array.isArray(sent)) {
        const statutory = Object.keys(sent).find(
          (k) => INVOICE_CHECKLIST.some((i) => i.id === k) && !isHouseRuleItem(k),
        );
        if (statutory)
          return c.json(
            {
              error: { code: CHECKLIST_STATUTORY.code, message: CHECKLIST_STATUTORY.message },
              fields: [{ path: `invoiceChecklist.${statutory}`, message: CHECKLIST_STATUTORY.message }],
              request_id: c.var.rid,
            },
            400,
          );
      }
      const parsed = SETTINGS_SCHEMAS.tax.safeParse(env.data.value);
      // M5.3 (G-11, Q33): the day an annual return was filed cannot be in the future (a filing that has not happened would close credit notes today).
      if (parsed.success) {
        const today = issueDateOf(Date.now());
        const future = parsed.data.annualReturnsFiled.findIndex((r) => r.filedOn > today);
        if (future >= 0)
          return c.json(
            {
              error: { code: ANNUAL_RETURN_FUTURE.code, message: ANNUAL_RETURN_FUTURE.message },
              fields: [
                { path: `annualReturnsFiled.${future}.filedOn`, message: ANNUAL_RETURN_FUTURE.message },
              ],
              request_id: c.var.rid,
            },
            400,
          );
      }
      if (parsed.success) {
        // A legacy letter the fold drops (its FY is already listed, or the list would refuse it) is dropped WITH a note in the log (the case and the FY,
        // never the ARN), so the save never fails on a field the person cannot see and the drop is never silent (review 8).
        const fate = legacyLutFate(parsed.data);
        if (fate.fate === "listed" || fate.fate === "invalid" || fate.fate === "full")
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "legacy LUT dropped on a tax save",
              case: fate.fate,
              fy: parsed.data.lut.fy,
              rid: c.var.rid,
            }),
          );
      }
      return save(c, "tax", parsed.success ? foldLegacyLut(parsed.data) : env.data.value, env.data.version);
    }
    return save(c, group, env.data.value, env.data.version);
  })

  // Gateways: the mode only (keys are Worker secrets). Live stays locked until the owner's go-live (PAYMENTS_LIVE_ALLOWED).
  .get("/gateways", async (c) => {
    const row = await loadRow(c.env.DB, "gateways");
    return c.json({
      group: "gateways",
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? null,
      value: resolveSetting("gateways", row?.value),
      meta: { status: gatewayStatus(c.env), liveAllowed: liveAllowed(c.env) },
    });
  })

  .put("/gateways", async (c) => {
    const env = envelope.safeParse(await bodyOf(c));
    if (!env.success) return invalid(c, env.error.issues);
    return save(c, "gateways", env.data.value, env.data.version, {
      rule: (before, after) => {
        const toLive = GATEWAYS.some((g) => after[g].mode === "live" && before[g].mode !== "live");
        return toLive && !liveAllowed(c.env) ? err(c, LIVE_LOCKED, 409) : null;
      },
    });
  })

  // Bank details (ADM-SET-02): masked in every response; a change needs a fresh step-up (the route's action).
  .get("/bank", async (c) => {
    const rows = await bankRows(c.env.DB);
    return c.json({
      accounts: (["INR", "USD_SWIFT"] as const).map((k) =>
        bankView(
          k,
          rows.find((r) => r.kind === k),
        ),
      ),
    });
  })

  .put("/bank/:kind", param(kindParam), async (c) => saveBank(c, c.req.valid("param").kind))

  // Document terms (ADM-SET-08): the five blocks, versioned.
  .get("/terms", async (c) => {
    const [latestBlocks, latestVersions] = await c.env.DB.batch<{
      id: string;
      kind: string;
      version: number;
      body_md: string;
      sha256: string;
      created_at: number;
      used_by?: number;
    }>([
      c.env.DB.prepare(
        "SELECT t.id, t.kind, t.version, t.body_md, t.sha256, t.created_at FROM terms_blocks t WHERE t.version = (SELECT max(version) FROM terms_blocks WHERE kind = t.kind)",
      ),
      c.env.DB.prepare(
        "SELECT t.id, t.kind, t.version, t.body_md, t.sha256, t.created_at, (SELECT count(*) FROM documents d WHERE d.terms_version_id = t.id) AS used_by FROM terms_versions t WHERE t.kind IN ('proposal', 'invoice') AND t.version = (SELECT max(version) FROM terms_versions WHERE kind = t.kind)",
      ),
    ]);
    const all = [...(latestBlocks?.results ?? []), ...(latestVersions?.results ?? [])];
    return c.json({
      blocks: TERMS_BLOCK_IDS.map((id) => {
        const t = TERMS_BLOCKS[id];
        const cur = all.find((r) => r.kind === t.kind);
        return {
          block: id,
          label: t.label,
          current: cur
            ? {
                version: cur.version,
                bodyMd: cur.body_md,
                sha256: cur.sha256,
                createdAt: cur.created_at,
                // Documents record the version they used only for the two blocks in `terms_versions`; the other three arrive with M5.
                usedBy: t.table === "terms_versions" ? (cur.used_by ?? 0) : null,
              }
            : null,
        };
      }),
      meta: {
        verify: "08-C §5: CA and lawyer",
        usedByNote:
          "Used-by counts exist for proposal terms and invoice footer notes; the other blocks are not yet recorded on documents.",
      },
    });
  })

  .get("/terms/:block", param(blockParam), async (c) => {
    const target = termsTarget(c.req.valid("param").block);
    if (!target) return err(c, NOT_FOUND, 404);
    const used =
      target.table === "terms_versions"
        ? ", (SELECT count(*) FROM documents d WHERE d.terms_version_id = t.id) AS used_by"
        : "";
    const { results } = await c.env.DB.prepare(
      `SELECT t.version, t.body_md, t.sha256, t.created_at${used} FROM ${target.table} t WHERE t.kind = ?1 ORDER BY t.version DESC LIMIT 50`,
    )
      .bind(target.kind)
      .all<{ version: number; body_md: string; sha256: string; created_at: number; used_by?: number }>();
    return c.json({
      block: c.req.valid("param").block,
      label: target.label,
      versions: results.map((r) => ({
        version: r.version,
        bodyMd: r.body_md,
        sha256: r.sha256,
        createdAt: r.created_at,
        usedBy: target.table === "terms_versions" ? (r.used_by ?? 0) : null,
      })),
    });
  })

  .post("/terms/:block", param(blockParam), async (c) => {
    const name = c.req.valid("param").block;
    const target = termsTarget(name);
    if (!target) return err(c, NOT_FOUND, 404);
    const id = name as TermsBlockId;
    const parsed = z.object({ body: termsBody(id) }).safeParse(await bodyOf(c));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const text = parsed.data.body;
    // FX-5 (full audit C4; Researched 2026-10-29, commercial settings (08-C RB-39)): the proposal terms are shared by every proposal, so a
    // "due within N days" they state must be the Settings › Payment terms due days; change the setting first, then the terms.
    if (id === "proposal_terms") {
      const dueDays = resolveSetting(
        "payment_terms",
        (await loadRow(c.env.DB, "payment_terms"))?.value,
      ).dueDays;
      const stated = termsDueDaysMismatch(text, dueDays);
      // The standard error shape (review L8): the numbers ride in `error.details`, read by the SPA's one details reader.
      if (stated.length > 0) return err(c, TERMS_DUE_DAYS_MISMATCH, 400, { stated, dueDays });
    }
    const sha = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
    const db = c.env.DB;
    const latest = await db
      .prepare(`SELECT version, sha256 FROM ${target.table} WHERE kind = ?1 ORDER BY version DESC LIMIT 1`)
      .bind(target.kind)
      .first<{ version: number; sha256: string }>();
    if (latest?.sha256 === sha) return c.json({ ok: true, changed: false, version: latest.version });
    const rowId = uuidv7();
    // The next version is computed by the INSERT itself (max + 1 of this kind, one statement); the unique (kind, version)
    // index turns two simultaneous saves into one 409 for the loser.
    const insert =
      target.table === "terms_blocks"
        ? db
            .prepare(
              "INSERT INTO terms_blocks (id, kind, version, body_md, sha256, created_by) SELECT ?1, ?2, coalesce(max(version), 0) + 1, ?3, ?4, ?5 FROM terms_blocks WHERE kind = ?2",
            )
            .bind(rowId, target.kind, text, sha, actor(c).id)
        : db
            .prepare(
              "INSERT INTO terms_versions (id, kind, version, body_md, sha256) SELECT ?1, ?2, coalesce(max(version), 0) + 1, ?3, ?4 FROM terms_versions WHERE kind = ?2",
            )
            .bind(rowId, target.kind, text, sha);
    try {
      await mutate(c, {
        main: insert,
        action: "settings.terms.update",
        entityType: "terms",
        entityId: id,
        // The block and the new text's fingerprint; the text itself stays in the terms table, not in the log.
        summary: { block: id, sha256: { before: latest?.sha256 ?? null, after: sha } },
        status: 201,
      });
    } catch (e) {
      if (/UNIQUE/.test(`${e instanceof Error ? e.message : ""} ${String((e as Error)?.cause ?? "")}`))
        return err(
          c,
          {
            code: "version_clash",
            message: "Someone saved a new version at the same moment. Reload and try again",
          },
          409,
        );
      throw e;
    }
    const saved = await db
      .prepare(`SELECT version FROM ${target.table} WHERE id = ?1`)
      .bind(rowId)
      .first<{ version: number }>();
    return c.json({ ok: true, changed: true, version: saved?.version ?? null, sha256: sha }, 201);
  })

  // Settings > Email "Send a test": one email to the signed-in member only (the address comes from the session, never the body).
  .post("/email/test-send", async (c) => {
    const parsed = z.object({ template: z.enum(EMAIL_TEMPLATES) }).safeParse(await bodyOf(c));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const template: EmailTemplate = parsed.data.template;
    const u = actor(c);
    const t = Date.now();
    // Five an hour per member, counted from the audit log (indexed by actor and time).
    const recent = await c.env.DB.prepare(
      "SELECT count(*) AS n FROM audit_log WHERE actor_id = ?1 AND action = 'settings.email.test_send' AND at > ?2",
    )
      .bind(u.id, t - 3_600_000)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= 5) return err(c, TEST_LIMIT, 429);
    const name = TEMPLATE_NAMES[template];
    const entityId = uuidv7();
    await mutate(c, {
      action: "settings.email.test_send",
      entityType: "settings",
      entityId: "email",
      summary: { template },
      status: 202,
    });
    queueEmail(c, {
      template,
      to: u.email,
      data: {
        ...sampleData(template, { name: u.name, role: u.role }, formatIstDateTime(t)),
        test_name: name,
      },
      entity: { type: "settings_test", id: entityId },
    });
    return c.json({ ok: true, queued: true, template }, 202);
  });

// ---- numbering -----------------------------------------------------------------------------------------------------

async function saveNumbering(c: Ctx, raw: unknown) {
  const env = numberingEnvelope.safeParse(raw);
  if (!env.success) return invalid(c, env.error.issues);
  const { version, value, nextNumbers = {} } = env.data;
  const fy = fyOf(Date.now()).token;
  const [have, issued] = await Promise.all([counters(c.env.DB, fy), issuedSeries(c.env.DB, fy)]);
  const nextOf = (s: string) => have.find((r) => r.series === s)?.next_no ?? 1;
  const asked = Object.entries(nextNumbers) as [Series, number][];
  const effective = asked.filter(([s, n]) => n !== nextOf(s));
  return save(c, "numbering", value, version, {
    // Every series is READ with the rules that held when it was stored; only a series this save CHANGES is held to the strict rules of today (LD18's first
    // character), so a stored pre-M5.1 format that breaks them never blocks a save of another series (M5.1 item). A series in use cannot change anyway.
    schema: storedNumberingSettings,
    rule: (before, after) => {
      const refusedFormats = (Object.keys(after) as Series[])
        .filter((s) => JSON.stringify(after[s]) !== JSON.stringify(before[s]))
        .flatMap((s) => {
          const check = validateFormat(after[s]);
          return check.ok ? [] : [{ path: [s], message: check.error }];
        });
      if (refusedFormats.length) return invalid(c, refusedFormats);
      // A0 2 (Researched 2026-10-28, Rules 46(b), 50(b), 51(b), 53(1A) CGST Rules (08-C RA-09)): no two series may print the same number. Judged only for a
      // pair with a series this save changes, like the format rules above, so a pair stored before this rule never blocks a save of another series.
      const changedNow = new Set(
        (Object.keys(after) as Series[]).filter(
          (s) => JSON.stringify(after[s]) !== JSON.stringify(before[s]),
        ),
      );
      const clashes = numberingClashes(after)
        .filter(([a, b]) => changedNow.has(a) || changedNow.has(b))
        .flatMap(([a, b]) => [
          { path: [a], message: numberingClashMessage(b) },
          { path: [b], message: numberingClashMessage(a) },
        ]);
      if (clashes.length) return invalid(c, clashes);
      // A series with an issued document this financial year is locked: its format AND its next number (any change, up or
      // down; a raised number leaves a gap in the series). Before the first issue both stay editable.
      const formatChanged = (Object.keys(after) as Series[]).filter(
        (s) => JSON.stringify(after[s]) !== JSON.stringify(before[s]),
      );
      const numberChanged = asked.filter(([s, n]) => n !== nextOf(s)).map(([s]) => s);
      const locked = [...new Set([...formatChanged, ...numberChanged])].filter((s) => issued.has(s));
      if (locked.length) return c.json({ error: SERIES_IN_USE, series: locked, request_id: c.var.rid }, 409);
      // The next number only goes up (the doc_counters trigger refuses a lower one too; this answers first, with a reason).
      const lower = asked.filter(([s, n]) => !canSetNextNumber(nextOf(s), n)).map(([s]) => s);
      if (lower.length) return c.json({ error: NEXT_LOWER, series: lower, request_id: c.var.rid }, 409);
      const over = asked.filter(([s, n]) => n > maxNumber(after[s]));
      if (over.length)
        return invalid(
          c,
          over.map(([s]) => ({
            path: ["nextNumbers", s],
            message: "That number doesn't fit the padding of this series",
          })),
        );
      return null;
    },
    // The series whose format or next number this save changes must not have an issued document this year: checked by the write
    // itself (L-d), so an invoice issued between the read above and the write cannot slip through. Researched 2026-10-28, Rule 46 CGST Rules (08-C RA-05) (CGST Rule 46(b)).
    guardFor: (before, after) => {
      const changed = [
        ...new Set([
          ...(Object.keys(after) as Series[]).filter(
            (s) => JSON.stringify(after[s]) !== JSON.stringify(before[s]),
          ),
          ...effective.map(([s]) => s),
        ]),
      ];
      if (!changed.length) return undefined;
      return {
        sql: `NOT EXISTS (SELECT 1 FROM documents d WHERE d.fy = ?6 AND d.number IS NOT NULL AND d.series IN (${changed.map((_, i) => `?${i + 7}`).join(", ")}))`,
        params: [fy, ...changed],
        refused: async () => {
          const now = await issuedSeries(c.env.DB, fy);
          const locked = changed.filter((s) => now.has(s));
          return locked.length
            ? c.json({ error: SERIES_IN_USE, series: locked, request_id: c.var.rid }, 409)
            : null;
        },
      };
    },
    // A next number equal to the current one changes nothing: no counter write, no version bump (answers changed: false).
    ...(effective.length
      ? {
          extra: {
            summary: {
              nextNumbers: {
                before: Object.fromEntries(effective.map(([s]) => [s, nextOf(s)])),
                after: Object.fromEntries(effective),
              },
            },
            side: (g) =>
              effective.map(([s, n]) =>
                c.env.DB.prepare(
                  `INSERT INTO doc_counters (series, fy, next_no) SELECT ?1, ?2, ?3 WHERE ${g.sql(4)} AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.series = ?1 AND d.fy = ?2 AND d.number IS NOT NULL) ON CONFLICT(series, fy) DO UPDATE SET next_no = excluded.next_no WHERE excluded.next_no >= doc_counters.next_no`,
                ).bind(s, fy, n, ...g.params),
              ),
          },
        }
      : {}),
  });
}

// ---- bank ----------------------------------------------------------------------------------------------------------

const bankBody = z.object({
  accountName: z.string().check(z.trim(), z.minLength(1), z.maxLength(120)),
  /** Empty or missing = keep the number already stored. */
  accountNo: z.optional(z.string().check(z.maxLength(60))),
  accountNoAgain: z.optional(z.string().check(z.maxLength(60))),
  ifsc: z.optional(z.nullable(z.string().check(z.maxLength(20)))),
  swift: z.optional(z.nullable(z.string().check(z.maxLength(20)))),
  bankName: z.string().check(z.trim(), z.minLength(1), z.maxLength(120)),
  branch: z.optional(z.nullable(z.string().check(z.maxLength(120)))),
  bankAddress: z.optional(z.nullable(z.string().check(z.maxLength(300)))),
  intermediary: z.optional(z.nullable(z.string().check(z.maxLength(300)))),
  /** M5.2 (LD30, OPEN (08-C RB-06): which RBI purpose code fits our exports? the bank confirms it): the RBI purpose code (P and four digits) of the USD account; null or empty clears it. */
  purposeCode: z.optional(z.nullable(z.string().check(z.maxLength(20)))),
  /** The `updatedAt` the form was loaded with (GET /settings/bank); null or missing for a first save. A different value is a 409. */
  expectedUpdatedAt: z.optional(z.nullable(z.int())),
});
const norm = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

async function saveBank(c: Ctx, kind: "INR" | "USD_SWIFT") {
  const parsed = bankBody.safeParse(await bodyOf(c));
  if (!parsed.success) return invalid(c, parsed.error.issues);
  const b = parsed.data;
  const bad: { path: string[]; message: string }[] = [];
  const typed = cleanAccountNo(norm(b.accountNo) ?? "") || null;
  const again = cleanAccountNo(norm(b.accountNoAgain) ?? "") || null;
  if (typed !== null && !ACCOUNT_NO.test(typed))
    bad.push({ path: ["accountNo"], message: "Use letters and digits only, 5 to 34 characters" });
  // 07-ZA item 7 (owner 2026-10-30), word for word, as the SPA's lines (`lib/bank-form.ts`): the line names its account (final sweep review 5)
  const which = kind === "INR" ? "INR" : "USD";
  if (typed !== null && again === null)
    bad.push({ path: ["accountNoAgain"], message: `Type the ${which} account number again.` });
  else if (typed !== null && typed !== again)
    bad.push({ path: ["accountNoAgain"], message: `The two ${which} account numbers don't match.` });
  const ifsc = norm(b.ifsc)?.toUpperCase() ?? null;
  const swift = norm(b.swift)?.toUpperCase() ?? null;
  if (kind === "INR" && (!ifsc || !IFSC.test(ifsc)))
    bad.push({ path: ["ifsc"], message: "An IFSC has 11 characters, like HDFC0001234" });
  if (kind === "USD_SWIFT") {
    if (!swift || !SWIFT.test(swift))
      bad.push({ path: ["swift"], message: "A SWIFT/BIC has 8 or 11 characters" });
    if (!norm(b.bankAddress)) bad.push({ path: ["bankAddress"], message: "Enter the bank's address" });
  }
  const purposeCode = norm(b.purposeCode)?.toUpperCase() ?? null;
  if (purposeCode !== null && kind !== "USD_SWIFT")
    bad.push({ path: ["purposeCode"], message: "A purpose code belongs to the USD account" });
  else if (purposeCode !== null && !PURPOSE_CODE.test(purposeCode))
    bad.push({ path: ["purposeCode"], message: "A purpose code is P and four digits, like P0802" });
  const db = c.env.DB;
  const existing = (await bankRows(db)).find((r) => r.kind === kind);
  if (!existing && typed === null) bad.push({ path: ["accountNo"], message: "Enter the account number" });
  if (existing && b.expectedUpdatedAt === undefined)
    bad.push({ path: ["expectedUpdatedAt"], message: "Reload the page and try again" });
  if (bad.length) return invalid(c, bad);
  // The stale check: the form must have been loaded from the row as it is now (a first save expects no row).
  if ((existing?.updated_at ?? null) !== (b.expectedUpdatedAt ?? null))
    return c.json({ error: STALE, request_id: c.var.rid }, 409);

  const after = {
    accountName: b.accountName,
    accountNo: typed ?? existing?.account_no ?? "",
    ifsc: kind === "INR" ? ifsc : null,
    swift: kind === "USD_SWIFT" ? swift : null,
    bankName: b.bankName,
    branch: norm(b.branch),
    bankAddress: norm(b.bankAddress),
    intermediary: norm(b.intermediary),
    purposeCode: kind === "USD_SWIFT" ? purposeCode : null,
  };
  const before = existing
    ? {
        accountName: existing.account_name,
        accountNo: existing.account_no,
        ifsc: existing.ifsc,
        swift: existing.swift,
        bankName: existing.bank_name,
        branch: existing.branch,
        bankAddress: existing.bank_address,
        intermediary: existing.intermediary,
        purposeCode: existing.purpose_code,
      }
    : null;
  // The account number is masked on both sides of the diff ("[masked]"): the log never holds it.
  const diff = auditSummary(before, after, ["accountNo"]);
  // `updatedAt` goes back so the screen sends it with its next save of this block (review re-check L-b).
  if (existing && !Object.keys(diff).length)
    return c.json({ ok: true, changed: false, updatedAt: existing.updated_at });
  const t = Date.now();
  const id = existing?.id ?? uuidv7();
  const main = existing
    ? db
        .prepare(
          "UPDATE bank_accounts SET account_name = ?1, account_no = ?2, ifsc = ?3, swift = ?4, bank_name = ?5, branch = ?6, bank_address = ?7, intermediary = ?8, purpose_code = ?9, updated_at = ?10 WHERE id = ?11 AND active = 1 AND updated_at = ?12",
        )
        .bind(
          after.accountName,
          after.accountNo,
          after.ifsc,
          after.swift,
          after.bankName,
          after.branch,
          after.bankAddress,
          after.intermediary,
          after.purposeCode,
          t,
          id,
          b.expectedUpdatedAt,
        )
    : db
        .prepare(
          "INSERT INTO bank_accounts (id, kind, account_name, account_no, ifsc, swift, bank_name, branch, bank_address, intermediary, purpose_code, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?12)",
        )
        .bind(
          id,
          kind,
          after.accountName,
          after.accountNo,
          after.ifsc,
          after.swift,
          after.bankName,
          after.branch,
          after.bankAddress,
          after.intermediary,
          after.purposeCode,
          t,
        );
  let done: boolean;
  try {
    done = await mutate(c, {
      main,
      action: "settings.bank.update",
      entityType: "bank_account",
      entityId: id,
      summary: { kind, ...diff },
    });
  } catch (e) {
    // Two first saves at once: the unique index (one active account per kind) lets one win and refuses the other.
    if (
      !existing &&
      /UNIQUE/.test(`${e instanceof Error ? e.message : ""} ${String((e as Error)?.cause ?? "")}`)
    )
      return c.json({ error: STALE, request_id: c.var.rid }, 409);
    throw e;
  }
  if (!done) return c.json({ error: STALE, request_id: c.var.rid }, 409);
  return c.json({ ok: true, changed: true, updatedAt: t });
}
