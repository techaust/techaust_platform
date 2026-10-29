// Leads API [ADM-LEAD-01..06]. Conversion first (M3.2 Stop 1): lead -> client + primary contact + draft proposal shell in ONE batch.
import { env } from "cloudflare:workers";
import { gstinCheckChar } from "@techaust/core/gstin";
import { uuidv7 } from "@techaust/core/ids";
import { clientCode } from "@techaust/core/lead-lifecycle";
import { beforeAll, describe, expect, it } from "vitest";
import { mkItem } from "./test-catalogue.ts";
import { bodyOf, call, countOf, one, rows, sessionFor } from "./test-helpers.ts";

// M4.1: a lead's service name is read from catalogue_items (no seed import), so the item the leads point at exists here.
beforeAll(async () => {
  await mkItem({ code: "S5", name: "Custom Web Apps & Business Portals" });
});

type Body = Record<string, unknown>;
const GOOD: Body = {
  type: "business",
  country: "IN",
  gstStatus: "unregistered",
  stateCode: "19",
  currency: "INR",
};
const GSTIN14 = "19AAACT2727Q1Z";
const VALID_GSTIN = GSTIN14 + gstinCheckChar(GSTIN14);
const WRONG_GSTIN = GSTIN14 + (gstinCheckChar(GSTIN14) === "0" ? "1" : "0");

let seq = 0;
async function addLead(over: Partial<Record<string, unknown>> = {}) {
  const id = uuidv7();
  const n = ++seq;
  const v = {
    ref: `L-C${String(n).padStart(4, "0")}`,
    contact_name: "Asha Rao",
    contact_email: `Asha${n}@Example.com`,
    contact_phone: "+91 90000 00000",
    contact_company: "Rao Traders",
    service_code: "S5",
    message: "We need our invoices to flow into Tally.",
    consent: JSON.stringify({ marketing: true, at: 1_700_000_000_000 }),
    ...over,
  };
  await env.DB.prepare(
    "INSERT INTO leads (id, ref, source, contact_name, contact_email, contact_phone, contact_company, service_code, message, consent) VALUES (?1, ?2, 'manual', ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
  )
    .bind(
      id,
      v.ref,
      v.contact_name,
      v.contact_email,
      v.contact_phone,
      v.contact_company,
      v.service_code,
      v.message,
      v.consent,
    )
    .run();
  return { id, ref: v.ref as string, email: v.contact_email as string };
}

const convert = async (id: string, body: Body, cookie: string, rid = `ray-${crypto.randomUUID()}`) => ({
  res: await call(`/leads/${id}/convert`, { body, cookie, headers: { "cf-ray": rid } }),
  rid,
});

