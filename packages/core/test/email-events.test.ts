// M7.2 SES events in core [ADM-MAIL-02, JOB-HOOK-01..03; run file I "Core"]: the envelope parser on the recorded shapes (the SES Developer Guide's EventBridge
// envelope and its event-publishing bounce record), every refusal, the rank and move rules, the suppression rule and the disposition. Addresses and ids are made up.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  EMAIL_EVENT_RANK,
  emailEventMove,
  holdsUnknown,
  nextEmailStatus,
  parseSesEvent,
  recipientsOfEvent,
  SES_BELLS,
  SES_HANDLED,
  SES_RECIPIENTS_MAX,
  SES_UNKNOWN_HOLD_MS,
  type SesEvent,
  SUPPRESSION_REASON_LABELS,
  SUPPRESSION_REASON_OTHER,
  sesEventDisposition,
  suppressionOf,
  suppressionReasonLabel,
} from "../src/email-events.ts";

const MESSAGE_ID = "0109019a2b3c4d5e-11112222-3333-4444-5555-666677778888-000000";

/** The EventBridge envelope as the SES Developer Guide shows it (its `Email Rendering Failed` example), with a detail for `kind`. */
function envelope(kind: "delivery" | "bounce" | "complaint" | "send", over: Record<string, unknown> = {}) {
  const detailType = {
    delivery: "Email Delivered",
    bounce: "Email Bounced",
    complaint: "Email Complaint Received",
    send: "Email Sent",
  }[kind];
  const eventType = { delivery: "Delivery", bounce: "Bounce", complaint: "Complaint", send: "Send" }[kind];
  const mail = {
    timestamp: "2026-11-05T04:40:02.012Z",
    source: "TecHaust <no-reply@example.test>",
    sendingAccountId: "123456789012",
    messageId: MESSAGE_ID,
    destination: ["asha@example.test"],
    headersTruncated: false,
    tags: { "ses:configuration-set": ["techaust-transactional"], env: ["staging"] },
  };
  const detail: Record<string, unknown> = { eventType, mail };
  if (kind === "delivery")
    detail.delivery = { timestamp: "2026-11-05T04:40:03.000Z", recipients: ["asha@example.test"] };
  if (kind === "bounce")
    detail.bounce = {
      bounceType: "Permanent",
      bounceSubType: "General",
      bouncedRecipients: [
        {
          emailAddress: "Asha@Example.test",
          action: "failed",
          status: "5.1.1",
          diagnosticCode: "smtp; 550 5.1.1 user unknown",
        },
      ],
      timestamp: "2026-11-05T04:41:02.669Z",
      feedbackId: "01000157c44f053b-61b59c11-9236-11e6-8f96-7be8aexample-000000",
    };
  if (kind === "complaint")
    detail.complaint = {
      complainedRecipients: [{ emailAddress: "asha@example.test" }],
      complaintFeedbackType: "abuse",
    };
  return {
    version: "0",
    id: "12a18625-3328-fafd-2809-a5e16004f112",
    "detail-type": detailType,
    source: "aws.ses",
    account: "123456789012",
    time: "2026-11-05T04:41:05Z",
    region: "ap-south-1",
    resources: ["arn:aws:ses:ap-south-1:123456789012:identity/example.test"],
    detail,
    ...over,
  };
}

const ok = (obj: unknown): SesEvent => {
  const r = parseSesEvent(obj);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.value;
};
const reason = (obj: unknown) => {
  const r = parseSesEvent(obj);
  return r.ok ? "ok" : r.reason;
};
// biome-ignore lint/suspicious/noExplicitAny: a test mutates arbitrary parts of the recorded envelope
type J = Record<string, any>;
const withDetail = (kind: Parameters<typeof envelope>[0], edit: (d: J) => void) => {
  const e = envelope(kind) as J;
  edit(e.detail);
  return e;
};

