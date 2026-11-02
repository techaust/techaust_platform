// Remittance advices (M6.4; ADM-INV-17, L12; run file C "New advice routes", "Lead triage of early check 1" L30), in the finance Worker under `/v1/payments`
// (mounted BEFORE the M6.1 `/:id` routes, and their ROUTES rows sit above `/payments/:id`, so `advices` and `without-advice` are never read as a payment id):
//   GET  /payments/advices                          the list, newest first (keyset, at most 50);                                    payments.read
//   POST /payments/advices                          a new advice, no file yet;                                                       payments.attachProof
//   GET  /payments/advices/:id                      one advice and its payments (keyset, at most 50);                                payments.read
//   PUT  /payments/advices/:id/file, GET            its file, write-once in DOCS (`advices/<id>/file-<sha256>`), PDF, JPEG or PNG; payments.attachProof / .read
//   POST /payments/advices/:id/payments             link 1 to 50 confirmed payments, all or none;                                    payments.attachProof
//   POST /payments/advices/:id/payments/:pid/remove the Owner takes one off, with a reason;                                          payments.adviceUnlink
//   GET  /payments/without-advice?provider=…        one gateway's confirmed payments on no advice (keyset), with the count;          payments.read
// Why (Settled by the lead on the safest reading, 2026-10-30 (08-C RB-05)): proof of realisation is the bank's advice or the e-FIRA, and for a PA-CB the settlement
// report mapped to the invoice; PayPal India's FIRA covers a week and PayPal keeps it 12 months only, so one advice proves many payments and each is kept here. A
// bank advice proves a bank transfer from abroad only (L30: a FIRC or BRC proves export realisation, never a domestic receipt). Every rule is in the statements'
// WHERE and again in the 0068 triggers; a refusal is explained from a read after the batch. The advice's file may name the remitter: it is a FEMA record kept
// when a client is erased (08-C RB-40 note); no file name or bytes are ever logged.
import { uuidv7 } from "@techaust/core/ids";
import {
  ADVICE_LINK_MAX,
  ADVICE_PAGE_SIZE,
  ADVICE_PAYMENTS_SQL,
  ADVICE_READ_SQL,
  ADVICES_SQL,
  adviceCreateStatement,
  adviceFileStatement,
  adviceLinkStatement,
  adviceUnlinkStatement,
  PAYMENTS_WITHOUT_ADVICE_COUNT_SQL,
  PAYMENTS_WITHOUT_ADVICE_SQL,
} from "@techaust/db/advices";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, actor, BAD_REQUEST, err, mutate, NOT_FOUND } from "./context.ts";
import { docDownload, dropDoc, extOfMime, streamToDocs, uploadHead } from "./docs-upload.ts";
import {
  ADVICE_ALREADY_LINKED,
  ADVICE_CLIENT_ANONYMISED,
  ADVICE_FILE_ALREADY_SET,
  ADVICE_LINK_NOT_ON,
  ADVICE_PAYMENT_NOT_CONFIRMED,
  ADVICE_REF_EXISTS,
  ADVICE_WRONG_PROVIDER,
} from "./gateway/messages.ts";
import { body, idParam, isoDate, param, STALE_VERSION } from "./http.ts";

/** The lists of 0067/0068 (the db schema's `ADVICE_PROVIDERS`, `ADVICE_KINDS`; a test holds them equal, the schema module is not bundled here). */
export const ADVICE_PROVIDERS = ["paypal", "stripe", "bank"] as const;
export const ADVICE_KINDS = ["efira", "fira", "firc", "brc", "settlement_report", "other"] as const;
/** The lists the "Without advice" view takes: a gateway, or `manual` for the bank's (bank transfers from abroad). */
const WITHOUT_PROVIDERS = ["paypal", "stripe", "manual"] as const;