describe("POST /leads/:id/convert [ADM-LEAD-04]", () => {
  it("makes the client, the primary contact and the draft proposal shell, and links them to the lead", async () => {
    const s = await sessionFor("sales");
    const lead = await addLead();
    const { res, rid } = await convert(lead.id, GOOD, s.cookie);
    expect(res.status).toBe(201);
    const out = (await res.json()) as {
      clientId: string;
      clientCode: string;
      contactId: string;
      proposalId: string;
    };
    expect(out.clientCode).toMatch(/^C\d{4}$/);

    expect(
      await one(
        "SELECT code, legal_name, display_name, type, country, gst_status, gstin, currency FROM clients WHERE id = ?",
        out.clientId,
      ),
    ).toEqual({
      code: out.clientCode,
      legal_name: "Rao Traders",
      display_name: "Rao Traders",
      type: "business",
      country: "IN",
      gst_status: "unregistered",
      gstin: null,
      currency: "INR",
    });
    expect(
      await one(
        "SELECT client_id, name, email, phone, is_primary, portal_access, marketing_consent FROM contacts WHERE id = ?",
        out.contactId,
      ),
    ).toMatchObject({
      client_id: out.clientId,
      name: "Asha Rao",
      email: expect.stringMatching(/^asha\d+@example\.com$/),
      phone: "+91 90000 00000",
      is_primary: 1,
      portal_access: 0,
    });
    expect(
      JSON.parse(
        (
          (await one<{ marketing_consent: string }>(
            "SELECT marketing_consent FROM contacts WHERE id = ?",
            out.contactId,
          )) as { marketing_consent: string }
        ).marketing_consent,
      ),
    ).toMatchObject({ granted: true, source: `lead:${lead.ref}` });

    // The draft: a proposal, no number (numbers come only at issue), for that client and currency.
    expect(
      await one(
        "SELECT type, status, client_id, currency, number, number_display, series, frozen_at, created_by FROM documents WHERE id = ?",
        out.proposalId,
      ),
    ).toEqual({
      type: "proposal",
      status: "draft",
      client_id: out.clientId,
      currency: "INR",
      number: null,
      number_display: null,
      series: null,
      frozen_at: null,
      created_by: s.id,
    });
    // The service the lead asked for travels as a section of the draft, in the words a person reads.
    expect(
      await one("SELECT kind, title, body_md FROM document_sections WHERE document_id = ?", out.proposalId),
    ).toMatchObject({
      kind: "scope",
      body_md: "We need our invoices to flow into Tally.",
    });
    expect(
      (
        (await one<{ title: string }>(
          "SELECT title FROM document_sections WHERE document_id = ?",
          out.proposalId,
        )) as { title: string }
      ).title,
    ).toBe("Custom Web Apps and Business Portals"); // the name from catalogue_items, "&" worded as "and"

    // The lead: linked, stage unchanged; one timeline row; one audit row with references only.
    expect(await one("SELECT stage, client_id, proposal_id FROM leads WHERE id = ?", lead.id)).toEqual({
      stage: "new",
      client_id: out.clientId,
      proposal_id: out.proposalId,
    });
    expect(await rows("SELECT kind, body, actor_id FROM lead_activities WHERE lead_id = ?", lead.id)).toEqual(
      [{ kind: "converted", body: `Converted to client ${out.clientCode}`, actor_id: s.id }],
    );
    const audit = await rows<{ action: string; summary: string; entity_id: string }>(
      "SELECT action, summary, entity_id FROM audit_log WHERE request_id = ?",
      rid,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "lead.convert", entity_id: lead.id });
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({
      ref: lead.ref,
      clientId: out.clientId,
      proposalId: out.proposalId,
    });
    expect(audit[0]?.summary).not.toMatch(/Asha|example\.com|Rao|\+91/);
  });

  it("takes the next free client code and ignores the sample clients' codes; the SQL format equals clientCode()", async () => {
    await env.DB.prepare(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES ('sample-a', 'SAMPLE-A', 'A', 'A', 'business', 'IN', 'unregistered', '19', 'INR')",
    ).run();
    const s = await sessionFor("owner");
    const before = (await one<{ n: number }>(
      "SELECT coalesce(max(cast(substr(code, 2) AS integer)), 0) AS n FROM clients WHERE code GLOB 'C[0-9][0-9][0-9][0-9]'",
    )) as { n: number };
    const a = await convert((await addLead()).id, GOOD, s.cookie);
    const b = await convert((await addLead()).id, GOOD, s.cookie);
    expect(((await a.res.json()) as { clientCode: string }).clientCode).toBe(clientCode(before.n + 1));
    expect(((await b.res.json()) as { clientCode: string }).clientCode).toBe(clientCode(before.n + 2));
  });

  it("two leads converted at the same moment get different codes", async () => {
    const s = await sessionFor("staff");
    const [x, y] = await Promise.all([addLead(), addLead()]);
    const [a, b] = await Promise.all([convert(x.id, GOOD, s.cookie), convert(y.id, GOOD, s.cookie)]);
    expect([a.res.status, b.res.status]).toEqual([201, 201]);
    const codes = [((await a.res.json()) as Body).clientCode, ((await b.res.json()) as Body).clientCode];
    expect(new Set(codes).size).toBe(2);
  });

  it("a converted lead can't be converted again (409) and nothing more is written", async () => {
    const s = await sessionFor("sales");
    const lead = await addLead();
    expect((await convert(lead.id, GOOD, s.cookie)).res.status).toBe(201);
    const clients = await countOf("clients");
    const docs = await countOf("documents");
    const { res, rid } = await convert(lead.id, GOOD, s.cookie);
    expect(res.status).toBe(409);
    expect(((await bodyOf(res)) as { error: { code: string } }).error.code).toBe("already_converted");
    expect(await countOf("clients")).toBe(clients);
    expect(await countOf("documents")).toBe(docs);
    expect(await countOf("audit_log", "request_id = ?", rid)).toBe(0);
  });

  it("converting the same lead twice at once makes exactly one client", async () => {
    const s = await sessionFor("sales");
    const lead = await addLead();
    const [a, b] = await Promise.all([convert(lead.id, GOOD, s.cookie), convert(lead.id, GOOD, s.cookie)]);
    expect([a.res.status, b.res.status].sort()).toEqual([201, 409]);
    expect(await countOf("contacts", "email = ?", lead.email.toLowerCase())).toBe(1);
    expect(await countOf("audit_log", "entity_id = ? AND action = 'lead.convert'", lead.id)).toBe(1);
  });

  it("is atomic: one failing statement leaves nothing written", async () => {
    const s = await sessionFor("sales");
    const lead = await addLead();
    await env.DB.exec(
      "CREATE TRIGGER t_fail_doc BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT, 'forced failure'); END",
    );
    const clients = await countOf("clients");
    const contacts = await countOf("contacts");
    const { res, rid } = await convert(lead.id, GOOD, s.cookie);
    expect(res.status).toBe(500);
    expect(await countOf("clients")).toBe(clients);
    expect(await countOf("contacts")).toBe(contacts);
    expect(await one("SELECT client_id, proposal_id FROM leads WHERE id = ?", lead.id)).toEqual({
      client_id: null,
      proposal_id: null,
    });
    expect(await countOf("lead_activities", "lead_id = ?", lead.id)).toBe(0);
    expect(await countOf("audit_log", "request_id = ?", rid)).toBe(0);
    await env.DB.exec("DROP TRIGGER t_fail_doc");
    expect((await convert(lead.id, GOOD, s.cookie)).res.status).toBe(201); // and the lead can still be converted
  });

  it("registered clients need a valid GSTIN; the state code comes from it; others must not send one", async () => {
    const s = await sessionFor("owner");
    const lead = await addLead();
    const registered = { ...GOOD, gstStatus: "registered" };
    for (const gstin of [undefined, "NOPE", WRONG_GSTIN]) {
      const r = await convert(lead.id, { ...registered, ...(gstin ? { gstin } : {}) }, s.cookie);
      expect(r.res.status).toBe(400);
    }
    expect((await convert(lead.id, { ...GOOD, gstin: VALID_GSTIN }, s.cookie)).res.status).toBe(400);
    expect(await one("SELECT client_id FROM leads WHERE id = ?", lead.id)).toEqual({ client_id: null });

    const ok = await convert(lead.id, { ...registered, gstin: ` ${VALID_GSTIN.toLowerCase()} ` }, s.cookie);
    expect(ok.res.status, await ok.res.clone().text()).toBe(201);
    const { clientId } = (await ok.res.json()) as { clientId: string };
    expect(await one("SELECT gstin, state_code, gst_status FROM clients WHERE id = ?", clientId)).toEqual({
      gstin: VALID_GSTIN,
      state_code: "19",
      gst_status: "registered",
    });

    // The same GSTIN on another client: 409, nothing written.
    const other = await addLead();
    const dup = await convert(other.id, { ...registered, gstin: VALID_GSTIN }, s.cookie);
    expect(dup.res.status).toBe(409);
    expect(((await bodyOf(dup.res)) as { error: { code: string } }).error.code).toBe("gstin_in_use");
    expect(await one("SELECT client_id FROM leads WHERE id = ?", other.id)).toEqual({ client_id: null });
  });

  it("a non-country code (UN, EU, UK) is refused and no client is made", async () => {
    const s = await sessionFor("owner");
    const lead = await addLead();
    for (const country of ["UN", "EU", "UK"]) {
      const r = await convert(lead.id, { ...GOOD, gstStatus: "overseas", country }, s.cookie);
      expect(r.res.status, country).toBe(400);
    }
    expect(await one("SELECT client_id FROM leads WHERE id = ?", lead.id)).toEqual({ client_id: null });
  });

  it("unknown lead is 404; bad bodies are 400; the accountant is refused (403)", async () => {
    const s = await sessionFor("sales");
    expect((await convert("no-such-lead", GOOD, s.cookie)).res.status).toBe(404);
    const lead = await addLead();
    expect((await convert(lead.id, { ...GOOD, currency: "EUR" }, s.cookie)).res.status).toBe(400);
    expect((await convert(lead.id, { ...GOOD, country: "India" }, s.cookie)).res.status).toBe(400);
    expect((await convert(lead.id, {}, s.cookie)).res.status).toBe(400);
    const acc = await sessionFor("accountant");
    const { res, rid } = await convert(lead.id, GOOD, acc.cookie);
    expect(res.status).toBe(403);
    expect(await countOf("audit_log", "request_id = ?", rid)).toBe(0);
    expect(await one("SELECT client_id FROM leads WHERE id = ?", lead.id)).toEqual({ client_id: null });
  });

  it("owner, staff and sales may convert", async () => {
    for (const role of ["owner", "staff", "sales"] as const) {
      const s = await sessionFor(role);
      expect((await convert((await addLead()).id, GOOD, s.cookie)).res.status, role).toBe(201);
    }
  });

  it("uses the person's name when the lead has no company, and the fields given when they are", async () => {
    const s = await sessionFor("owner");
    const solo = await addLead({ contact_company: null, service_code: null, message: null });
    const r = await convert(solo.id, { ...GOOD, type: "individual" }, s.cookie);
    const { clientId, proposalId } = (await r.res.json()) as { clientId: string; proposalId: string };
    expect(await one("SELECT legal_name, display_name FROM clients WHERE id = ?", clientId)).toEqual({
      legal_name: "Asha Rao",
      display_name: "Asha Rao",
    });
    // M4.3: nothing to carry over from the lead, but every draft has the three sections a proposal always has.
    expect(
      (
        await rows("SELECT kind FROM document_sections WHERE document_id = ? ORDER BY position", proposalId)
      ).map((r) => r.kind),
    ).toEqual(["estimate", "terms", "acceptance"]);
    const named = await addLead();
    const r2 = await convert(
      named.id,
      { ...GOOD, legalName: "Rao Traders Pvt Ltd", displayName: "Rao" },
      s.cookie,
    );
    const { clientId: c2 } = (await r2.res.json()) as { clientId: string };
    expect(await one("SELECT legal_name, display_name FROM clients WHERE id = ?", c2)).toEqual({
      legal_name: "Rao Traders Pvt Ltd",
      display_name: "Rao",
    });
  });
});

