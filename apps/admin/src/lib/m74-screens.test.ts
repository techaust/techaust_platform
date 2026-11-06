// M7.4's screen rules (run file G; C.1–C.4, L28, L42, Q2 A): who a request is from, its reply clock, the inbox's "Show" queries, what the close offers (held
// to core's `closeVerdict`), the erasures a close can link, the staff log's checks, the lists pinned to core, and the clean-up bells' landing.
import { fromIst, parseIsoDate } from "@techaust/core/dates";
import {
  DECLINE_REASONS as CORE_DECLINE,
  EMAIL_ONLY_DECLINE_REASONS as CORE_EMAIL_ONLY,
  IDENTITY_CHECKED_KINDS as CORE_IDENTITY,
  REQUEST_KINDS as CORE_KINDS,
  STAFF_CHANNELS as CORE_STAFF_CHANNELS,
  closeVerdict,
} from "@techaust/core/dsr";
import { describe, expect, it } from "vitest";
import { type AuditEntry, RequestError } from "../api.ts";
import { eraseRefusal, tooManyRefs } from "../routes/leads/data-tools.tsx";
import { reportBellHref } from "./bell-links.ts";
import { ZR_CLOSE, ZR_LEAD, ZR_LOG, ZR_REQ } from "./copy-zr.ts";
import { ZR_NAV } from "./copy-zr-nav.ts";
import {
  DECLINE_REASONS,
  EMAIL_ONLY_DECLINE_REASONS,
  IDENTITY_CHECKED_KINDS,
  REQUEST_KINDS,
  type RequestView,
  STAFF_CHANNELS,
} from "./m74-api.ts";
import {
  clientIdOfLink,
  clockOf,
  closeErrorText,
  closeOptions,
  erasureActionsOf,
  erasureMatches,
  exportSentAtOf,
  type LogForm,
  logBodyOf,
  logErrorText,
  queryOf,
  stateLook,
  subjectOf,
} from "./requests.ts";

const DAY = 86_400_000;
const T0 = fromIst(parseIsoDate("2026-11-02") ?? { year: 2026, month: 11, day: 2 }, 10);

const req = (o: Partial<RequestView> = {}): RequestView => ({
  id: "r1",
  client: { id: "c1", code: "C-0001", name: "Sample Traders (sample)" },
  contact: { id: "p1", name: "Asha Rao (sample)", email: "asha@example.test" },
  leadId: null,
  lead: null,
  contactRef: "p1",
  requesterEmail: null,
  kind: "data_access",
  details: null,
  status: "open",
  outcome: null,
  closedBy: null,
  closedAt: null,
  closeNote: null,
  createdAt: T0,
  updatedAt: T0,
  channel: "portal",
  loggedBy: null,
  receivedAt: T0,
  dueAt: T0 + 30 * DAY,
  ackDueAt: T0 + 2 * DAY,
  acknowledgedAt: null,
  identityCheckedAt: T0,
  identityCheckedBy: null,
  declineReason: null,
  actionAuditId: null,
  exportSentAt: null,
  state: "open",
  daysLeft: 30,
  canClose: true,
  ...o,
});

describe("the lists the screens offer are core's [ADM-SET-09, POR-11]", () => {
  it("kinds, channels, decline reasons, the L28 reasons and the L42 kinds", () => {
    expect([...REQUEST_KINDS].sort()).toEqual([...CORE_KINDS].sort());
    // review low 5: core's lists, in the screens' own order for the kinds (the data rights first)
    expect(REQUEST_KINDS).toEqual([
      "data_access",
      "data_correction",
      "data_erasure",
      "consent_withdrawal",
      "nomination",
      "grievance",
      "contact_change",
    ]);
    expect(DECLINE_REASONS).toBe(CORE_DECLINE);
    expect(EMAIL_ONLY_DECLINE_REASONS).toBe(CORE_EMAIL_ONLY);
    expect(IDENTITY_CHECKED_KINDS).toBe(CORE_IDENTITY);
    expect(STAFF_CHANNELS).toBe(CORE_STAFF_CHANNELS);
    expect([...STAFF_CHANNELS]).toEqual([...CORE_STAFF_CHANNELS]);
    expect([...DECLINE_REASONS]).toEqual([...CORE_DECLINE]);
    expect([...EMAIL_ONLY_DECLINE_REASONS]).toEqual([...CORE_EMAIL_ONLY]);
    expect([...IDENTITY_CHECKED_KINDS]).toEqual([...CORE_IDENTITY]);
    for (const k of CORE_KINDS) expect(ZR_REQ.kind[k]).toBeTruthy();
    for (const r of CORE_DECLINE) expect(ZR_CLOSE.reasons[r]).toBeTruthy();
  });

  it("the navigation count", () => {
    expect(ZR_NAV.count(1)).toBe("1 open request");
    expect(ZR_NAV.count(4)).toBe("4 open requests");
  });
});

