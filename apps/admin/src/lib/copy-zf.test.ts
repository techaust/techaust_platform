// 07-ZF (ADM-INV-10): every staff line the screens show, word for word with docs/07-content-appendix/ZF-proforma-withdraw.md (read here, so a change to
// the page that isn't made in the code fails), and the "[Placeholder] " mark until APPROVED_07ZF.
import { describe, expect, it } from "vitest";
import zfPage from "../../../../docs/07-content-appendix/ZF-proforma-withdraw.md?raw";
import { RequestError } from "../api.ts";
import { ACTION_LABELS } from "./audit.ts";
import { VOID_VIEWED_COPY } from "./copy-z.ts";
import {
  APPROVED_07ZF,
  PLACEHOLDER_MARK,
  PROFORMA_LOCKED_END,
  VOID_DELIVERED_PROFORMA,
  WITHDRAW_COPY,
  WITHDRAW_ERRORS,
  ZF,
} from "./copy-zf.ts";
import { proformaLockedLine } from "./invoice-types.ts";
import {
  BADGE_LABELS,
  BADGE_PILLS,
  BADGES,
  badgeOf,
  frozenBanner,
  voidBlockedText,
  voidErrorText,
  withdrawErrorText,
} from "./invoices.ts";

const mark = APPROVED_07ZF ? "" : `${PLACEHOLDER_MARK} `;

