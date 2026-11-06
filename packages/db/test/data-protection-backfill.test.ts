// M7.4 early check 1 H3, M4 [FRM-05, ADM-SET-09; run file docs/runs/m7.4-data-protection.md A.3, L41]: the consent back-fill of 0079 over rows with the
// consent JSON exactly as the code writes it (a website lead, `apps/jobs/src/leads.ts`; a contact's marketing consent, `apps/admin/worker/clients.ts` create,
// grant and withdraw), checked against core `receiptOf` / `withdrawalOf`; and the `consent.hash` page (`UNHASHED_RECEIPTS_SQL`) never reads an anonymised or
// erased lead. 0079 ran over empty tables here, so the test seeds the rows and runs the back-fill's receipt statements again (its own file: the statements
// read every lead and contact, so only this file's rows exist). Every name, address and id is invented test data.
import { uuidv7 } from "@techaust/core";
import { anonymisedEmail } from "@techaust/core/clients";
import { type ConsentSubject, receiptOf, withdrawalOf } from "@techaust/core/consent";
import { describe, expect, it } from "vitest";
import { UNHASHED_RECEIPTS_SQL } from "../src/consent.ts";
import { dataProtectionBackfill } from "../src/triggers-data-protection.ts";
import { mkClientRow, mkContact } from "./billing-helpers.ts";
import { all, run } from "./helpers.ts";

const T0 = Date.UTC(2026, 3, 2, 6, 15);
const T1 = T0 + 40 * 86_400_000;

/** A lead's consent as `apps/jobs/src/leads.ts` stores it. */
const leadConsent = (marketing: boolean, withdrawnAt: number | null = null) => ({
  noticeVersion: "1.2",
  purposes: ["respond_to_enquiry", ...(marketing ? ["marketing_updates"] : [])],
  at: T0,
  ipHash: "ip-hash-1",
  marketing,
  withdrawnAt,
});

async function lead(o: {
  consent: unknown;
  source?: "web" | "manual";
  email?: string;
  erased?: boolean;
}): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO leads (id, ref, source, contact_name, contact_email, consent) VALUES (?1, ?2, ?3, 'Pat', ?4, ?5)",
    id,
    `L-${id.slice(-8)}`,
    o.source ?? "web",
    o.email ?? `Pat.${id.slice(-6)}@Example.test`,
    o.consent === null ? null : JSON.stringify(o.consent),
  );
  if (o.erased) await run("UPDATE leads SET erased_hash = ?2 WHERE id = ?1", id, "e".repeat(64));
  return id;
}

async function contact(clientId: string, consent: unknown, anonymised = false): Promise<string> {
  const id = await mkContact(clientId);
  await run(
    "UPDATE contacts SET marketing_consent = ?2 WHERE id = ?1",
    id,
    consent === null ? null : JSON.stringify(consent),
  );
  if (anonymised) await run("UPDATE contacts SET anonymised_at = 9 WHERE id = ?1", id);
  return id;
}

type Row = {
  lead_id: string | null;
  contact_id: string | null;
  event: string;
  source: string;
  notice_version: string | null;
  purposes: string;
  marketing: number;
  ip_hash: string | null;
  at: number;
  subject_hash: string | null;
};
const receiptsOf = (col: "lead_id" | "contact_id", id: string) =>
  all<Row>(
    `SELECT lead_id, contact_id, event, source, notice_version, purposes, marketing, ip_hash, at, subject_hash FROM consent_receipts WHERE ${col} = ?1 ORDER BY at, event`,
    id,
  );
/** Core's row in the stored shape. */
const stored = (r: NonNullable<ReturnType<typeof receiptOf>>) => ({
  lead_id: r.leadId,
  contact_id: r.contactId,
  event: r.event,
  source: r.source,
  notice_version: r.noticeVersion,
  purposes: JSON.stringify(r.purposes),
  marketing: r.marketing ? 1 : 0,
  ip_hash: r.ipHash,
  at: r.at,
  subject_hash: null,
});

