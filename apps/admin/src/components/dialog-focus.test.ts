// The dialog's focus rule [WCAG 2.4.3; M6.2 review finding 1]: a dialog ended by Escape or Cancel, including one its screen unmounts while it is still
// open (`{x && <Modal open …>}`), is closed and hands focus back to its opener. The pool has no DOM, so the rule is tested on stand-ins, and `Modal` is
// checked to run it on unmount as well as on `open` going false.
import { describe, expect, it } from "vitest";
import modalSource from "./dialog.tsx?raw";
import { endDialog } from "./dialog-focus.ts";

function stage(o: { open?: boolean; connected?: boolean } = {}) {
  const log: string[] = [];
  const dialog = {
    open: o.open ?? true,
    close() {
      log.push("close");
      this.open = false;
    },
  };
  const opener = { isConnected: o.connected ?? true, focus: () => log.push("focus opener") };
  return { dialog, opener, log };
}

describe("endDialog", () => {
  it("Escape or Cancel on a dialog still open (its screen unmounting it): closed, then focus on the opener", () => {
    const s = stage();
    expect(endDialog(s.dialog, s.opener)).toBe(true);
    expect(s.log).toEqual(["close", "focus opener"]);
    expect(s.dialog.open).toBe(false);
  });

  it("a dialog already closed is not closed twice; focus still goes back", () => {
    const s = stage({ open: false });
    expect(endDialog(s.dialog, s.opener)).toBe(true);
    expect(s.log).toEqual(["focus opener"]);
  });

  it("an opener no longer on the page (the row went away) takes no focus", () => {
    const s = stage({ connected: false });
    expect(endDialog(s.dialog, s.opener)).toBe(false);
    expect(s.log).toEqual(["close"]);
    expect(endDialog(null, null)).toBe(false);
    expect(endDialog(s.dialog, {})).toBe(false);
  });
});

describe("Modal", () => {
  it("ends the dialog both when `open` goes false and when it unmounts while shown", () => {
    // Two calls: the `open` effect's close branch and the unmount cleanup (guarded by `shown`).
    expect(modalSource.match(/endDialog\(d, opener\.current/g)?.length).toBe(2);
    expect(modalSource).toMatch(/return \(\) => \{\s*if \(!shown\.current\) return;/);
    expect(modalSource).toMatch(/useEffect\(\(\) => \{\s*const d = ref\.current;\s*return \(\) =>/);
  });
});