/** The quoted words of 07-ZF's numbered line `n`, in order ("{braces}" kept as written). */
function quoted(n: number): string[] {
  const line = zfPage.split("\n").find((l) => l.startsWith(`${n}. `));
  if (!line) throw new Error(`07-ZF has no line ${n}`);
  return [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}
/** The one quoted line of 07-ZF's line `n`. */
const only = (n: number): string => {
  const q = quoted(n);
  expect(q).toHaveLength(1);
  return q[0] as string;
};

describe("07-ZF staff lines [ADM-INV-10]", () => {
  it("are approved (owner, 2026-10-31): no mark", () => {
    expect(zfPage).toContain("APPROVED by the owner, 2026-10-31");
    expect(APPROVED_07ZF).toBe(true);
    expect(ZF("Line.")).toBe(`${mark}Line.`);
  });

  it("1 to 9: the action, the dialog, the toast, the banner, the badge and the audit line", () => {
    expect(WITHDRAW_COPY.button).toBe(`${mark}${only(1)}`);
    expect(WITHDRAW_COPY.title("{number}")).toBe(`${mark}${only(2)}`);
    expect(WITHDRAW_COPY.body).toBe(`${mark}${only(3)}`);
    // line 4: 07-ZA line 18's label, then the empty reason's line
    expect(quoted(4)).toEqual([
      "Reason (required, kept with the proforma)",
      "Enter a reason for withdrawing.",
    ]);
    expect(WITHDRAW_COPY.reasonLabel).toBe(`${mark}${quoted(4)[0]}`);
    expect(WITHDRAW_COPY.reasonEmpty).toBe(`${mark}${quoted(4)[1]}`);
    expect(WITHDRAW_COPY.confirm).toBe(`${mark}${only(5)}`);
    expect(WITHDRAW_COPY.toast("{number}")).toBe(`${mark}${only(6)}`);
    expect(WITHDRAW_COPY.banner("{date}", "{name}", "{reason}")).toBe(`${mark}${only(7)}`);
    expect(WITHDRAW_COPY.badge).toBe(`${mark}${only(8)}`);
    expect(WITHDRAW_COPY.audit).toBe(`${mark}${only(9)}`);
    expect(ACTION_LABELS["invoice.withdraw"]).toBe(WITHDRAW_COPY.audit);
  });

  it("7: a reason that ends its own sentence is not given a second full stop", () => {
    expect(WITHDRAW_COPY.banner("31 Oct 2026", "Asha (fake)", "Wrong amount")).toBe(
      `${mark}Withdrawn 31 Oct 2026 by Asha (fake): Wrong amount. The client sees it as withdrawn in the portal.`,
    );
    expect(WITHDRAW_COPY.banner("31 Oct 2026", "Asha (fake)", "Wrong amount.")).toBe(
      `${mark}Withdrawn 31 Oct 2026 by Asha (fake): Wrong amount. The client sees it as withdrawn in the portal.`,
    );
    expect(WITHDRAW_COPY.banner("31 Oct 2026", "Asha (fake)", "Sent twice?")).toContain(
      "Sent twice? The client",
    );
  });

  it("10 to 14: a refused withdrawal, by the API's code", () => {
    expect(WITHDRAW_ERRORS.already_withdrawn).toBe(`${mark}${only(10)}`);
    expect(WITHDRAW_ERRORS.proforma_paid).toBe(`${mark}${only(11)}`);
    expect(WITHDRAW_ERRORS.proforma_converted).toBe(`${mark}${only(12)}`);
    expect(WITHDRAW_ERRORS.not_delivered).toBe(`${mark}${only(13)}`);
    for (const code of ["not_proforma", "withdraw_proforma_only", "already_void", "not_issued"] as const)
      expect(WITHDRAW_ERRORS[code]).toBe(`${mark}${only(14)}`);
    expect(withdrawErrorText(new RequestError(409, "proforma_paid", "x"))).toBe(
      WITHDRAW_ERRORS.proforma_paid,
    );
    expect(withdrawErrorText(new RequestError(409, "not_delivered", "x"))).toBe(
      WITHDRAW_ERRORS.not_delivered,
    );
    // anything else keeps the invoice screens' sentence (stale, the step-up, the network)
    expect(withdrawErrorText(new RequestError(409, "stale_version", "x"))).toContain("Reload");
  });

  it("15 and 16: a proforma the client received can't be voided, and the line says to withdraw it", () => {
    expect(VOID_DELIVERED_PROFORMA.viewed).toBe(`${mark}${only(15)}`);
    expect(VOID_DELIVERED_PROFORMA.emailed).toBe(`${mark}${only(16)}`);
    expect(VOID_VIEWED_COPY.proforma).toBe(VOID_DELIVERED_PROFORMA.viewed);
    expect(voidBlockedText(["viewed_by_client"], "proforma")).toBe(VOID_DELIVERED_PROFORMA.viewed);
    expect(voidBlockedText(["already_emailed"], "proforma")).toBe(VOID_DELIVERED_PROFORMA.emailed);
    expect(voidBlockedText(["already_emailed", "viewed_by_client"], "proforma")).toBe(
      VOID_DELIVERED_PROFORMA.viewed,
    );
    // a payment or an invoice made from it is the stronger reason: no Withdraw advice
    expect(voidBlockedText(["has_payment", "already_emailed"], "proforma")).not.toContain("Withdraw");
    // the void route's 409 for an emailed proforma: `void_not_allowed` with every reason riding along
    const emailed = new RequestError(409, "void_not_allowed", "x", null, [], [], [], {
      reasons: ["already_emailed"],
    });
    expect(voidErrorText(emailed, "proforma")).toBe(VOID_DELIVERED_PROFORMA.emailed);
    const paid = new RequestError(409, "void_not_allowed", "x", null, [], [], [], {
      reasons: ["has_payment", "already_emailed"],
    });
    expect(voidErrorText(paid, "proforma")).not.toContain("Withdraw");
    expect(voidErrorText(new RequestError(409, "viewed_by_client", "x"), "proforma")).toBe(
      VOID_DELIVERED_PROFORMA.viewed,
    );
    // an invoice keeps its credit-note line
    expect(voidBlockedText(["viewed_by_client"], "tax_invoice")).toContain("credit note");
  });

  it("17: the end of the proforma's locked banner", () => {
    expect(PROFORMA_LOCKED_END).toBe(`${mark}${only(17)}`);
    expect(proformaLockedLine("27 Oct 2026", "Asha (fake)")).toBe(
      `Issued 27 Oct 2026 by Asha (fake). This proforma is locked. ${mark}${only(17)}`,
    );
    expect(frozenBanner("27 Oct 2026", "Asha (fake)", "proforma")).toBe(
      proformaLockedLine("27 Oct 2026", "Asha (fake)"),
    );
  });

  it("8: the Withdrawn badge is its own (archive icon, muted, not struck) and is not a list filter", () => {
    expect(BADGE_LABELS.withdrawn).toBe(WITHDRAW_COPY.badge);
    expect(BADGE_PILLS.withdrawn).toEqual({ tone: "muted", icon: "archive" });
    expect((BADGES as readonly string[]).includes("withdrawn")).toBe(false);
    expect(badgeOf({ status: "void", overdue: false, withdrawn: true })).toBe("withdrawn");
    expect(badgeOf({ status: "void", overdue: true, withdrawn: false })).toBe("void");
    expect(badgeOf({ status: "void", overdue: false })).toBe("void");
    // the flag means nothing on a live document
    expect(badgeOf({ status: "issued", overdue: false, withdrawn: true })).toBe("issued");
  });

  it("no line uses an arrow, an ampersand or the old void advice", () => {
    const all = [
      ...Object.values(WITHDRAW_COPY).map((w) => (typeof w === "function" ? w("{a}", "{b}", "{c}") : w)),
      ...Object.values(WITHDRAW_ERRORS),
      ...Object.values(VOID_DELIVERED_PROFORMA),
      PROFORMA_LOCKED_END,
    ];
    for (const line of all) {
      expect(line).not.toMatch(/[&→]/);
      expect(line).not.toContain("hasn't been emailed, opened by the client");
    }
  });
});
