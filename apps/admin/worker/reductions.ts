// FEMA reductions of an export invoice (M6.5; ADM-INV-17; run file "08-C n1–n5" n5 → RB-43), in the finance Worker beside the FEMA extensions:
//   GET  /invoices/:id/realisation-reductions                    the invoice's reductions (`payments.read`);
//   POST /invoices/:id/realisation-reductions                    the Owner (step-up, `realisation.reduce`) records the AD bank's Reg. 6 reduction;
//   PUT  /invoices/:id/realisation-reductions/:rid/letter        the bank's letter, write-once in DOCS.
// Settled by the lead on the safest reading, 2026-11-03 (08-C RB-43): before any export refund a reduction is asked from the AD bank under FEMA 23(R)/2026-RB Reg. 6;
// the EDF keeps the full value; FEMA is not realised until the reduction is recorded. A reduction "on our own declaration" (`declaration: true`) is refused above
// ₹10 lakh or its equivalent (early check 1, part 2 item 5; for a USD invoice at its own Owner-typed rate, and refused when no rate is known: the safe side).
import { istDate, toIsoDate } from "@techaust/core/dates";
import { realisationReductionBody } from "@techaust/core/payment-schemas";
import {
  REDUCTION_BY_ID_SQL,
  REDUCTIONS_OF_DOCUMENT_SQL,
  realisationReductionStatement,
  reductionLetterStatement,
} from "@techaust/db/refunds";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { CLIENT_GONE, clientGoneSql } from "./anonymised.ts";
import { type AppEnv, actor, err, mutate, NOT_FOUND } from "./context.ts";
import { dropDoc, streamToDocs, uploadHead } from "./docs-upload.ts";
import { body, idParam, param } from "./http.ts";
import { LETTER_ALREADY_SET } from "./payment-messages.ts";

/** Settled by the lead on the safest reading, 2026-11-03 (08-C RB-43): the most a reduction on our own declaration may be, ₹10,00,000.00 in paise. */
export const DECLARATION_MAX_INR_MINOR = 100_000_000;

const E = (code: string, message: string) => ({ code, message });
const REDUCTION_REFUSED = E("reduction_refused", "This reduction can't be recorded on this invoice");
const DECLARATION_TOO_LARGE = E(
  "declaration_too_large",
  "Above ₹10 lakh, the bank's own approval is needed, not a declaration",
);
const DAY_INVALID = E("day_invalid", "Pick a day that isn't in the future");
// M6–M7 audit AU3 (B0 6; staff line, the builder's draft for the lead, 07-ZT line 6): the id of a reduction already recorded with other details.
const REDUCTION_EXISTS = E("reduction_exists", "This reduction was already recorded with other details");

const DOC_SQL = `SELECT d.id, d.type, d.currency, d.total_minor, d.fx_rate_micros, d.frozen_at, d.status, ${clientGoneSql("d.client_id")} AS gone,
     (SELECT coalesce(sum(r.amount_minor), 0) FROM realisation_reductions r WHERE r.document_id = d.id) AS reduced,
     (SELECT coalesce(sum(r.amount_minor), 0) FROM realisation_reductions r WHERE r.document_id = d.id AND r.declaration = 1) AS declared
   FROM documents d WHERE d.id = ?1`;

/** Does the reduction's row name this DOCS key already (a twin request's letter)? */
const pointsAt = async (db: D1Database, rid: string, key: string): Promise<boolean> =>
  (await db
    .prepare("SELECT 1 AS ok FROM realisation_reductions WHERE id = ?1 AND letter_r2_key = ?2")
    .bind(rid, key)
    .first()) !== null;

/** The INR value of `amountMinor` at `rateMicros` (bigint, rounded up: the safe side), or null without a rate. */
const inrOf = (amountMinor: number, currency: string, rateMicros: number | null): bigint | null =>
  currency === "INR"
    ? BigInt(amountMinor)
    : rateMicros && rateMicros > 0
      ? (BigInt(amountMinor) * BigInt(rateMicros) + 999_999n) / 1_000_000n
      : null;