describe("parseSesEvent on the recorded shapes", () => {
  it("a delivery: id, source, message id and the env tag; nothing else kept", () => {
    expect(ok(envelope("delivery"))).toEqual({
      eventId: "12a18625-3328-fafd-2809-a5e16004f112",
      source: "aws.ses",
      type: "delivery",
      messageId: MESSAGE_ID,
      env: "staging",
      timeMs: Date.parse("2026-11-05T04:41:05Z"),
    });
  });

  it("finding 3: the envelope time is read as ms (null when absent, unreadable or over-long); holdsUnknown holds within 15 minutes either side", () => {
    const at = Date.parse("2026-11-05T04:41:05Z");
    const withTime = (time: unknown) => {
      const e = envelope("delivery") as Record<string, unknown>;
      if (time === undefined) delete e.time;
      else e.time = time;
      return ok(e);
    };
    expect(withTime(undefined).timeMs).toBeNull();
    expect(withTime("not a date").timeMs).toBeNull();
    expect(withTime(12345).timeMs).toBeNull();
    expect(withTime(`2026-11-05T04:41:05Z${" ".repeat(40)}`).timeMs).toBeNull();
    const ev = withTime("2026-11-05T04:41:05Z");
    expect(holdsUnknown(ev, at + SES_UNKNOWN_HOLD_MS - 1)).toBe(true);
    expect(holdsUnknown(ev, at - SES_UNKNOWN_HOLD_MS + 1)).toBe(true);
    expect(holdsUnknown(ev, at + SES_UNKNOWN_HOLD_MS)).toBe(false);
    expect(holdsUnknown({ timeMs: null }, at)).toBe(false);
    expect(holdsUnknown({}, at)).toBe(false);
  });

  it("finding 7: the suppression reasons have labels and anything else (an old 'bounce') a generic one", () => {
    expect(suppressionReasonLabel("hard_bounce")).toBe(SUPPRESSION_REASON_LABELS.hard_bounce);
    expect(suppressionReasonLabel("complaint")).toBe(SUPPRESSION_REASON_LABELS.complaint);
    expect(suppressionReasonLabel("manual")).toBe(SUPPRESSION_REASON_LABELS.manual);
    for (const r of ["bounce", "", null, undefined, "toString", "__proto__"])
      expect(suppressionReasonLabel(r)).toBe(SUPPRESSION_REASON_OTHER);
  });

  it("a bounce: kind, sub-type and the recipients lower-cased; no diagnostic code, status or feedback id", () => {
    const ev = ok(envelope("bounce"));
    expect(ev.bounce).toEqual({ kind: "permanent", subType: "General", recipients: ["asha@example.test"] });
    expect(JSON.stringify(ev)).not.toMatch(/diagnostic|550|feedback|5\.1\.1/);
    for (const [ses, kind] of [
      ["Transient", "transient"],
      ["Undetermined", "undetermined"],
    ] as const)
      expect(ok(withDetail("bounce", (d) => (d.bounce.bounceType = ses))).bounce?.kind).toBe(kind);
    expect(
      ok(withDetail("bounce", (d) => (d.bounce.bounceSubType = "OnAccountSuppressionList"))).bounce?.subType,
    ).toBe("OnAccountSuppressionList");
    expect(ok(withDetail("bounce", (d) => delete d.bounce.bounceSubType)).bounce?.subType).toBeNull();
  });

  it("a complaint: its recipients, de-duplicated", () => {
    const ev = ok(
      withDetail("complaint", (d) => {
        d.complaint.complainedRecipients = [
          { emailAddress: "a@example.test" },
          { emailAddress: "A@example.test" },
        ];
      }),
    );
    expect(ev.complaint).toEqual({ recipients: ["a@example.test"] });
    expect(recipientsOfEvent(ev)).toEqual(["a@example.test"]);
    expect(recipientsOfEvent(ok(envelope("delivery")))).toEqual([]);
  });

  it("an event type we don't handle is `other`, read for its ids only", () => {
    expect(ok(envelope("send"))).toMatchObject({ type: "other", messageId: MESSAGE_ID });
    expect(
      ok({
        ...envelope("send"),
        "detail-type": "Email Opened",
        detail: { eventType: "Open", mail: { messageId: "m1" } },
      }).type,
    ).toBe("other");
  });

  it("the env tag is read only as one plain value", () => {
    const tags = (v: unknown) =>
      ok(withDetail("delivery", (d) => (d.mail.tags = v === undefined ? undefined : { env: v }))).env;
    expect(tags(undefined)).toBeNull();
    expect(tags(["staging", "production"])).toBeNull();
    expect(tags([])).toBeNull();
    expect(tags(["stag ing"])).toBeNull();
    expect(tags("staging")).toBeNull();
    expect(tags([1])).toBeNull();
    expect(tags(["production"])).toBe("production");
    expect(ok(withDetail("delivery", (d) => (d.mail.tags = "x"))).env).toBeNull();
  });
});

