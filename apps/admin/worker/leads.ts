// Leads API (M3.2, ADM-LEAD-01..06). Every route is a row of ROUTES (guard.ts) with its matrix action and audit action; every
// mutation is ONE batch through `mutate` (the change, its audit row and access row together).
//
// This file holds the conversion (ADM-LEAD-04) first: lead -> client + primary contact + draft proposal shell, atomically.
// VERIFY WITH CA/LEGAL: the client's GST status and GSTIN are entered by the person converting and checked here only for
// shape and check character (core/gstin.ts); tax treatment is decided at proposal and invoice time (M4).
import { sValidator } from "@hono/standard-validator";
import { validateGstin } from "@techaust/core/gstin";
import { uuidv7 } from "@techaust/core/ids";
import { normaliseEmail } from "@techaust/core/lead-lifecycle";
import { decide } from "@techaust/core/permissions";
import { CATALOGUE } from "@techaust/db/catalogue";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import {
  type ApiError,
  type AppEnv,
  actor,
  BAD_REQUEST,
  type Ctx,
  err,
  FORBIDDEN,
  mutate,
  NOT_FOUND,
} from "./context.ts";

const ALREADY_CONVERTED: ApiError = { code: "already_converted", message: "That lead is already a client" };
const GSTIN_IN_USE: ApiError = { code: "gstin_in_use", message: "A client with that GSTIN already exists" };
const GSTIN_INVALID = (message: string): ApiError => ({ code: "gstin_invalid", message });

const idParam = z.object({ id: z.string().check(z.minLength(1), z.maxLength(64)) });
const param = <S extends Parameters<typeof sValidator>[1]>(schema: S) =>
  sValidator("param", schema, (r, c) => (r.success ? undefined : err(c as Ctx, NOT_FOUND, 404)));
const body = <S extends Parameters<typeof sValidator>[1]>(schema: S) =>
  sValidator("json", schema, (r, c) => (r.success ? undefined : err(c as Ctx, BAD_REQUEST, 400)));

const text = (max: number) => z.string().check(z.trim(), z.minLength(1), z.maxLength(max));

/** The client fields the lead does not carry (ADM-LEAD-04); the rest are pre-filled from the lead. */
export const convertRequest = z.object({
  type: z.enum(["business", "individual"]),
  country: z.string().check(z.regex(/^[A-Z]{2}$/)),
  gstStatus: z.enum(["registered", "unregistered", "overseas"]),
  gstin: z.optional(text(20)),
  currency: z.enum(["INR", "USD"]),
  legalName: z.optional(text(200)),
  displayName: z.optional(text(120)),
});

type LeadRow = {
  id: string;
  ref: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  contact_company: string | null;
  service_code: string | null;
  message: string | null;
  client_id: string | null;
  consent: string | null;
};

/** The service the lead asked for, as the words the person reads ("and", never "&"). */
function serviceTitle(code: string | null): string | null {
  if (!code) return null;
  if (code === "not-sure") return "Not sure yet";
  return (CATALOGUE.find((s) => s.code === code)?.name ?? code).replaceAll(" & ", " and ");
}

const isUnique = (e: unknown, column: string) =>
  new RegExp(`UNIQUE constraint failed: ${column}`).test(String(e) + String((e as Error)?.cause ?? ""));

