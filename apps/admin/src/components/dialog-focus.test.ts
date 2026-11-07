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

// M7.5 (A1, M1.5 M2): the opener can't take the focus (disabled while its request waits, gone, or refusing it): the focus moves on to a fallback, never
// to <body>. `active` stands in for `document.activeElement`.
function page(
  o: {
    opener?: Partial<{ connected: boolean; disabled: boolean; refuses: boolean }>;
    under?: boolean;
    main?: boolean;
  } = {},
) {
  const log: string[] = [];
  let active: unknown = null;
  const el = (name: string, p: { connected?: boolean; disabled?: boolean; refuses?: boolean } = {}) => {
    const me = {
      isConnected: p.connected ?? true,
      disabled: p.disabled ?? false,
      focus(options?: FocusOptions) {
        log.push(`focus ${name}${options?.preventScroll ? " (no scroll)" : ""}`);
        if (!p.refuses) active = me;
      },
    };
    return me;
  };
  const dialog = {
    open: true,
    close() {
      log.push("close");
      this.open = false;
    },
  };
  const opener = el("opener", o.opener);
  const underTitle = o.under === false ? null : el("title of the dialog underneath");
  const main = o.main === false ? null : el("main");
  const fallback = {
    candidates: () => {
      log.push("candidates read");
      return [underTitle, main];
    },
    active: () => active,
  };
  return { dialog, opener, fallback, log, active: () => active, underTitle, main };
}

describe("endDialog's fallback (M1.5 M2)", () => {
  it("a step-up closing over a confirm dialog whose button is disabled while busy: the confirm dialog's title takes the focus", () => {
    const s = page({ opener: { disabled: true } });
    expect(endDialog(s.dialog, s.opener, s.fallback)).toBe(true);
    expect(s.log).toEqual(["close", "candidates read", "focus title of the dialog underneath (no scroll)"]);
    expect(s.active()).toBe(s.underTitle);
  });

  it("the opener's row went away and no dialog is underneath: the main landmark takes the focus", () => {
    const s = page({ opener: { connected: false }, under: false });
    expect(endDialog(s.dialog, s.opener, s.fallback)).toBe(true);
    expect(s.log).toEqual(["close", "candidates read", "focus main (no scroll)"]);
    expect(s.active()).toBe(s.main);
  });

  it("an opener that is called but doesn't take the focus counts as gone", () => {
    const s = page({ opener: { refuses: true } });
    expect(endDialog(s.dialog, s.opener, s.fallback)).toBe(true);
    expect(s.log).toEqual([
      "close",
      "focus opener",
      "candidates read",
      "focus title of the dialog underneath (no scroll)",
    ]);
  });

  it("an opener that can take it keeps the old rule: no fallback is read", () => {
    const s = page();
    expect(endDialog(s.dialog, s.opener, s.fallback)).toBe(true);
    expect(s.log).toEqual(["close", "focus opener"]);
    expect(s.active()).toBe(s.opener);
  });

  it("no opener (the focus was on <body> when it opened): straight to the fallback", () => {
    const s = page({ under: false });
    expect(endDialog(s.dialog, null, s.fallback)).toBe(true);
    expect(s.active()).toBe(s.main);
  });

  it("nothing can take the focus: false, and nothing is focused", () => {
    const s = page({ opener: { disabled: true }, under: false, main: false });
    expect(endDialog(s.dialog, s.opener, s.fallback)).toBe(false);
    expect(s.log).toEqual(["close", "candidates read"]);
    expect(s.active()).toBe(null);
  });
});

describe("Modal", () => {
  it("ends the dialog both when `open` goes false and when it unmounts while shown", () => {
    // Two calls: the `open` effect's close branch and the unmount cleanup (guarded by `shown`).
    expect(modalSource.match(/finish\(d, opener\.current\)/g)?.length).toBe(2);
    expect(modalSource).toMatch(/return \(\) => \{\s*if \(!shown\.current\) return;/);
    expect(modalSource).toMatch(/useEffect\(\(\) => \{\s*const d = ref\.current;\s*return \(\) =>/);
  });

  it("hands the focus back with the fallback (M1.5 M2): the dialog underneath, then the main landmark; <body> is never an opener", () => {
    expect(modalSource).toMatch(/endDialog\(d, opener as HTMLElement \| null, dialogFocusFallback\(d\)\)/);
    expect(modalSource).toMatch(/:scope > \.dialog__title/);
    expect(modalSource).toMatch(/document\.getElementById\("main"\)/);
    expect(modalSource).toMatch(/active !== document\.body \? active : null/);
    // the shown list follows showModal() and every end
    expect(modalSource).toMatch(/d\.showModal\(\);\s*shownDialogs\.push\(d\);/);
    expect(modalSource).toMatch(/shownDialogs\.splice\(at, 1\)/);
  });
});
