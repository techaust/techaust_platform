// M7.2 staff notification emails in core [ADM-G-09; run file B, I "Core", L9, L11; Q1 A, Q2 A]: the emailed bell kinds and their groups, the switches with
// their defaults per role, and the `staff.notify` message (ids only; extra keys refused).
import { describe, expect, it } from "vitest";
import {
  EMAILED_BELLS,
  isEmailedBell,
  isStaffNotifyKind,
  PREF_DEFAULTS,
  PREF_GROUPS,
  prefsOf,
  staffNotify,
  staffNotifyMessage,
  wantsEmail,
} from "../src/notifications.ts";

describe("emailed bells", () => {
  it("maps each emailed kind to its group (Q1 A, Q2 A)", () => {
    expect(EMAILED_BELLS).toEqual({
      "offer.viewed": "offerViewed",
      "payment.online": "paymentReceived",
      "payment.verify": "approvals",
      "payment.review": "hookFailed",
      "payment.hook_signature": "hookFailed",
      "email.hook_token": "hookFailed",
    });
    for (const g of Object.values(EMAILED_BELLS)) expect(PREF_GROUPS).toContain(g);
    expect(isEmailedBell("payment.online")).toBe(true);
    expect(isEmailedBell("email.bounced")).toBe(false);
    expect(isEmailedBell("toString")).toBe(false);
    expect(isEmailedBell(3)).toBe(false);
  });
});

describe("prefsOf", () => {
  it("a missing row reads as the defaults; the digest only for an owner", () => {
    expect(prefsOf(null, "owner")).toEqual({
      digestWeekly: true,
      offerViewed: false,
      paymentReceived: true,
      approvals: true,
      hookFailed: true,
    });
    for (const role of ["staff", "sales", "accountant"])
      expect(prefsOf(null, role)).toEqual({ ...prefsOf(null, "owner"), digestWeekly: false });
  });

  it("reads the row's switches; a non-owner's digest stays off whatever the row says", () => {
    const row = { ...PREF_DEFAULTS, digest_weekly: 0, email_offer_viewed: 1, email_hook_failed: 0 };
    expect(prefsOf(row, "owner")).toEqual({
      digestWeekly: false,
      offerViewed: true,
      paymentReceived: true,
      approvals: true,
      hookFailed: false,
    });
    expect(prefsOf({ ...PREF_DEFAULTS, digest_weekly: 1 }, "staff").digestWeekly).toBe(false);
  });

  it("wantsEmail: only emailed kinds, by the member's group switch", () => {
    const p = prefsOf({ ...PREF_DEFAULTS, email_approvals: 0 }, "owner");
    expect(wantsEmail(p, "payment.online")).toBe(true);
    expect(wantsEmail(p, "payment.verify")).toBe(false);
    expect(wantsEmail(p, "offer.viewed")).toBe(false);
    expect(wantsEmail(prefsOf({ ...PREF_DEFAULTS, email_offer_viewed: 1 }, "staff"), "offer.viewed")).toBe(
      true,
    );
    expect(wantsEmail(p, "email.bounced")).toBe(false);
  });
});

describe("staff.notify", () => {
  it("carries the bell kind and the entity id only; extra keys, unknown kinds and bad ids are refused", () => {
    const m = staffNotify("email.hook_token", "ses:1800000000000");
    expect(m).toEqual({ kind: "staff.notify", bell: "email.hook_token", entityId: "ses:1800000000000" });
    expect(staffNotifyMessage.safeParse(m).success).toBe(true);
    expect(staffNotifyMessage.safeParse({ ...m, to: "a@example.test" }).success).toBe(false);
    expect(staffNotifyMessage.safeParse({ ...m, title: "x" }).success).toBe(false);
    expect(staffNotifyMessage.safeParse({ ...m, bell: "email.bounced" }).success).toBe(false);
    expect(staffNotifyMessage.safeParse({ ...m, entityId: "" }).success).toBe(false);
    expect(staffNotifyMessage.safeParse({ ...m, entityId: "x".repeat(129) }).success).toBe(false);
    expect(staffNotifyMessage.safeParse({ ...m, kind: "staff.alert" }).success).toBe(false);
    expect(isStaffNotifyKind(m)).toBe(true);
    expect(isStaffNotifyKind({ kind: "staff.alert" })).toBe(false);
    expect(isStaffNotifyKind(null)).toBe(false);
  });
});