describe("who a request is from", () => {
  it("a contact, a contact since erased, the client as a whole, a lead, a lead since erased, an address", () => {
    expect(subjectOf(req())).toEqual({
      name: "Asha Rao (sample)",
      meta: "C-0001, asha@example.test",
      href: "/clients/c1?tab=contacts",
    });
    expect(subjectOf(req({ contact: null })).name).toBe(ZR_REQ.contactGone);
    expect(subjectOf(req({ contact: null, contactRef: null })).name).toBe(ZR_REQ.wholeClient);
    const lead = req({
      client: null,
      contact: null,
      contactRef: null,
      leadId: "l1",
      lead: { id: "l1", ref: "L-0042", gone: false },
    });
    expect(subjectOf(lead)).toEqual({ name: "Lead L-0042", meta: null, href: "/leads/l1" });
    expect(subjectOf({ ...lead, leadId: null, lead: { id: "l1", ref: null, gone: true } })).toEqual({
      name: ZR_REQ.leadGone,
      meta: null,
      href: null,
    });
    expect(
      subjectOf(req({ client: null, contact: null, contactRef: null, requesterEmail: "x@example.test" })),
    ).toEqual({
      name: "x@example.test",
      meta: ZR_REQ.unmatched,
      href: null,
    });
  });
});

describe("the reply clock and the state pill", () => {
  it("fills as far as today, never past the end, in the state's colour, with the days in words", () => {
    const c = clockOf(req({ daysLeft: 15 }), T0 + 15 * DAY);
    expect(c?.elapsed).toBeCloseTo(0.5, 2);
    expect(c?.tone).toBe("accent");
    expect(c?.left).toBe("15 days left");
    expect(clockOf(req({ state: "overdue", daysLeft: -3 }), T0 + 33 * DAY)).toMatchObject({
      elapsed: 1,
      tone: "danger",
      left: "3 days overdue",
    });
    expect(clockOf(req({ state: "due_soon", daysLeft: 1 }), T0)?.left).toBe("1 day left");
    expect(clockOf(req({ state: "ack_overdue", daysLeft: 0 }), T0)).toMatchObject({
      tone: "warning",
      left: "Due today",
    });
    expect(clockOf(req({ status: "closed" }), T0)).toBeNull();
  });

  it("the pill has words and an icon for every state, the outcome once closed", () => {
    expect(stateLook(req({ state: "overdue" }))).toMatchObject({ tone: "danger", text: "Overdue" });
    expect(stateLook(req({ state: "ack_overdue" })).text).toBe("Not acknowledged");
    expect(stateLook(req({ status: "closed", outcome: "done" }))).toMatchObject({
      tone: "success",
      text: "Done",
    });
    expect(stateLook(req({ status: "closed", outcome: "declined" })).text).toBe("Declined");
  });
});

describe("the inbox's Show choices (C.1: a state filter takes no status)", () => {
  it("asks the list the way the API takes it", () => {
    expect(queryOf("open", "")).toEqual({ status: "open", kind: undefined, after: undefined });
    expect(queryOf("closed", "data_erasure", "x")).toEqual({
      status: "closed",
      kind: "data_erasure",
      after: "x",
    });
    expect(queryOf("overdue", "")).toEqual({ state: "overdue", kind: undefined, after: undefined });
    expect(queryOf("ack_overdue", "grievance")).toEqual({
      state: "ack_overdue",
      kind: "grievance",
      after: undefined,
    });
  });
});