describe("parseSesEvent refuses what it does not know", () => {
  it("the envelope", () => {
    expect(reason(null)).toBe("not_object");
    expect(reason([])).toBe("not_object");
    expect(reason("x")).toBe("not_object");
    expect(reason({ ...envelope("delivery"), id: undefined })).toBe("event_id");
    expect(reason({ ...envelope("delivery"), id: "" })).toBe("event_id");
    expect(reason({ ...envelope("delivery"), id: "x".repeat(129) })).toBe("event_id");
    expect(reason({ ...envelope("delivery"), id: "has space" })).toBe("event_id");
    expect(reason({ ...envelope("delivery"), id: 7 })).toBe("event_id");
    expect(reason({ ...envelope("delivery"), source: "" })).toBe("source");
    expect(reason({ ...envelope("delivery"), source: 1 })).toBe("source");
    expect(reason({ ...envelope("delivery"), source: "s".repeat(65) })).toBe("source");
    expect(reason({ ...envelope("delivery"), "detail-type": 3 })).toBe("detail_type");
    expect(reason({ ...envelope("delivery"), "detail-type": "" })).toBe("detail_type");
    expect(reason({ ...envelope("delivery"), "detail-type": "d".repeat(129) })).toBe("detail_type");
    expect(reason({ ...envelope("delivery"), detail: [] })).toBe("detail");
    expect(reason({ ...envelope("delivery"), detail: "x" })).toBe("detail");
  });

  it("the detail: event type, mail, message id", () => {
    expect(reason(withDetail("delivery", (d) => delete d.eventType))).toBe("event_type");
    expect(reason(withDetail("delivery", (d) => (d.eventType = "")))).toBe("event_type");
    expect(reason(withDetail("delivery", (d) => (d.eventType = "e".repeat(65))))).toBe("event_type");
    expect(reason(withDetail("delivery", (d) => delete d.mail))).toBe("detail");
    expect(reason(withDetail("delivery", (d) => delete d.mail.messageId))).toBe("message_id");
    expect(reason(withDetail("delivery", (d) => (d.mail.messageId = "")))).toBe("message_id");
    expect(reason(withDetail("delivery", (d) => (d.mail.messageId = "m".repeat(129))))).toBe("message_id");
    expect(reason(withDetail("delivery", (d) => (d.mail.messageId = "has space")))).toBe("message_id");
    expect(reason(withDetail("delivery", (d) => (d.mail.messageId = 12)))).toBe("message_id");
  });

  it("a detail-type and an eventType that disagree (an unconfirmed shape is never read as another)", () => {
    expect(reason(withDetail("delivery", (d) => (d.eventType = "Bounce")))).toBe("type_mismatch");
    expect(reason({ ...envelope("bounce"), "detail-type": "Email Something" })).toBe("type_mismatch");
    for (const [detailType, h] of Object.entries(SES_HANDLED))
      expect(
        reason({
          ...envelope("delivery"),
          "detail-type": detailType,
          detail: { eventType: `${h.eventType}x`, mail: { messageId: "m" } },
        }),
      ).toBe("type_mismatch");
  });

  it("a bounce without a known type, a bad sub-type, or a bad recipient list", () => {
    expect(reason(withDetail("bounce", (d) => delete d.bounce))).toBe("bounce");
    expect(reason(withDetail("bounce", (d) => (d.bounce.bounceType = "Hard")))).toBe("bounce");
    expect(reason(withDetail("bounce", (d) => (d.bounce.bounceType = 1)))).toBe("bounce");
    expect(reason(withDetail("bounce", (d) => (d.bounce.bounceType = "toString")))).toBe("bounce");
    expect(reason(withDetail("bounce", (d) => (d.bounce.bounceSubType = 4)))).toBe("bounce");
    expect(reason(withDetail("bounce", (d) => (d.bounce.bounceSubType = "x".repeat(65))))).toBe("bounce");
    expect(reason(withDetail("bounce", (d) => (d.bounce.bounceSubType = "a;b")))).toBe("bounce");
    expect(reason(withDetail("bounce", (d) => delete d.bounce.bouncedRecipients))).toBe("recipients");
    expect(reason(withDetail("bounce", (d) => (d.bounce.bouncedRecipients = [{ emailAddress: 5 }])))).toBe(
      "recipients",
    );
    expect(reason(withDetail("bounce", (d) => (d.bounce.bouncedRecipients = ["a@example.test"])))).toBe(
      "recipients",
    );
  });

  it("more than 50 recipients is refused; 50 is taken; an address that is not an address is skipped", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ emailAddress: `p${i}@example.test` }));
    expect(
      reason(withDetail("bounce", (d) => (d.bounce.bouncedRecipients = many(SES_RECIPIENTS_MAX + 1)))),
    ).toBe("recipients");
    expect(reason(withDetail("complaint", (d) => (d.complaint.complainedRecipients = many(51))))).toBe(
      "recipients",
    );
    expect(
      ok(withDetail("bounce", (d) => (d.bounce.bouncedRecipients = many(50)))).bounce?.recipients,
    ).toHaveLength(50);
    const odd = ok(
      withDetail("bounce", (d) => {
        d.bounce.bouncedRecipients = [
          { emailAddress: "not an address" },
          { emailAddress: "a@b@c" },
          { emailAddress: "x<y>@example.test" },
          { emailAddress: `${"a".repeat(250)}@example.test` },
          { emailAddress: "ok@example.test" },
        ];
      }),
    );
    expect(odd.bounce?.recipients).toEqual(["ok@example.test"]);
    expect(ok(withDetail("bounce", (d) => (d.bounce.bouncedRecipients = []))).bounce?.recipients).toEqual([]);
  });

  it("a complaint without its object or list", () => {
    expect(reason(withDetail("complaint", (d) => delete d.complaint))).toBe("complaint");
    expect(reason(withDetail("complaint", (d) => (d.complaint.complainedRecipients = "x")))).toBe(
      "recipients",
    );
  });

  it("never throws, whatever the input", () => {
    fc.assert(
      fc.property(fc.anything(), (v) => {
        const r = parseSesEvent(v);
        expect(typeof r.ok).toBe("boolean");
      }),
    );
  });
});