export const reductions = new Hono<AppEnv>()
  .get("/:id/realisation-reductions", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const rows = (await c.env.DB.prepare(REDUCTIONS_OF_DOCUMENT_SQL).bind(id).all()).results;
    return c.json({ items: rows });
  })
  .post("/:id/realisation-reductions", param(idParam), body(realisationReductionBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const d = await db.prepare(DOC_SQL).bind(id).first<{
      type: string;
      currency: string;
      total_minor: number;
      fx_rate_micros: number | null;
      frozen_at: number | null;
      status: string;
      gone: number;
      reduced: number;
      declared: number;
    }>();
    if (d?.type !== "export_invoice" || d.frozen_at === null) return err(c, NOT_FOUND, 404);
    if (d.gone === 1) return err(c, CLIENT_GONE, 409);
    const now = Date.now();
    if (f.approvedOn > toIsoDate(istDate(now))) return err(c, DAY_INVALID, 400);
    if (f.declaration) {
      // Review part 1, finding 2: the cap is per invoice: this declaration together with every earlier one on it (held again in the INSERT's WHERE).
      const inr = inrOf(f.amountMinor + d.declared, d.currency, d.fx_rate_micros);
      if (inr === null || inr > BigInt(DECLARATION_MAX_INR_MINOR))
        return err(c, DECLARATION_TOO_LARGE, 409, { declaredMinor: d.declared });
    }
    const done = await mutate(c, {
      main: realisationReductionStatement(db, {
        id: f.id,
        documentId: id,
        amountMinor: f.amountMinor,
        approvedOn: f.approvedOn,
        bankRef: f.bankRef,
        declaration: f.declaration,
        note: f.note ?? null,
        sessionId: u.sessionId,
        now,
        declarationMaxInrMinor: DECLARATION_MAX_INR_MINOR,
      }),
      action: "realisation.reduce",
      entityType: "document",
      entityId: id,
      summary: {
        documentId: id,
        reductionId: f.id,
        amountMinor: f.amountMinor,
        currency: d.currency,
        declaration: f.declaration,
      },
    });
    if (!done) {
      // M6–M7 audit AU3 (B0 6): a repeat of the same request (a double submit, a retry after a lost answer) finds its own row: 200 as the first time; the same
      // id with anything else is 409.
      const same = await db.prepare(REDUCTION_BY_ID_SQL).bind(f.id).first<{
        document_id: string;
        amount_minor: number;
        approved_on: string;
        bank_ref: string;
        declaration: number;
      }>();
      if (same)
        return same.document_id === id &&
          same.amount_minor === f.amountMinor &&
          same.approved_on === f.approvedOn &&
          same.bank_ref === f.bankRef &&
          same.declaration === (f.declaration ? 1 : 0)
          ? c.json({ ok: true, id: f.id })
          : err(c, REDUCTION_EXISTS, 409);
      return err(c, REDUCTION_REFUSED, 409, { reducedMinor: d.reduced, totalMinor: d.total_minor });
    }
    return c.json({ ok: true, id: f.id });
  })
  .put(
    "/:id/realisation-reductions/:rid/letter",
    param(
      z.object({
        id: z.string().check(z.minLength(1), z.maxLength(64)),
        rid: z.string().check(z.minLength(1), z.maxLength(64)),
      }),
    ),
    async (c) => {
      const { id, rid } = c.req.valid("param");
      const u = actor(c);
      const head = uploadHead(c);
      if (head instanceof Response) return head;
      const db = c.env.DB;
      const x = await db
        .prepare(
          `SELECT r.id, r.letter_r2_key, ${clientGoneSql("d.client_id")} AS gone FROM realisation_reductions r JOIN documents d ON d.id = r.document_id
           WHERE r.id = ?1 AND r.document_id = ?2`,
        )
        .bind(rid, id)
        .first<{ id: string; letter_r2_key: string | null; gone: number }>();
      if (!x) return err(c, NOT_FOUND, 404);
      // M6–M7 audit AU3 (B0 5): no letter is stored for an anonymised client's invoice (the UPDATE's WHERE holds it again).
      if (x.gone === 1) return err(c, CLIENT_GONE, 409);
      if (x.letter_r2_key !== null) return err(c, LETTER_ALREADY_SET, 409);
      const stored = await streamToDocs(c, head, `reductions/${rid}/letter`);
      if (stored instanceof Response) return stored;
      let done = false;
      try {
        done = await mutate(c, {
          main: reductionLetterStatement(db, {
            id: rid,
            r2Key: stored.key,
            sha256: head.sha,
            mime: stored.mime,
            sessionId: u.sessionId,
            now: Date.now(),
          }),
          action: "realisation.reduce",
          entityType: "document",
          entityId: id,
          summary: { documentId: id, reductionId: rid, letter: true, size: head.len, mime: stored.mime },
        });
      } catch (e) {
        if (stored.created && !(await pointsAt(db, rid, stored.key)))
          await dropDoc(c.env, stored.key, "row not written");
        throw e;
      }
      if (!done) {
        // M6–M7 audit AU3 (B0 5): the object is dropped only when the row does not name this very key (a twin request that won with the same letter bytes
        // wrote the same key: dropping it would leave the row pointing at nothing).
        const winner = await db
          .prepare(
            `SELECT r.letter_r2_key, ${clientGoneSql("d.client_id")} AS gone FROM realisation_reductions r JOIN documents d ON d.id = r.document_id WHERE r.id = ?1`,
          )
          .bind(rid)
          .first<{ letter_r2_key: string | null; gone: number }>();
        if (stored.created && winner?.letter_r2_key !== stored.key)
          await dropDoc(c.env, stored.key, "row not written");
        if (winner?.gone === 1) return err(c, CLIENT_GONE, 409);
        return err(c, LETTER_ALREADY_SET, 409);
      }
      return c.json({ ok: true });
    },
  );