describe("the close offers only what core's closeVerdict accepts (L28, L42, Q2 A)", () => {
  const cases: RequestView[] = [
    req(),
    req({ identityCheckedAt: null, channel: "email" }),
    req({ kind: "data_erasure" }),
    req({
      kind: "data_erasure",
      client: null,
      contact: null,
      contactRef: null,
      requesterEmail: "x@example.test",
    }),
    req({ kind: "grievance", identityCheckedAt: null }),
    req({ kind: "nomination", identityCheckedAt: null }),
  ];
  for (const r of cases)
    it(`${r.kind}${r.identityCheckedAt === null ? ", identity not checked" : ""}${r.contactRef === null ? ", address only" : ""}`, () => {
      const o = closeOptions(r);
      const row = {
        kind: r.kind,
        status: "open",
        contactRef: r.contactRef,
        leadRef: r.lead?.id ?? null,
        identityCheckedAt: r.identityCheckedAt,
      };
      const done = closeVerdict(row, {
        outcome: "done",
        actionAuditId: o.needsAction ? "a1" : null,
        exportSentAt: o.canRecordExport ? T0 : null,
      });
      expect(done.ok).toBe(o.done === "ok");
      for (const reason of CORE_DECLINE)
        expect(closeVerdict(row, { outcome: "declined", declineReason: reason }).ok).toBe(
          o.reasons.includes(reason),
        );
    });

  it("Done waits for the identity check on the L42 kinds, and says why", () => {
    expect(closeOptions(req({ identityCheckedAt: null })).done).toBe("identity_first");
    expect(closeOptions(req({ kind: "grievance", identityCheckedAt: null })).done).toBe("ok");
    expect(
      closeOptions(req({ kind: "data_erasure", contactRef: null, contact: null, client: null })).done,
    ).toBe("unmatched_erasure");
    expect(closeErrorText(new RequestError(409, "identity_not_checked", "x"))).toBe(ZR_CLOSE.identityFirst);
    expect(closeErrorText(new RequestError(409, "action_missing", "x"))).toBe(
      ZR_CLOSE.refused.action_missing,
    );
  });
});

describe("the erasure a done erasure request links (round 4, round 6)", () => {
  const a = (o: Partial<AuditEntry>): AuditEntry =>
    ({
      id: "a",
      at: T0 + DAY,
      actorType: "staff",
      actorId: "u",
      actorName: "Owner (sample)",
      role: "owner",
      action: "contact.erase",
      entityType: "client",
      entityId: "c1",
      summary: { contactId: "p1" },
      ...o,
    }) as AuditEntry;
  it("this contact's erase or anonymise since the request arrived, newest first; never another person's or an older one", () => {
    const r = req({ kind: "data_erasure" });
    const list = [
      a({ id: "mine", at: T0 + DAY }),
      a({ id: "anon", action: "contact.anonymise", at: T0 + 2 * DAY }),
      a({ id: "other", summary: { contactId: "p2" } }),
      a({ id: "old", at: T0 - DAY }),
      a({ id: "lead", action: "lead.erase", entityType: "lead", entityId: "p1" }),
    ];
    expect(erasureMatches(list, r).map((x) => x.id)).toEqual(["anon", "mine"]);
    expect(erasureActionsOf(r)).toEqual(["contact.erase", "contact.anonymise"]);
  });
  it("a lead's request links that lead's erase", () => {
    const r = req({
      kind: "data_erasure",
      client: null,
      contact: null,
      contactRef: null,
      leadId: "l1",
      lead: { id: "l1", ref: "L-1", gone: false },
    });
    expect(erasureActionsOf(r)).toEqual(["lead.erase"]);
    expect(
      erasureMatches(
        [
          a({ id: "x", action: "lead.erase", entityType: "lead", entityId: "l1" }),
          a({ id: "y", action: "lead.erase", entityType: "lead", entityId: "l2" }),
        ],
        r,
      ).map((x) => x.id),
    ).toEqual(["x"]);
  });
});

describe("Export sent (Q2 A): the day emailed, never in the future", () => {
  it("the start of that IST day, now for today, refused tomorrow", () => {
    const now = T0;
    expect(exportSentAtOf("2026-11-01", now)).toBe(fromIst({ year: 2026, month: 11, day: 1 }));
    expect(exportSentAtOf("2026-11-02", now)).toBe(fromIst({ year: 2026, month: 11, day: 2 }));
    expect(exportSentAtOf("2026-11-03", now)).toBe("future");
    expect(exportSentAtOf("", now)).toBeNull();
  });
});