describe("disposition", () => {
  it("wrong source, a missing tag or another env is wrong_env; other types ignored_type; else apply", () => {
    const d = ok(envelope("delivery"));
    expect(sesEventDisposition(d, "staging")).toBe("apply");
    expect(sesEventDisposition(d, "production")).toBe("wrong_env");
    expect(sesEventDisposition({ ...d, env: null }, "staging")).toBe("wrong_env");
    expect(sesEventDisposition({ ...d, source: "aws.sesx" }, "staging")).toBe("wrong_env");
    expect(sesEventDisposition(ok(envelope("send")), "staging")).toBe("ignored_type");
    expect(sesEventDisposition({ ...ok(envelope("send")), env: "local" }, "staging")).toBe("wrong_env");
  });
});

describe("rank, next status and the move", () => {
  const STATUSES = ["queued", "sending", "sent", "delivered", "bounced", "complained", "failed", "skipped"];
  it("the rank is sent < delivered < bounced < complained", () => {
    expect(EMAIL_EVENT_RANK).toEqual({ sent: 1, delivered: 2, bounced: 3, complained: 4 });
  });

  it("only a sent row moves, and only up", () => {
    expect(nextEmailStatus("sent", "delivery")).toBe("delivered");
    expect(nextEmailStatus("delivered", "bounce")).toBe("bounced");
    expect(nextEmailStatus("bounced", "complaint")).toBe("complained");
    expect(nextEmailStatus("bounced", "delivery")).toBeNull();
    expect(nextEmailStatus("complained", "bounce")).toBeNull();
    expect(nextEmailStatus("delivered", "delivery")).toBeNull();
    for (const s of ["queued", "sending", "failed", "skipped", "nonsense"])
      for (const t of ["delivery", "bounce", "complaint"] as const) expect(nextEmailStatus(s, t)).toBeNull();
    for (const s of STATUSES) expect(nextEmailStatus(s, "other")).toBeNull();
  });

  it("a Permanent bounce after a softer one on a bounced row is applied; everything else follows the rank", () => {
    expect(
      emailEventMove(
        { status: "bounced", bounceType: "transient" },
        { type: "bounce", bounceKind: "permanent" },
      ),
    ).toBe("applied");
    expect(
      emailEventMove({ status: "bounced", bounceType: null }, { type: "bounce", bounceKind: "permanent" }),
    ).toBe("applied");
    expect(
      emailEventMove(
        { status: "bounced", bounceType: "permanent" },
        { type: "bounce", bounceKind: "permanent" },
      ),
    ).toBe("stale");
    expect(
      emailEventMove(
        { status: "bounced", bounceType: "transient" },
        { type: "bounce", bounceKind: "transient" },
      ),
    ).toBe("stale");
    expect(
      emailEventMove({ status: "complained", bounceType: null }, { type: "bounce", bounceKind: "permanent" }),
    ).toBe("stale");
    expect(emailEventMove({ status: "sent", bounceType: null }, { type: "delivery" })).toBe("applied");
    expect(emailEventMove({ status: "delivered", bounceType: null }, { type: "delivery" })).toBe("stale");
  });
});

describe("suppression", () => {
  it("only a Permanent bounce and a complaint suppress", () => {
    const b = (kind: "permanent" | "transient" | "undetermined") =>
      suppressionOf({ type: "bounce", bounce: { kind, subType: null, recipients: [] } });
    expect(b("permanent")).toBe("hard_bounce");
    expect(b("transient")).toBeNull();
    expect(b("undetermined")).toBeNull();
    expect(suppressionOf({ type: "complaint" })).toBe("complaint");
    expect(suppressionOf({ type: "delivery" })).toBeNull();
    expect(suppressionOf({ type: "other" })).toBeNull();
    expect(suppressionOf({ type: "bounce" })).toBeNull();
  });

  it("the bell lines name a client code, never an address", () => {
    expect(SES_BELLS["email.bounced"]).toContain("{client_code}");
    expect(SES_BELLS["email.complaint"]).toContain("{client_code}");
    expect(Object.values(SES_BELLS).join(" ")).not.toMatch(/@|&/);
  });
});