describe("conversion: a blank company counts as missing (M4.3 re-check 2)", () => {
  it("falls back to the person's name when the company is empty or only spaces, and trims a real one", async () => {
    const s = await sessionFor("owner");
    for (const company of ["", "   "]) {
      const lead = await addLead({ contact_company: company });
      const r = await convert(lead.id, GOOD, s.cookie);
      expect(r.res.status).toBe(201);
      const { clientId } = (await r.res.json()) as { clientId: string };
      expect(await one("SELECT legal_name, display_name FROM clients WHERE id = ?", clientId)).toEqual({
        legal_name: "Asha Rao",
        display_name: "Asha Rao",
      });
    }
    const padded = await addLead({ contact_company: "  Rao Traders  " });
    const { clientId } = (await (await convert(padded.id, GOOD, s.cookie)).res.json()) as {
      clientId: string;
    };
    expect(await one("SELECT legal_name, display_name FROM clients WHERE id = ?", clientId)).toEqual({
      legal_name: "Rao Traders",
      display_name: "Rao Traders",
    });
  });
});

describe("conversion: consent, country and the draft link (analyst early check)", () => {
  it("carries marketing consent to the contact only while it stands (not withdrawn)", async () => {
    const s = await sessionFor("owner");
    const stands = await addLead({
      consent: JSON.stringify({ marketing: true, at: 1_700_000_000_000, withdrawnAt: null }),
    });
    const withdrawn = await addLead({
      consent: JSON.stringify({ marketing: true, at: 1_700_000_000_000, withdrawnAt: 1_700_000_100_000 }),
    });
    const never = await addLead({ consent: JSON.stringify({ marketing: false, at: 1_700_000_000_000 }) });
    const none = await addLead({ consent: null });
    const consentOf = async (leadId: string) => {
      const r = await convert(leadId, GOOD, s.cookie);
      const { contactId } = (await r.res.json()) as { contactId: string };
      return (
        await one<{ marketing_consent: string | null }>(
          "SELECT marketing_consent FROM contacts WHERE id = ?",
          contactId,
        )
      )?.marketing_consent;
    };
    expect(JSON.parse((await consentOf(stands.id)) ?? "null")).toMatchObject({
      granted: true,
      source: `lead:${stands.ref}`,
    });
    expect(await consentOf(withdrawn.id)).toBeNull();
    expect(await consentOf(never.id)).toBeNull();
    expect(await consentOf(none.id)).toBeNull();
  });

  it("checks the country against the GST status: registered and unregistered need IN, overseas needs another real country", async () => {
    const s = await sessionFor("owner");
    const lead = await addLead();
    const clients = await countOf("clients");
    const refuse = async (body: Body) => {
      const { res } = await convert(lead.id, body, s.cookie);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await bodyOf(res)) as { error: { code: string } }).error.code).toBe("country_mismatch");
    };
    await refuse({ ...GOOD, gstStatus: "unregistered", country: "US" });
    await refuse({ ...GOOD, gstStatus: "registered", country: "US", gstin: VALID_GSTIN });
    await refuse({ ...GOOD, gstStatus: "overseas", country: "IN" });
    await refuse({ ...GOOD, gstStatus: "overseas", country: "ZZ" }); // not a country
    await refuse({ ...GOOD, country: "XX" });
    expect(await countOf("clients")).toBe(clients);
    const ok = await convert(
      lead.id,
      {
        ...GOOD,
        type: "business",
        gstStatus: "overseas",
        country: "US",
        currency: "USD",
        stateCode: undefined,
      },
      s.cookie,
    );
    expect(ok.res.status, JSON.stringify(await ok.res.clone().json())).toBe(201);
    expect(
      await one(
        "SELECT country, gst_status, currency FROM clients ORDER BY created_at DESC, rowid DESC LIMIT 1",
      ),
    ).toEqual({
      country: "US",
      gst_status: "overseas",
      currency: "USD",
    });
  });

  it("the draft link is a foreign key: a deleted draft clears proposal_id, and a made-up one is refused", async () => {
    const s = await sessionFor("owner");
    const lead = await addLead();
    const { res } = await convert(lead.id, GOOD, s.cookie);
    const { proposalId } = (await res.json()) as { proposalId: string };
    expect(await one("SELECT proposal_id FROM leads WHERE id = ?", lead.id)).toEqual({
      proposal_id: proposalId,
    });
    await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(proposalId).run();
    expect(await one("SELECT proposal_id FROM leads WHERE id = ?", lead.id)).toEqual({ proposal_id: null });
    await expect(
      env.DB.prepare("UPDATE leads SET proposal_id = 'no-such-document' WHERE id = ?").bind(lead.id).run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("a deleted earlier lead clears the duplicate link (ON DELETE SET NULL)", async () => {
    const first = await addLead();
    const second = await addLead();
    await env.DB.prepare("UPDATE leads SET duplicate_of = ? WHERE id = ?").bind(first.id, second.id).run();
    await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(first.id).run();
    expect(await one("SELECT duplicate_of FROM leads WHERE id = ?", second.id)).toEqual({
      duplicate_of: null,
    });
  });
});

// M3.3 carry-ins: the state code (owner Q1, 2026-10-25; Researched 2026-10-28, s.12 IGST (08-C RA-12)) and the billing contact flag (Researched
// 2026-10-28, DPDP s.6(1) (08-C RB-31): only finance contacts get finance by default).
let panSeq = 0;
describe("conversion: state code and billing contact (M3.3 carry-ins)", () => {
  const refused = async (body: Body, want: string) => {
    const s = await sessionFor("sales");
    const lead = await addLead();
    const { res } = await convert(lead.id, body, s.cookie);
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(((await bodyOf(res)) as { error: { code: string } }).error.code).toBe(want);
    expect(await one("SELECT client_id FROM leads WHERE id = ?", lead.id)).toEqual({ client_id: null });
  };

  it("an unregistered Indian client needs a state code; an overseas one must not have one", async () => {
    await refused({ ...GOOD, stateCode: undefined }, "state_required");
    await refused({ ...GOOD, stateCode: "00" }, "state_invalid");
    await refused({ ...GOOD, stateCode: "ZZ" }, "bad_request");
    await refused({ ...GOOD, stateCode: "7" }, "bad_request");
    await refused(
      { ...GOOD, gstStatus: "overseas", country: "US", currency: "USD", stateCode: "19" },
      "state_not_allowed",
    );
    await refused({ ...GOOD, gstin: VALID_GSTIN }, "gstin_not_allowed");
    const s = await sessionFor("sales");
    const lead = await addLead();
    const ok = await convert(lead.id, { ...GOOD, stateCode: "29" }, s.cookie);
    expect(ok.res.status).toBe(201);
    const { clientId } = (await ok.res.json()) as { clientId: string };
    expect(await one("SELECT state_code, gst_status FROM clients WHERE id = ?", clientId)).toEqual({
      state_code: "29",
      gst_status: "unregistered",
    });
  });

  it("a registered client takes the state from the GSTIN; another chosen state is kept and comes back as a warning", async () => {
    const s = await sessionFor("owner");
    const registered = { ...GOOD, gstStatus: "registered", gstin: VALID_GSTIN, stateCode: undefined };
    const lead = await addLead();
    // The GSTIN may already be used by an earlier test: use a different PAN each time.
    const first14 = `19AAACT${String(3000 + ++panSeq).padStart(4, "0")}Q1Z`;
    const gstin = first14 + gstinCheckChar(first14);
    const ok = await convert(lead.id, { ...registered, gstin }, s.cookie);
    expect(ok.res.status).toBe(201);
    const body = (await ok.res.json()) as { clientId: string; warnings: unknown[] };
    expect(body.warnings).toEqual([]);
    expect(await one("SELECT state_code FROM clients WHERE id = ?", body.clientId)).toEqual({
      state_code: "19",
    });

    const second = await addLead();
    const other14 = `19AAACT${String(3000 + ++panSeq).padStart(4, "0")}Q1Z`;
    const warned = await convert(
      second.id,
      { ...registered, gstin: other14 + gstinCheckChar(other14), stateCode: "27" },
      s.cookie,
    );
    expect(warned.res.status).toBe(201);
    const w = (await warned.res.json()) as { clientId: string; warnings: { code: string }[] };
    expect(w.warnings.map((x) => x.code)).toEqual(["gstin_state_mismatch"]);
    expect(await one("SELECT state_code FROM clients WHERE id = ?", w.clientId)).toEqual({
      state_code: "27",
    });
  });

  it("the billing contact flag sets is_billing, and can_see_finance goes with it", async () => {
    const s = await sessionFor("staff");
    const make = async (extra: Body) => {
      const lead = await addLead();
      const { res } = await convert(lead.id, { ...GOOD, ...extra }, s.cookie);
      expect(res.status).toBe(201);
      const { contactId } = (await res.json()) as { contactId: string };
      return one("SELECT is_primary, is_billing, can_see_finance FROM contacts WHERE id = ?", contactId);
    };
    expect(await make({ billingContact: true })).toEqual({
      is_primary: 1,
      is_billing: 1,
      can_see_finance: 1,
    });
    expect(await make({ billingContact: false })).toEqual({
      is_primary: 1,
      is_billing: 0,
      can_see_finance: 0,
    });
    expect(await make({})).toEqual({ is_primary: 1, is_billing: 0, can_see_finance: 0 });
  });
});

// Last in the file: it adds a five-digit code, which changes what "the next code" means for the tests above.
describe("client codes keep working after C9999", () => {
  it("continues with C10000 and C10001; codes that are not C plus digits are ignored", async () => {
    await env.DB.prepare(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES ('c-9999', 'C9999', 'N', 'N', 'business', 'IN', 'unregistered', '19', 'INR'), ('c-junk', 'C99AB', 'N', 'N', 'business', 'IN', 'unregistered', '19', 'INR'), ('c-junk2', 'C10000X', 'N', 'N', 'business', 'IN', 'unregistered', '19', 'INR')",
    ).run();
    // the highest real code in the table is at least C9999, whatever the earlier tests made
    const s = await sessionFor("owner");
    const a = await convert((await addLead()).id, GOOD, s.cookie);
    const b = await convert((await addLead()).id, GOOD, s.cookie);
    expect(((await a.res.json()) as { clientCode: string }).clientCode).toBe("C10000");
    expect(((await b.res.json()) as { clientCode: string }).clientCode).toBe("C10001");
  });
});
