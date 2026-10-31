// A sent version of a client or contact whose personal details were removed (M4.3 re-check, candidate 2; the owner's answer of 2026-10-26;
// Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11)): the staff GET shows "Anonymised client" and no name, email, GSTIN or address. These tests
// mark the client or contact anonymised straight in the database, so they test the VIEW alone: the stored snapshot stays byte for byte, as it does for an
// accepted offer. The anonymise ROUTE also redacts the stored copy of a never-accepted offer (T7; Settled by the lead on the safest reading, 2026-10-30
// (08-C RB-37)): offer-erasure.test.ts.
import { env } from "cloudflare:workers";
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { viewRecipient } from "@techaust/core/redaction";
import { beforeAll, describe, expect, it } from "vitest";
import { putPaymentTerms } from "./test-catalogue.ts";
import { one, sessionFor } from "./test-helpers.ts";
import { getDoc, json, mkDraft, mkTerms, sendDoc } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

const sentDoc = async () => {
  const o = await owner();
  const made = await mkDraft(o);
  const res = await sendDoc(o, made.id, (await getDoc(o, made.id)).updatedAt);
  expect(res.status, await res.clone().text()).toBe(200);
  await json(res);
  return { o, made };
};
const stored = async (id: string) =>
  (await one<{ recipient: string; issuer: string; snapshot_sha256: string }>(
    "SELECT recipient, issuer, snapshot_sha256 FROM documents WHERE id = ?",
    id,
  )) as { recipient: string; issuer: string; snapshot_sha256: string };

describe("the staff view of a sent version after anonymising", () => {
  it("a contact anonymised: the contact's name and email are replaced, the business stays, the stored snapshot is byte-identical", async () => {
    const { o, made } = await sentDoc();
    const before = await stored(made.id);
    const wasView = await getDoc(o, made.id);
    expect(wasView.contact).toMatchObject({ name: "Asha Rao", anonymised: false });
    expect(wasView.recipient.anonymised).toBeUndefined();
    const business = wasView.recipient.legalName as string;

    await env.DB.prepare(
      "UPDATE contacts SET anonymised_at = ?, name = 'Removed contact', email = 'removed-1@invalid.example' WHERE id = ?",
    )
      .bind(Date.now(), made.contactId)
      .run();

    const view = await getDoc(o, made.id);
    expect(view.recipient).toMatchObject({
      legalName: business,
      contactId: made.contactId,
      contactName: ANONYMISED_CLIENT,
      email: null,
      anonymised: true,
    });
    expect(view.contact).toEqual({
      id: made.contactId,
      name: ANONYMISED_CLIENT,
      email: null,
      anonymised: true,
    });
    expect(view.client.name).not.toBe(ANONYMISED_CLIENT);
    const shown = JSON.stringify({ r: view.recipient, c: view.contact });
    expect(shown).not.toContain("Asha Rao");
    expect(shown).not.toContain(before.recipient.match(/"email":"([^"]+)"/)?.[1] as string);
    expect(await stored(made.id)).toEqual(before);
  });

  it("a client anonymised: names, email, GSTIN and address are replaced everywhere in the view; country, type and GST status stay; the snapshot is byte-identical", async () => {
    const { o, made } = await sentDoc();
    const before = await stored(made.id);
    const wasView = await getDoc(o, made.id);
    const legal = wasView.recipient.legalName as string;

    await env.DB.prepare("UPDATE clients SET anonymised_at = ? WHERE id = ?")
      .bind(Date.now(), made.clientId)
      .run();

    const view = await getDoc(o, made.id);
    expect(view.client).toMatchObject({ id: made.clientId, name: ANONYMISED_CLIENT, anonymised: true });
    expect(view.recipient).toMatchObject({
      legalName: ANONYMISED_CLIENT,
      displayName: ANONYMISED_CLIENT,
      gstin: null,
      address: null,
      email: null,
      contactName: ANONYMISED_CLIENT,
      country: wasView.recipient.country,
      anonymised: true,
    });
    expect(view.contact).toMatchObject({ name: ANONYMISED_CLIENT, email: null, anonymised: true });
    const shown = JSON.stringify({ r: view.recipient, c: view.contact, cl: view.client });
    expect(shown).not.toContain(legal);
    expect(shown).not.toContain("Asha Rao");
    expect(await stored(made.id)).toEqual(before);
    expect(JSON.parse(before.recipient).legalName).toBe(legal);
  });

  it("a blank display name at send counts as missing: the view names the legal name (candidate 9)", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    await env.DB.prepare(
      "UPDATE clients SET display_name = '   ', legal_name = 'Legal Name Pvt Ltd' WHERE id = ?",
    )
      .bind(made.clientId)
      .run();
    const res = await sendDoc(o, made.id, (await getDoc(o, made.id)).updatedAt);
    expect(res.status, await res.clone().text()).toBe(200);
    const view = await getDoc(o, made.id);
    expect(JSON.parse((await stored(made.id)).recipient).displayName).toBe("   ");
    expect(view.client.name).toBe("Legal Name Pvt Ltd");
  });

  it("a live client and contact are shown exactly as sent", async () => {
    const { o, made } = await sentDoc();
    const stored1 = JSON.parse((await stored(made.id)).recipient);
    const view = await getDoc(o, made.id);
    expect(view.recipient).toEqual(stored1);
    expect(view.contact.anonymised).toBe(false);
  });
});

describe("viewRecipient", () => {
  const r = {
    legalName: "A Person",
    displayName: "A",
    gstin: "19AAAAA0000A1Z5",
    stateCode: "19",
    address: { line1: "1 Road", city: "Balurghat", country: "IN" },
    email: "a@example.test",
    country: "IN",
    contactId: "c1",
    contactName: "A Person",
    clientType: "individual" as const,
    gstStatus: "registered" as const,
  };
  it("returns the snapshot itself when nothing was anonymised, and never mutates it", () => {
    expect(viewRecipient(r, false, false)).toBe(r);
    const copy = structuredClone(r);
    viewRecipient(r, true, true);
    expect(r).toEqual(copy);
  });
  it("without a contact in the snapshot, adds none", () => {
    const { contactId: _i, contactName: _n, email: _e, ...noContact } = r;
    const v = viewRecipient(noContact, true, false);
    expect(v).not.toHaveProperty("contactName");
    expect(v).toMatchObject({ legalName: ANONYMISED_CLIENT, gstin: null, address: null, stateCode: "19" });
  });
});
