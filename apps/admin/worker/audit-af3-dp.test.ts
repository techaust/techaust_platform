// Full audit M6–M7, fix round AF3, data protection through the admin API [run file docs/runs/full-audit-m6-m7.md AU52, AU53; ADM-CLI-05, ADM-SET-09;
// RA-25 legal hold; Settled by the lead on the safest reading, 2026-11-07, DPDP Act 2023 s.8(7) (08-C RB-11)]: a contact whose address is held at another
// client (a lead the erase would mark carries it) is not erased or anonymised: 409 `legal_hold`, nothing written, never the trigger's 500; after the hold is
// lifted it goes. An individual's last live contact takes its milestones' bells with it. Failure paths first. Invented test data.
import { uuidv7 } from "@techaust/core/ids";
import { describe, expect, it } from "vitest";
import { insert, mkClient, mkContact, mkLead } from "./test-clients.ts";
import { bodyOf, call, countOf, one, sessionFor } from "./test-helpers.ts";
import { mkMilestone, mkProject } from "./test-projects.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const code = async (res: Response) => ((await bodyOf(res)).error as { code: string } | undefined)?.code;
const erase = (cookie: string, id: string, mode: "erase" | "anonymise", part?: "offers") =>
  call(`/contacts/${id}/erase`, {
    cookie,
    body: { mode, reason: "requested", ...(part ? { part } : {}) },
  });
const hold = (by: string, entityType: string, entityId: string, action: "set" | "clear") =>
  insert("legal_holds", {
    id: uuidv7(),
    entity_type: entityType,
    entity_id: entityId,
    action,
    reason: action === "set" ? "GST notice" : "Done",
    by,
  });

describe("AU52: an address held at another client stops the erase and the anonymise", () => {
  it("the same address at two clients, one held: erase and anonymise are 409 legal_hold with nothing written; after the hold is lifted the erase goes", async () => {
    const o = await owner();
    const email = `shared-${uuidv7().slice(-8)}@example.test`;
    const a = await mkClient();
    const b = await mkClient();
    const mine = await mkContact(a, { email });
    await mkContact(b, { email });
    // a website lead with the address and no client: the erase of `mine` would mark it
    const lead = await mkLead(email);
    await hold(o.id, "client", b, "set");
    for (const mode of ["erase", "anonymise"] as const) {
      const res = await erase(o.cookie, mine.id, mode);
      expect(res.status, mode).toBe(409);
      expect(await code(res), mode).toBe("legal_hold");
    }
    // the anonymise in parts (the offers first) is refused the same way
    const part = await erase(o.cookie, mine.id, "anonymise", "offers");
    expect(part.status).toBe(409);
    expect(await code(part)).toBe("legal_hold");
    // nothing written: the contact, the lead and the log are as they were
    expect(await one("SELECT email, anonymised_at FROM contacts WHERE id = ?", mine.id)).toEqual({
      email,
      anonymised_at: null,
    });
    expect(await one("SELECT contact_email, erased_hash FROM leads WHERE id = ?", lead)).toEqual({
      contact_email: email,
      erased_hash: null,
    });
    expect(
      await countOf(
        "audit_log",
        "action IN ('contact.erase', 'contact.anonymise', 'contact.redact_offers') AND json_extract(summary, '$.contactId') = ?",
        mine.id,
      ),
    ).toBe(0);
    // the hold lifted: the erase goes, and the lead is marked
    await hold(o.id, "client", b, "clear");
    const done = await erase(o.cookie, mine.id, "erase");
    expect(done.status).toBe(200);
    expect(await countOf("contacts", "id = ?", mine.id)).toBe(0);
    expect(
      (await one<{ erased_hash: string | null }>("SELECT erased_hash FROM leads WHERE id = ?", lead))
        ?.erased_hash,
    ).not.toBeNull();
  });

  it("a held contact (not its client) with the address at another client also stops it; a lead held with the address does too", async () => {
    const o = await owner();
    const email = `held-${uuidv7().slice(-8)}@example.test`;
    const a = await mkClient();
    const b = await mkClient();
    const mine = await mkContact(a, { email });
    const other = await mkContact(b, { email });
    await mkLead(email);
    await hold(o.id, "contact", other.id, "set");
    expect(await code(await erase(o.cookie, mine.id, "erase"))).toBe("legal_hold");
    await hold(o.id, "contact", other.id, "clear");
    // a lead of another client with the same address, under its own hold
    const c = await mkClient();
    const heldLead = await mkLead(email, { client_id: c });
    await hold(o.id, "lead", heldLead, "set");
    expect(await code(await erase(o.cookie, mine.id, "anonymise"))).toBe("legal_hold");
    await hold(o.id, "lead", heldLead, "clear");
    expect((await erase(o.cookie, mine.id, "anonymise")).status).toBe(200);
  });

  it("AU59: any held holder of the address stops it, with no lead at all: a held contact at client A, the same address erased at client B is 409 with nothing written; after the hold is lifted it goes", async () => {
    const o = await owner();
    const email = `nolead-${uuidv7().slice(-8)}@example.test`;
    const a = await mkClient();
    const b = await mkClient();
    const held = await mkContact(a, { email });
    const mine = await mkContact(b, { email });
    await hold(o.id, "contact", held.id, "set");
    const audits = () =>
      countOf(
        "audit_log",
        "action IN ('contact.erase', 'contact.anonymise', 'contact.redact_offers') AND json_extract(summary, '$.contactId') = ?",
        mine.id,
      );
    for (const [mode, part] of [
      ["erase", undefined],
      ["anonymise", undefined],
      ["anonymise", "offers"],
    ] as const) {
      const res = await erase(o.cookie, mine.id, mode, part);
      expect(res.status, `${mode} ${part ?? ""}`).toBe(409);
      expect(await code(res)).toBe("legal_hold");
    }
    expect(await one("SELECT email, anonymised_at, erased_hash FROM contacts WHERE id = ?", mine.id)).toEqual(
      {
        email,
        anonymised_at: null,
        erased_hash: null,
      },
    );
    expect(await audits()).toBe(0);
    // a held CLIENT of the address counts the same way
    await hold(o.id, "contact", held.id, "clear");
    await hold(o.id, "client", a, "set");
    expect(await code(await erase(o.cookie, mine.id, "erase"))).toBe("legal_hold");
    await hold(o.id, "client", a, "clear");
    // lifted: the erase goes; the other client's contact stays
    expect((await erase(o.cookie, mine.id, "erase")).status).toBe(200);
    expect(await countOf("contacts", "id = ?", mine.id)).toBe(0);
    expect(await countOf("contacts", "id = ?", held.id)).toBe(1);
  });
});