export const adviceBody = z
  .strictObject({
    provider: z.enum(ADVICE_PROVIDERS),
    kind: z.enum(ADVICE_KINDS),
    adviceRef: z.string().check(z.trim(), z.minLength(1), z.maxLength(64)),
    issuedOn: isoDate,
    periodFrom: z.optional(z.nullable(isoDate)),
    periodTo: z.optional(z.nullable(isoDate)),
    inrTotalMinor: z.optional(z.nullable(z.int().check(z.gte(1), z.lte(1_000_000_000_000)))),
    note: z.optional(z.nullable(z.string().check(z.trim(), z.maxLength(500)))),
  })
  // Review part 1, finding 5: a period that ends before it starts is a 400 here (the 0067 CHECK `realisation_advices_period` would make it a 500).
  .check(
    z.refine((b) => !b.periodFrom || !b.periodTo || b.periodFrom <= b.periodTo, {
      error: "The period must end on or after its first day",
      path: ["periodTo"],
    }),
  );
export const adviceLinkBody = z.strictObject({
  paymentIds: z
    .array(z.string().check(z.minLength(1), z.maxLength(64)))
    .check(z.minLength(1), z.maxLength(ADVICE_LINK_MAX)),
});
export const adviceUnlinkBody = z.strictObject({
  reason: z.string().check(z.trim(), z.minLength(1), z.maxLength(200)),
});
const unlinkParam = z.object({
  id: z.string().check(z.minLength(1), z.maxLength(64)),
  pid: z.string().check(z.minLength(1), z.maxLength(64)),
});

/** A keyset cursor `<day>|<id>` (the lists' own sort), or null when absent; undefined when malformed (400). */
function cursorOf(v: string | undefined): [string, string] | null | undefined {
  if (v === undefined || v === "") return null;
  const m = /^(\d{4}-\d{2}-\d{2})\|([A-Za-z0-9_-]{1,64})$/.exec(v);
  return m ? [m[1] as string, m[2] as string] : undefined;
}
const nextOf = <T extends Record<string, unknown>>(rows: T[], day: keyof T, id: keyof T): string | null => {
  if (rows.length <= ADVICE_PAGE_SIZE) return null;
  const last = rows[ADVICE_PAGE_SIZE - 1] as T;
  return `${String(last[day])}|${String(last[id])}`;
};

/** Why a link of these payments to this advice was refused, read after the batch (the first reason any payment has). */
const LINK_WHY_SQL = `SELECT p.id, p.status, p.kind, p.provider, p.currency, k.anonymised_at IS NOT NULL AS gone,
     (k.country <> 'IN' OR k.gst_status = 'overseas') AS overseas,
     EXISTS (SELECT 1 FROM realisation_advice_payments l INDEXED BY realisation_advice_payments_active WHERE l.payment_id = p.id AND l.removed_at IS NULL) AS linked
   FROM json_each(?1) j JOIN payments p ON p.id = j.value JOIN clients k ON k.id = p.client_id`;
type Why = {
  id: string;
  status: string;
  kind: string;
  provider: string;
  currency: string;
  gone: number;
  overseas: number;
  linked: number;
};

