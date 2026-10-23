// Browser side of Turnstile on the sign-in screens (M2.4b: ADM-AUTH-06, POR-01), shared by the admin and portal SPAs
// through `@techaust/auth/client`. Framework-free, no npm package:
//   - `loadTurnstile` injects Cloudflare's script once, with `render=explicit`, and only when a sign-in screen asks for it
//     (no other screen loads it). A failed load is forgotten, so the next call tries again.
//   - `createTurnstileWidget` renders one managed widget with the screen's action and keeps its widget ID. Tokens are
//     single use: `token()` hands the current token over once (waiting for the widget if it is still working) and the
//     caller calls `reset()` after every request that didn't succeed, so the next attempt gets a fresh one.
// The server checks the token (packages/auth/src/turnstile.ts); nothing here decides anything.

export const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The part of Cloudflare's `window.turnstile` these screens use. */
export type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string | null | undefined;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

/** Where the script goes and where its API appears: `window` in the browser, a stand-in in tests. */
export type TurnstileHost = {
  turnstile?: TurnstileApi | undefined;
  document: {
    createElement: (tag: "script") => {
      src: string;
      async: boolean;
      defer: boolean;
      addEventListener: (type: "load" | "error", fn: () => void) => void;
    };
    head: { append: (node: never) => void };
  };
};

const hostOf = (host?: TurnstileHost): TurnstileHost => host ?? (globalThis as unknown as TurnstileHost);

const loading = new WeakMap<TurnstileHost, Promise<TurnstileApi>>();

/** Cloudflare's API, loading the script the first time (one script per page, however many callers). */
export function loadTurnstile(host?: TurnstileHost): Promise<TurnstileApi> {
  const h = hostOf(host);
  if (h.turnstile) return Promise.resolve(h.turnstile);
  let p = loading.get(h);
  if (!p) {
    p = new Promise<TurnstileApi>((resolve, reject) => {
      const s = h.document.createElement("script");
      s.src = TURNSTILE_SCRIPT;
      s.async = true;
      s.defer = true;
      s.addEventListener("load", () =>
        h.turnstile ? resolve(h.turnstile) : reject(new Error("turnstile: no API after load")),
      );
      s.addEventListener("error", () => reject(new Error("turnstile: script failed to load")));
      h.document.head.append(s as never);
    });
    // A failed load (offline, blocked) is not cached: the next call injects the script again.
    p.catch(() => loading.delete(h));
    loading.set(h, p);
  }
  return p;
}

/** What the widget is doing, for the screen's styling (space held while loading; nothing is decided from it). */
export type TurnstileState = "loading" | "ready" | "verified" | "expired" | "error";

export type TurnstileWidgetOptions = {
  siteKey: string;
  /** The server checks it: `admin_login` or `portal_link`. */
  action: string;
  /** "auto" follows the device's light or dark setting, as the SPAs do. */
  theme?: "auto" | "light" | "dark";
  onState?: (state: TurnstileState) => void;
  /** How long `token()` waits for the widget before giving up with "" (default 20 s). */
  waitMs?: number;
};

export type TurnstileWidget = {
  /** The current token, handed over once; waits for the widget if it is still working; "" if none came in time. */
  token: () => Promise<string>;
  /** A fresh check (after a request that didn't succeed). A widget that failed to load tries to load again. */
  reset: () => void;
  /** Takes the widget off the page (the screen is leaving). */
  remove: () => void;
};

/**
 * "flexible" fills the column like the fields beside it (Cloudflare's minimum is 300 px wide); a column narrower than
 * that (a phone under 360 px wide) gets the "compact" widget instead of one that overflows the card.
 */
export function sizeFor(el: { clientWidth?: number }): "flexible" | "compact" {
  return el.clientWidth && el.clientWidth < 300 ? "compact" : "flexible";
}

/** Renders one managed widget into `el` (explicit rendering) and keeps its widget ID. */
export function createTurnstileWidget(
  el: HTMLElement,
  opts: TurnstileWidgetOptions,
  host?: TurnstileHost,
): TurnstileWidget {
  const h = hostOf(host);
  const waitMs = opts.waitMs ?? 20_000;
  let api: TurnstileApi | undefined;
  let id: string | undefined;
  let token = "";
  let state: TurnstileState = "loading";
  let removed = false;
  const waiters: ((t: string) => void)[] = [];

  const set = (s: TurnstileState) => {
    state = s;
    if (!removed) opts.onState?.(s);
  };
  const settle = (t: string) => {
    token = t;
    for (const w of waiters.splice(0)) w(t);
  };

  function mount() {
    set("loading");
    loadTurnstile(h).then(
      (ts) => {
        if (removed) return;
        api = ts;
        id =
          ts.render(el, {
            sitekey: opts.siteKey,
            action: opts.action,
            theme: opts.theme ?? "auto",
            size: sizeFor(el),
            appearance: "always",
            "refresh-expired": "auto",
            callback: (t: string) => {
              set("verified");
              settle(t);
            },
            "expired-callback": () => {
              token = "";
              set("expired");
            },
            "error-callback": () => {
              set("error");
              settle("");
            },
          }) ?? undefined;
        if (state === "loading") set("ready");
      },
      () => {
        if (removed) return;
        set("error");
        settle("");
      },
    );
  }

  function reset() {
    token = "";
    if (removed) return;
    if (api && id !== undefined) {
      api.reset(id);
      set("ready");
    } else if (state === "error") mount();
  }

  mount();

  return {
    token() {
      if (token) {
        const t = token;
        token = "";
        return Promise.resolve(t);
      }
      if (removed) return Promise.resolve("");
      // After an error, one more try before waiting (the widget may have been blocked for a moment).
      if (state === "error") reset();
      return new Promise<string>((resolve) => {
        const done = (t: string) => {
          clearTimeout(timer);
          token = "";
          resolve(t);
        };
        const timer = setTimeout(() => {
          const i = waiters.indexOf(done);
          if (i >= 0) waiters.splice(i, 1);
          resolve("");
        }, waitMs);
        waiters.push(done);
      });
    },
    reset,
    remove() {
      removed = true;
      settle("");
      if (api && id !== undefined) api.remove(id);
    },
  };
}
