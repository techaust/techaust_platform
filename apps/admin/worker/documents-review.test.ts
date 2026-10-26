// The review fixes of M4.3 that are not the diff save [ADM-PROP-02, -04, -05, -06, ADM-APR-01, -02, ADM-EST-02]: the frozen recipient and issuer on GET,
// the empty-section send blocker, a rejected request cannot be re-sent unchanged, discard removes the bell rows, a version 2 draft shows its group's
// number, what a converted estimate became, the `converted` send guard and the live "client erased between read and send" branch.
import { env } from "cloudflare:workers";
import { seedStatements } from "@techaust/db";
import { beforeAll, describe, expect, it } from "vitest";
import { putPaymentTerms } from "./test-catalogue.ts";
import { call, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import {
  beforeSendBatch,
  codeOf,
  counter,
  dbRow,
  getDoc,
  type J,
  json,
  mkDraft,
  mkService,
  mkTerms,
  patchDoc,
  sendBodyOf,
  sendDoc,
} from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

const sendOk = async (o: Awaited<ReturnType<typeof owner>>, id: string) => {
  const res = await sendDoc(o, id, (await getDoc(o, id)).updatedAt);
  expect(res.status, await res.clone().text()).toBe(200);
  return json(res);
};

describe("a sent version shows who it was sent to (review 1)", () => {
  it("GET of a frozen version reads the client and contact from the recipient snapshot, and returns recipient and issuer; a draft stays live", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const draft = await getDoc(o, made.id);
    expect(draft.recipient).toBeNull();
    expect(draft.issuer).toBeNull();
    const liveName = draft.client.name as string;
    expect(draft.contact.name).toBe("Asha Rao");
    await sendOk(o, made.id);

    await env.DB.prepare(
      "UPDATE clients SET display_name = 'Renamed Ltd', legal_name = 'Renamed Ltd', state_code = '27' WHERE id = ?",
    )
      .bind(made.clientId)
      .run();
    await env.DB.prepare(
      "UPDATE contacts SET name = 'Someone Else', email = 'else@example.test' WHERE id = ?",
    )
      .bind(made.contactId)
      .run();

    const frozen = await getDoc(o, made.id);
    expect(frozen.frozen).toBe(true);
    expect(frozen.client.name).toBe(liveName);
    expect(frozen.client.stateCode).toBe("19");
    expect(frozen.client.id).toBe(made.clientId);
    expect(frozen.contact).toMatchObject({ id: made.contactId, name: "Asha Rao" });
    expect(frozen.contact.email).not.toBe("else@example.test");
    expect(frozen.recipient).toMatchObject({
      displayName: liveName,
      stateCode: "19",
      contactId: made.contactId,
      contactName: "Asha Rao",
    });
    expect(frozen.issuer.company.tradeName).toBeTruthy();
    expect(frozen.issuer.sender.staffId).toBe(o.id);

    // a new draft of the same client reads the live record
    const v2 = await json(await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} }));
    const live = await getDoc(o, v2.id);
    expect(live.recipient).toBeNull();
    expect(live.client.name).toBe("Renamed Ltd");
    expect(live.contact.name).toBe("Someone Else");
  });
});