describe("Log a request: the checks before the API (C.2, L22, L28)", () => {
  const base: LogForm = {
    kind: "data_access",
    channel: "email",
    receivedOn: "2026-11-01",
    subject: "email",
    picked: null,
    email: " Person@Example.test ",
    details: "",
  };
  it("an address, a contact, a lead or a client as the one subject, the address lower-cased", () => {
    expect(logBodyOf(base, T0)).toEqual({
      body: {
        kind: "data_access",
        channel: "email",
        receivedOn: "2026-11-01",
        details: null,
        requesterEmail: "person@example.test",
      },
    });
    const pick = (type: "contact" | "lead" | "client") => ({
      ...base,
      subject: type,
      picked: { type, id: "x1", title: "t", sub: "s" },
    });
    expect(logBodyOf(pick("contact"), T0)).toMatchObject({ body: { contactId: "x1" } });
    expect(logBodyOf(pick("lead"), T0)).toMatchObject({ body: { leadId: "x1" } });
    expect(logBodyOf(pick("client"), T0)).toMatchObject({ body: { clientId: "x1" } });
  });
  it("each missing piece on its own field; a future day; an erasure against a client as a whole; details where the kind needs them", () => {
    expect(logBodyOf({ ...base, kind: "", channel: "", subject: "" }, T0)).toEqual({
      errors: { kind: ZR_LOG.kindMissing, channel: ZR_LOG.channelMissing, subject: ZR_LOG.whoMissing },
    });
    expect(logBodyOf({ ...base, receivedOn: "2026-11-03" }, T0)).toEqual({
      errors: { receivedOn: ZR_LOG.receivedFuture },
    });
    expect(logBodyOf({ ...base, email: "not-an-address" }, T0)).toEqual({
      errors: { email: ZR_LOG.emailInvalid },
    });
    expect(logBodyOf({ ...base, subject: "contact" }, T0)).toEqual({ errors: { find: ZR_LOG.pickMissing } });
    expect(
      logBodyOf(
        {
          ...base,
          kind: "data_erasure",
          subject: "client",
          picked: { type: "client", id: "c", title: "t", sub: "s" },
        },
        T0,
      ),
    ).toEqual({ errors: { subject: ZR_LOG.erasureWholeClient } });
    expect(logBodyOf({ ...base, kind: "grievance" }, T0)).toEqual({
      errors: { details: ZR_LOG.detailsMissing },
    });
    expect(logBodyOf({ ...base, details: "x".repeat(1001) }, T0)).toEqual({
      errors: { details: ZR_LOG.detailsTooLong },
    });
    // unreadable date text blocks the log (the field says so itself)
    expect("errors" in logBodyOf(base, T0, true)).toBe(true);
  });
  it("refusals worded from their codes; the contact's client from a search link", () => {
    expect(logErrorText(new RequestError(409, "lead_converted", "x"))).toBe(ZR_LOG.refused.lead_converted);
    expect(logErrorText(new RequestError(409, "request_open", "x"))).toBe(ZR_LOG.refused.request_open);
    expect(logErrorText(new RequestError(404, "not_found", "x"))).toBe(ZR_LOG.refused.not_found);
    expect(clientIdOfLink("/clients/abc?tab=contacts")).toBe("abc");
    expect(clientIdOfLink("/leads/abc")).toBeUndefined();
  });
});

describe("a lead erase refused as too_many_leads names the enquiries (review low 11) [ADM-CLI-05]", () => {
  it("the sentence stays; the refs come only from that refusal's details, as a list of strings", () => {
    const refs = ["L-0A1B2", "L-0A1B3"];
    const tooMany = new RequestError(409, "too_many_leads", "x", null, [], [], [], { details: { refs } });
    expect(eraseRefusal(tooMany)).toBe(
      "This person has too many enquiries to erase at once. Ask your developer to help.",
    );
    expect(tooManyRefs(tooMany)).toEqual(refs);
    // no refs sent: the sentence alone
    expect(tooManyRefs(new RequestError(409, "too_many_leads", "x"))).toEqual([]);
    // another refusal never lists anything, and a scalar under `refs` is not a list
    expect(
      tooManyRefs(new RequestError(409, "legal_hold", "x", null, [], [], [], { details: { refs } })),
    ).toEqual([]);
    expect(
      tooManyRefs(
        new RequestError(409, "too_many_leads", "x", null, [], [], [], { details: { refs: "L-0A1B2" } }),
      ),
    ).toEqual([]);
    expect(tooManyRefs(new Error("x"))).toEqual([]);
    expect(ZR_LEAD.tooManyRefs(50)).toBe("50 of their enquiries:");
    expect(ZR_LEAD.tooManyRefs(1)).toBe("1 of their enquiries:");
  });
});

describe("the clean-up's bells land on the report (G.6)", () => {
  it("report ready, done with holds, stuck deletions; anything else as written", () => {
    for (const k of ["retention.report_ready", "retention.done_with_holds", "r2.stuck", "job.failed"])
      expect(reportBellHref(k, "/settings/retention")).toBe("/settings/retention#dp-report");
    expect(reportBellHref("request.overdue", "/requests?id=x")).toBe("/requests?id=x");
  });
});
