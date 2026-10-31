// Polish sweep 4 and 3a [ADM-G-09, ADM-AUTH-08]: the bell's name says what its badge shows (WCAG 2.5.3 Label in Name; axe
// `label-content-name-mismatch` with 10 or more unread), and one test tells a wrong step-up code from any other refusal.
import { describe, expect, it } from "vitest";
import { RequestError } from "../../api.ts";
import { BELL_OVER_NINE } from "../../lib/copy-zl.ts";
import { isWrongCode } from "../../lib/step-up.ts";
import { bellName } from "./top-menus.tsx";

/** What the badge shows (top-menus.tsx): nothing, the count, or "9+". */
const badge = (unread: number) => (unread > 9 ? "9+" : unread > 0 ? String(unread) : "");

describe("the bell's name", () => {
  it("is plain with nothing unread, and says the exact count up to 9", () => {
    expect(bellName(0)).toBe("Notifications");
    expect(bellName(1)).toBe("Notifications, 1 unread");
    expect(bellName(9)).toBe("Notifications, 9 unread");
  });

  it('says "9+" over 9, as the badge does (07-ZL line 3)', () => {
    for (const n of [10, 11, 50, 1000]) expect(bellName(n)).toBe(BELL_OVER_NINE);
    expect(BELL_OVER_NINE).toContain("Notifications, 9+ unread");
  });

  it("always contains what the badge shows", () => {
    for (const n of [0, 1, 5, 9, 10, 99, 12345]) expect(bellName(n)).toContain(badge(n));
  });
});

describe("isWrongCode", () => {
  it("is true only for invalid_code", () => {
    expect(isWrongCode(new RequestError(400, "invalid_code", "That code didn't work.", null))).toBe(true);
    expect(isWrongCode(new RequestError(429, "locked", "Locked.", null))).toBe(false);
    expect(isWrongCode(new RequestError(409, "issue_blocked", "Blocked.", null))).toBe(false);
    expect(isWrongCode(new Error("invalid_code"))).toBe(false);
    expect(isWrongCode({ code: "invalid_code" })).toBe(false);
    expect(isWrongCode(null)).toBe(false);
  });
});