describe("empty sections stop a send (review 8)", () => {
  it("a visible optional section with no text is a blocker with its id and kind; hiding it or writing it clears it", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const sections = doc.sections.map((x: J) => ({
      id: x.id,
      kind: x.kind,
      title: x.title,
      bodyMd: x.bodyMd,
      hidden: x.hidden,
    }));
    const empty = { kind: "summary", title: "Summary", bodyMd: "", hidden: false };
    const saved = await json(
      await patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, sections: [empty, ...sections] }),
    );
    const view = await getDoc(o, made.id);
    const blocker = view.blockers.find((b: J) => b.code === "section_empty");
    expect(blocker).toBeTruthy();
    expect(blocker.kinds).toEqual(["summary"]);
    expect(blocker.sections).toEqual([saved.sections[0].id]);
    expect(view.canSend).toBe(false);

    const before = await counter();
    const refused = await sendDoc(o, made.id, view.updatedAt);
    expect(refused.status).toBe(409);
    const body = await json(refused);
    expect(body.error.code).toBe("section_empty");
    expect(body.reasons.find((b: J) => b.code === "section_empty").sections).toEqual(blocker.sections);
    expect(await counter()).toBe(before);
    expect((await dbRow(made.id))?.status).toBe("draft");

    // the required sections (estimate, terms, acceptance) may have no body of their own: they are not optional
    const required = view.sections.filter((x: J) => ["estimate", "terms", "acceptance"].includes(x.kind));
    expect(required.length).toBe(3);
    expect(blocker.kinds).not.toContain("terms");

    // writing it clears the blocker, and so does hiding it
    const plain = (x: J, over: J = {}) => ({
      id: x.id,
      kind: x.kind,
      title: x.title,
      bodyMd: x.bodyMd,
      hidden: x.hidden,
      ...over,
    });
    const target = blocker.sections[0];
    const write = view.sections.map((x: J) =>
      plain(x, x.id === target ? { bodyMd: "Now it says something." } : {}),
    );
    const wrote = await patchDoc(o, made.id, { expectedUpdatedAt: view.updatedAt, sections: write });
    expect(wrote.status, await wrote.clone().text()).toBe(200);
    expect((await getDoc(o, made.id)).blockers.find((b: J) => b.code === "section_empty")).toBeUndefined();
    const now = await getDoc(o, made.id);
    const hide = now.sections.map((x: J) => plain(x, x.id === target ? { bodyMd: "", hidden: true } : {}));
    const hid = await json(await patchDoc(o, made.id, { expectedUpdatedAt: now.updatedAt, sections: hide }));
    expect((await getDoc(o, made.id)).blockers.find((b: J) => b.code === "section_empty")).toBeUndefined();
    expect((await sendDoc(o, made.id, hid.updatedAt)).status).toBe(200);
  });
});

describe("a rejected request cannot be sent again unchanged (review 12)", () => {
  it("409 approval_rejected while the content is the rejected content; any edit makes it new content (and reverting is blocked again)", async () => {
    const sales = await sessionFor("sales");
    const owner1 = await owner();
    const made = await mkDraft(sales, { price: 20_000_000 });
    const doc = await getDoc(sales, made.id);
    const d = await json(
      await patchDoc(sales, made.id, {
        expectedUpdatedAt: doc.updatedAt,
        fields: { discount: { kind: "percent", value: 2500 } },
      }),
    );
    const asked = await call(`/documents/${made.id}/approval-request`, {
      cookie: sales.cookie,
      body: { expectedUpdatedAt: d.updatedAt },
    });
    expect(asked.status, await asked.clone().text()).toBe(201);
    const approvalId = (await json(asked)).id;
    const no = await call(`/approvals/${approvalId}/decide`, {
      cookie: owner1.cookie,
      body: { decision: "reject", note: "No" },
    });
    expect(no.status).toBe(200);

    const again = await call(`/documents/${made.id}/approval-request`, {
      cookie: sales.cookie,
      body: { expectedUpdatedAt: d.updatedAt },
    });
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("approval_rejected");
    expect(await countOf("approvals", "document_id = ?", made.id)).toBe(1);

    const changed = await json(
      await patchDoc(sales, made.id, {
        expectedUpdatedAt: d.updatedAt,
        fields: { discount: { kind: "percent", value: 2000 } },
      }),
    );
    const fresh = await call(`/documents/${made.id}/approval-request`, {
      cookie: sales.cookie,
      body: { expectedUpdatedAt: changed.updatedAt },
    });
    expect(fresh.status, await fresh.clone().text()).toBe(201);
  });
});

describe("a version 2 draft in the list (review 13)", () => {
  it("carries the group's number as numberDisplay while its own number is empty", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const sent = await sendOk(o, made.id);
    const v2 = await json(await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} }));
    const list = await json(await call(`/clients/${made.clientId}/documents`, { cookie: o.cookie }));
    const row = list.documents.find((r: J) => r.id === v2.id);
    expect(row).toBeTruthy();
    expect(row.version).toBe(2);
    expect(row.number).toBeNull();
    expect(row.numberDisplay).toBe(sent.number);
    // a sent version shows its own
    await sendOk(o, v2.id);
    const after = await json(await call(`/clients/${made.clientId}/documents`, { cookie: o.cookie }));
    expect(after.documents.find((r: J) => r.id === v2.id).numberDisplay).toBe(sent.number);
  });
});

describe("what a converted estimate became (review 9)", () => {
  it("convertedTo is null until converted, then names the invoice draft", async () => {
    const o = await owner();
    const made = await mkDraft(o, { type: "estimate" });
    await sendOk(o, made.id);
    await env.DB.prepare("UPDATE documents SET status = 'accepted' WHERE id = ?").bind(made.id).run();
    expect((await getDoc(o, made.id)).convertedTo).toBeNull();
    const res = await call(`/documents/${made.id}/convert`, { cookie: o.cookie, body: { to: "invoice" } });
    expect(res.status, await res.clone().text()).toBe(201);
    const invoice = await json(res);
    expect((await getDoc(o, made.id)).convertedTo).toEqual({ kind: "invoice", id: invoice.id });
    // another estimate and a proposal are not affected
    const other = await mkDraft(o, { type: "estimate" });
    expect((await getDoc(o, other.id)).convertedTo).toBeNull();
  });
});