export const advices = new Hono<AppEnv>()
  .get("/advices", async (c) => {
    const at = cursorOf(c.req.query("after"));
    if (at === undefined) return err(c, BAD_REQUEST, 400);
    const rows = (
      await c.env.DB.prepare(ADVICES_SQL)
        .bind(at?.[0] ?? null, at?.[1] ?? null)
        .all<Record<string, unknown>>()
    ).results;
    return c.json({ items: rows.slice(0, ADVICE_PAGE_SIZE), next: nextOf(rows, "issued_on", "id") });
  })
  .post("/advices", body(adviceBody), async (c) => {
    const f = c.req.valid("json");
    const u = actor(c);
    const id = uuidv7();
    const done = await mutate(c, {
      main: adviceCreateStatement(c.env.DB, {
        id,
        provider: f.provider,
        kind: f.kind,
        adviceRef: f.adviceRef,
        issuedOn: f.issuedOn,
        periodFrom: f.periodFrom ?? null,
        periodTo: f.periodTo ?? null,
        inrTotalMinor: f.inrTotalMinor ?? null,
        note: f.note || null,
        recordedBy: u.id,
        now: Date.now(),
      }),
      action: "payment.advice_create",
      entityType: "realisation_advice",
      entityId: id,
      // The reference and the note are never in the audit log (a reference may name a remitter): the kind and the provider only.
      summary: { adviceId: id, provider: f.provider, kind: f.kind },
    });
    if (!done) return err(c, ADVICE_REF_EXISTS, 409);
    return c.json({ ok: true, id }, 201);
  })
  .get("/advices/:id", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const at = cursorOf(c.req.query("after"));
    if (at === undefined) return err(c, BAD_REQUEST, 400);
    const db = c.env.DB;
    const [adv, pays] = await db.batch([
      db.prepare(ADVICE_READ_SQL).bind(id),
      db.prepare(ADVICE_PAYMENTS_SQL).bind(id, at?.[0] ?? "", at?.[1] ?? ""),
    ]);
    const a = adv?.results[0];
    if (!a) return err(c, NOT_FOUND, 404);
    const rows = (pays?.results ?? []) as Record<string, unknown>[];
    return c.json({
      advice: a,
      payments: rows.slice(0, ADVICE_PAGE_SIZE),
      // Review part 1, finding 7: keyed on the link row (a payment taken off and linked again has two rows).
      next: nextOf(rows, "received_on", "link_id"),
    });
  })
  .put("/advices/:id/file", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const head = uploadHead(c);
    if (head instanceof Response) return head;
    const row = await c.env.DB.prepare(ADVICE_READ_SQL).bind(id).first<{ file_r2_key: string | null }>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.file_r2_key !== null) return err(c, ADVICE_FILE_ALREADY_SET, 409);
    const stored = await streamToDocs(c, head, `advices/${id}/file`);
    if (stored instanceof Response) return stored;
    let done = false;
    try {
      done = await mutate(c, {
        main: adviceFileStatement(c.env.DB, { id, r2Key: stored.key, sha256: head.sha, mime: stored.mime }),
        action: "payment.advice_file",
        entityType: "realisation_advice",
        entityId: id,
        summary: { adviceId: id, size: head.len, mime: stored.mime },
      });
    } catch (e) {
      if (stored.created) await dropDoc(c.env, stored.key, "row not written");
      throw e;
    }
    if (!done) {
      const again = await c.env.DB.prepare(ADVICE_READ_SQL).bind(id).first<{ file_r2_key: string | null }>();
      // Never remove the object a row points at (the same bytes land on the same key).
      if (stored.created && again?.file_r2_key !== stored.key)
        await dropDoc(c.env, stored.key, "row not written");
      if (!again) return err(c, NOT_FOUND, 404);
      return again.file_r2_key !== null ? err(c, ADVICE_FILE_ALREADY_SET, 409) : err(c, STALE_VERSION, 409);
    }
    return c.json({ ok: true });
  })
  .get("/advices/:id/file", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const row = await c.env.DB.prepare(ADVICE_READ_SQL)
      .bind(id)
      .first<{ file_r2_key: string | null; file_mime: string | null }>();
    if (!row?.file_r2_key || !row.file_mime) return err(c, NOT_FOUND, 404);
    const res = await docDownload(
      c,
      row.file_r2_key,
      row.file_mime,
      `advice-${id}.${extOfMime(row.file_mime)}`,
    );
    return res ?? err(c, NOT_FOUND, 404);
  })
  .post("/advices/:id/payments", param(idParam), body(adviceLinkBody), async (c) => {
    const { id } = c.req.valid("param");
    const { paymentIds } = c.req.valid("json");
    const u = actor(c);
    if (new Set(paymentIds).size !== paymentIds.length) return err(c, BAD_REQUEST, 400);
    const db = c.env.DB;
    const adv = await db.prepare(ADVICE_READ_SQL).bind(id).first<{ provider: string }>();
    if (!adv) return err(c, NOT_FOUND, 404);
    const done = await mutate(c, {
      main: adviceLinkStatement(db, { adviceId: id, paymentIds, by: u.id, now: Date.now() }),
      action: "payment.advice_link",
      entityType: "realisation_advice",
      entityId: id,
      summary: { adviceId: id, paymentIds },
    });
    if (done) return c.json({ ok: true, linked: paymentIds.length });
    // Why, in the order a person fixes them: a payment that isn't there, not confirmed money received, of another gateway (or a domestic bank transfer), of an
    // erased client, already on an advice.
    const why = ((await db.prepare(LINK_WHY_SQL).bind(JSON.stringify(paymentIds)).all<Why>()).results ??
      []) as Why[];
    if (why.length !== paymentIds.length) return err(c, NOT_FOUND, 404);
    const wrongProvider = (w: Why) =>
      adv.provider === "bank"
        ? w.provider !== "manual" || (w.currency !== "USD" && w.currency !== "INR") || w.overseas !== 1
        : w.provider !== adv.provider || w.currency !== "USD";
    if (why.some((w) => w.status !== "confirmed" || w.kind !== "payment"))
      return err(c, ADVICE_PAYMENT_NOT_CONFIRMED, 409);
    if (why.some(wrongProvider)) return err(c, ADVICE_WRONG_PROVIDER, 409);
    if (why.some((w) => w.gone === 1)) return err(c, ADVICE_CLIENT_ANONYMISED, 409);
    if (why.some((w) => w.linked === 1)) return err(c, ADVICE_ALREADY_LINKED, 409);
    return err(c, STALE_VERSION, 409);
  })
  .post("/advices/:id/payments/:pid/remove", param(unlinkParam), body(adviceUnlinkBody), async (c) => {
    const { id, pid } = c.req.valid("param");
    const { reason } = c.req.valid("json");
    const u = actor(c);
    const done = await mutate(c, {
      main: adviceUnlinkStatement(c.env.DB, {
        adviceId: id,
        paymentId: pid,
        by: u.id,
        now: Date.now(),
        reason,
      }),
      action: "payment.advice_unlink",
      entityType: "realisation_advice",
      entityId: id,
      // The reason's text is never in the audit log (it may name a person).
      summary: { adviceId: id, paymentId: pid },
    });
    if (!done) return err(c, ADVICE_LINK_NOT_ON, 409);
    return c.json({ ok: true });
  })
  .get("/without-advice", async (c) => {
    const provider = c.req.query("provider") ?? "paypal";
    const currency = c.req.query("currency") ?? null;
    const at = cursorOf(c.req.query("after"));
    if (
      !(WITHOUT_PROVIDERS as readonly string[]).includes(provider) ||
      (currency !== null && currency !== "USD" && currency !== "INR") ||
      at === undefined
    )
      return err(c, BAD_REQUEST, 400);
    const db = c.env.DB;
    const [list, count] = await db.batch([
      db.prepare(PAYMENTS_WITHOUT_ADVICE_SQL).bind(provider, at?.[0] ?? "", at?.[1] ?? "", currency),
      // The count of the same list (review part 1, finding 6: the same currency): every one, whatever its day (`received_on` within all of time).
      db.prepare(PAYMENTS_WITHOUT_ADVICE_COUNT_SQL).bind(provider, "0000-01-01", "9999-12-31", currency),
    ]);
    const rows = (list?.results ?? []) as Record<string, unknown>[];
    return c.json({
      items: rows.slice(0, ADVICE_PAGE_SIZE),
      next: nextOf(rows, "received_on", "id"),
      count: (count?.results[0] as { n: number } | undefined)?.n ?? 0,
    });
  });