describe("the consent back-fill (H3, L41, M4)", () => {
  it("leads and contacts get core's grant and, when withdrawn, core's withdraw; anonymised, erased and never-granted rows get none", async () => {
    const client = await mkClientRow();
    const web = await lead({ consent: leadConsent(true) });
    const webNoMarketing = await lead({ consent: leadConsent(false) });
    const withdrawnLead = await lead({ consent: leadConsent(true, T1) });
    const manual = await lead({ consent: leadConsent(false), source: "manual" });
    const noConsent = await lead({ consent: null });
    const anonLead = await lead({
      consent: { ...leadConsent(true), ipHash: undefined },
      email: anonymisedEmail(uuidv7()),
    });
    const erasedLead = await lead({ consent: leadConsent(true), erased: true });

    const granted = await contact(client, { granted: true, at: T0, source: "admin" });
    const fromLead = await contact(client, { granted: true, at: T0, source: "lead:L-0001" });
    const withdrawn = await contact(client, { granted: false, at: T0, source: "admin", withdrawnAt: T1 });
    const never = await contact(client, null);
    const anonContact = await contact(client, { granted: true, at: T0, source: "admin" }, true);

    const statements = dataProtectionBackfill().filter((s) => s.startsWith("INSERT INTO consent_receipts"));
    expect(statements).toHaveLength(4);
    for (const s of statements) await run(s);

    // leads: core's receipt for each, and the withdrawal where `withdrawnAt` is set
    for (const [id, source] of [
      [web, "web"],
      [webNoMarketing, "web"],
      [manual, "manual"],
    ] as const) {
      const subject: ConsentSubject = {
        kind: "lead",
        id,
        source,
        consent: leadConsent(id === web),
      };
      const want = receiptOf(subject);
      if (!want) throw new Error("core gives no receipt");
      expect(await receiptsOf("lead_id", id), id).toEqual([stored(want)]);
    }
    const wSubject: ConsentSubject = {
      kind: "lead",
      id: withdrawnLead,
      source: "web",
      consent: leadConsent(true),
    };
    const wGrant = receiptOf(wSubject);
    const wOut = withdrawalOf(wSubject, T1, "staff");
    if (!wGrant || !wOut) throw new Error("core gives no receipt");
    expect(await receiptsOf("lead_id", withdrawnLead)).toEqual([stored(wGrant), stored(wOut.receipt)]);
    for (const id of [noConsent, anonLead, erasedLead])
      expect(await receiptsOf("lead_id", id), id).toEqual([]);

    // contacts (L41): core's staff receipt, no notice version
    for (const id of [granted, fromLead]) {
      const want = receiptOf({
        kind: "contact",
        id,
        noticeVersion: null,
        consent: { granted: true, at: T0, source: "admin" },
      });
      if (!want) throw new Error("core gives no receipt");
      expect(await receiptsOf("contact_id", id), id).toEqual([stored(want)]);
    }
    const cSubject: ConsentSubject = {
      kind: "contact",
      id: withdrawn,
      noticeVersion: null,
      consent: { granted: true, at: T0, source: "admin" },
    };
    const cGrant = receiptOf(cSubject);
    const cOut = withdrawalOf(cSubject, T1, "staff");
    if (!cGrant || !cOut) throw new Error("core gives no receipt");
    expect(await receiptsOf("contact_id", withdrawn)).toEqual([stored(cGrant), stored(cOut.receipt)]);
    for (const id of [never, anonContact]) expect(await receiptsOf("contact_id", id), id).toEqual([]);
  });

  it("M4: the consent.hash page reads a live lead or contact only, never an anonymised or erased one", async () => {
    const client = await mkClientRow();
    const live = await lead({ consent: null, email: "Live.Person@Example.test" });
    const anon = await lead({ consent: null, email: anonymisedEmail(uuidv7()) });
    // marked erased before its receipt is written, so the receipt has no hash (the erasure trigger stamps only the receipts it finds)
    const erased = await lead({ consent: null, erased: true });
    const liveContact = await mkContact(client, { email: "contact.live@example.test" });
    const goneContact = await mkContact(client);
    await run("UPDATE contacts SET anonymised_at = 9 WHERE id = ?1", goneContact);
    const ids: Record<string, string> = {};
    for (const [name, col, id] of [
      ["live", "lead_id", live],
      ["anon", "lead_id", anon],
      ["erased", "lead_id", erased],
      ["liveContact", "contact_id", liveContact],
      ["goneContact", "contact_id", goneContact],
    ] as const) {
      ids[name] = uuidv7();
      await run(
        `INSERT INTO consent_receipts (id, ${col}, event, source, purposes, at) VALUES (?1, ?2, 'grant', 'staff', '[]', ?3)`,
        ids[name],
        id,
        T0 - 86_400_000,
      );
    }
    const mine = new Set(Object.values(ids));
    const page = (await all<{ id: string; email: string }>(UNHASHED_RECEIPTS_SQL)).filter((r) =>
      mine.has(r.id),
    );
    expect(page.map((r) => [r.id, r.email]).sort()).toEqual(
      [
        [ids.live, "live.person@example.test"],
        [ids.liveContact, "contact.live@example.test"],
      ].sort(),
    );
  });
});