export const leads = new Hono<AppEnv>().post(
  "/:id/convert",
  param(idParam),
  body(convertRequest),
  async (c) => {
    const u = actor(c);
    // The route's matrix action is clients.write; the draft proposal also needs proposals.draft (docs/04 §9).
    if (decide(u.role, "proposals.draft") === "deny") return err(c, FORBIDDEN, 403);
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;

    // GSTIN: present exactly when the client is registered (the table's CHECK says the same; answer 400 first).
    let gstin: string | null = null;
    let stateCode: string | null = null;
    if (f.gstStatus === "registered") {
      const g = validateGstin(f.gstin ?? "");
      if (!g.ok) return err(c, GSTIN_INVALID(g.error), 400);
      gstin = g.gstin;
      stateCode = g.stateCode;
    } else if (f.gstin !== undefined) {
      return err(c, BAD_REQUEST, 400);
    }

    const lead = await db
      .prepare(
        "SELECT id, ref, contact_name, contact_email, contact_phone, contact_company, service_code, message, client_id, consent FROM leads WHERE id = ?1",
      )
      .bind(id)
      .first<LeadRow>();
    if (!lead) return err(c, NOT_FOUND, 404);
    if (lead.client_id) return err(c, ALREADY_CONVERTED, 409);

    const t = Date.now();
    const clientId = uuidv7();
    const contactId = uuidv7();
    const proposalId = uuidv7();
    const legalName = f.legalName ?? lead.contact_company ?? lead.contact_name;
    const displayName = f.displayName ?? lead.contact_company ?? lead.contact_name;
    const consent = lead.consent ? (JSON.parse(lead.consent) as { marketing?: boolean; at?: number }) : null;
    const marketing = consent?.marketing
      ? JSON.stringify({ granted: true, at: consent.at ?? t, source: `lead:${lead.ref}` })
      : null;
    const title = serviceTitle(lead.service_code);
    const scopeBody = lead.message ? lead.message.slice(0, 2000) : null;
    const unconverted = "EXISTS (SELECT 1 FROM leads WHERE id = ?1 AND client_id IS NULL)";

    // One batch: the client (next free code), its primary contact, the draft proposal (no number: numbers come only at issue),
    // the service as a section of the draft, then the lead's own update LAST (the audit row follows only if that changed a row).
    // Every statement depends on the one before it, so a lead converted in the meantime changes nothing at all.
    const build = () => [
      db
        .prepare(
          `INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, gstin, state_code, currency)
         SELECT ?2, (SELECT printf('C%04d', coalesce(max(cast(substr(code, 2) AS integer)), 0) + 1) FROM clients WHERE code GLOB 'C[0-9][0-9][0-9][0-9]'),
           ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10 WHERE ${unconverted}`,
        )
        .bind(
          id,
          clientId,
          legalName,
          displayName,
          f.type,
          f.country,
          f.gstStatus,
          gstin,
          stateCode,
          f.currency,
        ),
      db
        .prepare(
          `INSERT INTO contacts (id, client_id, name, email, phone, is_primary, marketing_consent)
         SELECT ?1, ?2, ?3, ?4, ?5, 1, ?6 WHERE EXISTS (SELECT 1 FROM clients WHERE id = ?2)`,
        )
        .bind(
          contactId,
          clientId,
          lead.contact_name,
          normaliseEmail(lead.contact_email),
          lead.contact_phone,
          marketing,
        ),
      db
        .prepare(
          `INSERT INTO documents (id, type, status, client_id, currency, created_by)
         SELECT ?1, 'proposal', 'draft', ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM clients WHERE id = ?2)`,
        )
        .bind(proposalId, clientId, f.currency, u.id),
      db
        .prepare(
          `INSERT INTO document_sections (id, document_id, kind, position, title, body_md)
         SELECT ?1, ?2, 'scope', 1, ?3, ?4 WHERE EXISTS (SELECT 1 FROM documents WHERE id = ?2) AND (?3 IS NOT NULL OR ?4 IS NOT NULL)`,
        )
        .bind(uuidv7(), proposalId, title, scopeBody),
      db
        .prepare(
          `UPDATE leads SET client_id = ?2, proposal_id = ?3, last_activity_at = ?4, updated_at = ?4
         WHERE id = ?1 AND client_id IS NULL AND EXISTS (SELECT 1 FROM clients WHERE id = ?2) AND EXISTS (SELECT 1 FROM documents WHERE id = ?3)`,
        )
        .bind(id, clientId, proposalId, t),
    ];

    let done = false;
    for (let attempt = 0; ; attempt++) {
      try {
        done = await mutate(c, {
          main: build(),
          action: "lead.convert",
          entityType: "lead",
          entityId: id,
          // References only: no name, email or phone in the append-only log.
          summary: { ref: lead.ref, clientId, proposalId },
          status: 201,
          side: (g) => [
            db
              .prepare(
                `INSERT INTO lead_activities (id, lead_id, kind, body, actor_id, created_at)
               SELECT ?1, ?2, 'converted', 'Converted to client ' || code, ?3, ?4 FROM clients WHERE id = ?5 AND ${g.sql(6)}`,
              )
              .bind(uuidv7(), id, u.id, t, clientId, ...g.params),
          ],
        });
        break;
      } catch (e) {
        // Two conversions picked the same next code at once: the unique index refused the second; take the next one.
        if (isUnique(e, "clients.code") && attempt < 2) continue;
        if (isUnique(e, "clients.gstin")) return err(c, GSTIN_IN_USE, 409);
        throw e;
      }
    }
    if (!done) {
      const again = await db
        .prepare("SELECT client_id FROM leads WHERE id = ?1")
        .bind(id)
        .first<{ client_id: string | null }>();
      return again ? err(c, ALREADY_CONVERTED, 409) : err(c, NOT_FOUND, 404);
    }
    const made = await db
      .prepare("SELECT code FROM clients WHERE id = ?1")
      .bind(clientId)
      .first<{ code: string }>();
    return c.json({ clientId, clientCode: made?.code ?? "", contactId, proposalId }, 201);
  },
);