describe("the converted guard (review: M4.5 ask)", () => {
  it("a new version cannot be sent, or even revised, once any version of the group is converted", async () => {
    const o = await owner();
    const made = await mkDraft(o, { type: "estimate" });
    await sendOk(o, made.id);
    const v2 = await json(await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} }));
    // `converted` is set by M4.5; the status flow trigger has no edge to it yet, so the test lifts the trigger for one statement
    const trigger = await one<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'documents_status_flow'",
    );
    expect(trigger?.sql).toBeTruthy();
    await env.DB.prepare("DROP TRIGGER documents_status_flow").run();
    try {
      await env.DB.prepare("UPDATE documents SET status = 'converted' WHERE id = ?").bind(made.id).run();
    } finally {
      await env.DB.prepare(trigger?.sql ?? "").run();
    }
    const before = await counter("estimate");
    const view = await getDoc(o, v2.id);
    const res = await sendDoc(o, v2.id, view.updatedAt);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("already_accepted");
    expect(await counter("estimate")).toBe(before);
    expect((await dbRow(v2.id))?.status).toBe("draft");
    expect(
      await one("SELECT 1 AS x FROM audit_log WHERE action = 'document.send' AND entity_id = ?", v2.id),
    ).toBeNull();
    // the read that explains it is the one in the send route; revise of the converted group is refused as well
    const third = await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} });
    expect(third.status).toBe(409);
  });
});

describe("the send is written only for a live client (review 11)", () => {
  it("a client erased between the read and the batch: 409 client_anonymised, no number burned, nothing written", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const view = await getDoc(o, made.id);
    const body = await sendBodyOf(made.id, view.updatedAt);
    const before = await counter();
    const snapshot = JSON.stringify(await rows("SELECT * FROM documents WHERE id = ?", made.id));
    const res = await call(
      `/documents/${made.id}/send`,
      { cookie: o.cookie, body },
      beforeSendBatch(async () => {
        await env.DB.prepare("UPDATE clients SET anonymised_at = ? WHERE id = ?")
          .bind(Date.now(), made.clientId)
          .run();
      }),
    );
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await codeOf(res)).toBe("client_anonymised");
    expect(await counter()).toBe(before);
    expect(JSON.stringify(await rows("SELECT * FROM documents WHERE id = ?", made.id))).toBe(snapshot);
    expect(await countOf("audit_log", "action = 'document.send' AND entity_id = ?", made.id)).toBe(0);
  });
});

describe("a draft made from the seeded version 2 template (07-O section 1)", () => {
  it("takes the newest template, fills the placeholders, and waits for the sections written per proposal", async () => {
    await env.DB.batch(
      seedStatements()
        .filter((s) => s.startsWith("INSERT INTO `templates`"))
        .map((s) => env.DB.prepare(s)),
    );
    const o = await owner();
    const item = await mkService(500_000, {
      short: "A new website",
      deliverables_md: "- Five pages",
      assumptions_md: "- Content supplied",
      exclusions_md: "- Hosting",
    });
    const made = await mkDraft(o, { item });
    const doc = await getDoc(o, made.id);
    const text = (kind: string) => doc.sections.find((x: J) => x.kind === kind)?.bodyMd as string;
    expect(text("cover")).toMatch(/^.+\n.+\nProposal from .+$/);
    expect(text("summary")).toMatch(
      /^This proposal covers .+: what we'll build, how we'll deliver it in stages/,
    );
    expect(text("scope")).toBe(
      "A new website\n\nThe price covers the written scope. If you want something new, we quote it before doing it, and you decide.",
    );
    expect(text("acceptance")).toMatch(
      /^Prepared for Asha Rao\.\n\nTo accept, open this proposal in the client portal/,
    );
    expect(text("acceptance")).toMatch(/valid for \d+ days from the date it's sent\.$/);
    expect(doc.unresolved).toEqual([]);
    // the sections written per proposal block the send until they are written or hidden
    const empty = doc.blockers.find((b: J) => b.code === "section_empty");
    expect(empty.kinds).toEqual(["problem_goals", "timeline", "team"]);
    expect(doc.canSend).toBe(false);
  });
});