describe("AU53: an individual's milestone bells go with its last live contact", () => {
  it("the anonymise deletes the bells of the client's milestones (both marker kinds); another client's milestone bells stay", async () => {
    const o = await owner();
    const ind = await mkClient({ type: "individual" });
    const person = await mkContact(ind);
    const project = await mkProject(ind);
    const ms = await mkMilestone(project.id, { title: "Wedding album for Pat" });
    const biz = await mkClient();
    const otherMs = await mkMilestone((await mkProject(biz)).id);
    const bell = (kind: string, milestone: string) =>
      insert("notifications", {
        id: uuidv7(),
        user_id: o.id,
        kind,
        entity_type: "milestone",
        entity_id: milestone,
        title: `Wedding album for Pat was delivered 30 days ago (${kind})`,
        link: `/projects/${project.id}`,
      });
    await bell("milestone.unbilled", ms.id);
    await bell("proforma.tax_invoice_due", ms.id);
    await bell("milestone.unbilled", otherMs.id);
    const res = await erase(o.cookie, person.id, "anonymise");
    expect(res.status).toBe(200);
    expect(await countOf("notifications", "entity_type = 'milestone' AND entity_id = ?", ms.id)).toBe(0);
    expect(await countOf("notifications", "entity_type = 'milestone' AND entity_id = ?", otherMs.id)).toBe(1);
    // the milestone itself stays, renamed
    expect((await one<{ title: string }>("SELECT title FROM milestones WHERE id = ?", ms.id))?.title).toMatch(
      /^Milestone \d+$/,
    );
  });

  it("a business client's milestone bells stay when one of its contacts is anonymised", async () => {
    const o = await owner();
    const biz = await mkClient();
    const person = await mkContact(biz);
    const ms = await mkMilestone((await mkProject(biz)).id);
    await insert("notifications", {
      id: uuidv7(),
      user_id: o.id,
      kind: "milestone.unbilled",
      entity_type: "milestone",
      entity_id: ms.id,
      title: "Milestone for Test Co",
      link: "/projects",
    });
    expect((await erase(o.cookie, person.id, "anonymise")).status).toBe(200);
    expect(await countOf("notifications", "entity_type = 'milestone' AND entity_id = ?", ms.id)).toBe(1);
  });
});
