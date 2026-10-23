// The browser Turnstile loader of the sign-in screens (M2.4b) [ADM-AUTH-06, POR-01], with a stand-in for `window`: the
// script is injected once with render=explicit, a failed load is retried, the widget keeps its ID, a token is handed over
// once, reset() asks for a fresh one, and token() never waits for ever.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTurnstileWidget,
  loadTurnstile,
  sizeFor,
  TURNSTILE_SCRIPT,
  type TurnstileApi,
  type TurnstileHost,
  type TurnstileState,
} from "../src/client.ts";

type Script = {
  src: string;
  async: boolean;
  defer: boolean;
  on: Record<string, () => void>;
  addEventListener: (t: "load" | "error", fn: () => void) => void;
};

/** A fake page: records injected scripts; `fire(i, "load")` installs the fake API first, as Cloudflare's script would. */
function fakeHost() {
  const scripts: Script[] = [];
  const rendered: { el: HTMLElement; opts: Record<string, unknown>; id: string }[] = [];
  const api: TurnstileApi & { resets: string[]; removed: string[] } = {
    resets: [],
    removed: [],
    render: (el, opts) => {
      const id = `w${rendered.length + 1}`;
      rendered.push({ el, opts, id });
      return id;
    },
    reset: (id) => api.resets.push(String(id)),
    remove: (id) => api.removed.push(String(id)),
  };
  const host: TurnstileHost = {
    document: {
      createElement: () => {
        const s: Script = {
          src: "",
          async: false,
          defer: false,
          on: {},
          addEventListener: (t, fn) => {
            s.on[t] = fn;
          },
        };
        return s;
      },
      head: { append: (s: never) => scripts.push(s as Script) },
    },
  };
  const fire = (i: number, what: "load" | "error") => {
    if (what === "load") host.turnstile = api;
    scripts[i]?.on[what]?.();
  };
  /** The callbacks the widget registered (the latest render). */
  const cb = (name: string) => rendered.at(-1)?.opts[name] as (t?: string) => void;
  return { host, scripts, rendered, api, fire, cb };
}

const el = {} as HTMLElement;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("loadTurnstile", () => {
  it("injects Cloudflare's script once, explicit rendering, async", async () => {
    const f = fakeHost();
    const a = loadTurnstile(f.host);
    const b = loadTurnstile(f.host);
    expect(f.scripts).toHaveLength(1);
    expect(f.scripts[0]?.src).toBe(TURNSTILE_SCRIPT);
    expect(TURNSTILE_SCRIPT).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
    expect(f.scripts[0]?.async).toBe(true);
    f.fire(0, "load");
    expect(await a).toBe(f.api);
    expect(await b).toBe(f.api);
    // Once the API is there, no further script.
    await loadTurnstile(f.host);
    expect(f.scripts).toHaveLength(1);
  });

  it("forgets a failed load, so the next call tries again", async () => {
    const f = fakeHost();
    const a = loadTurnstile(f.host);
    f.fire(0, "error");
    await expect(a).rejects.toThrow(/failed to load/);
    const b = loadTurnstile(f.host);
    expect(f.scripts).toHaveLength(2);
    f.fire(1, "load");
    expect(await b).toBe(f.api);
  });

  it("a script that loads without the API is a failure", async () => {
    const f = fakeHost();
    const a = loadTurnstile(f.host);
    f.scripts[0]?.on.load?.();
    await expect(a).rejects.toThrow(/no API/);
  });
});

describe("createTurnstileWidget", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it("renders a managed, flexible widget with the action and site key, following the device theme", async () => {
    const f = fakeHost();
    const states: TurnstileState[] = [];
    createTurnstileWidget(
      el,
      { siteKey: "1x00000000000000000000AA", action: "portal_link", onState: (s) => states.push(s) },
      f.host,
    );
    f.fire(0, "load");
    await flush();
    expect(f.rendered).toHaveLength(1);
    expect(f.rendered[0]?.el).toBe(el);
    expect(f.rendered[0]?.opts).toMatchObject({
      sitekey: "1x00000000000000000000AA",
      action: "portal_link",
      theme: "auto",
      size: "flexible",
      appearance: "always",
      "refresh-expired": "auto",
    });
    expect(states).toEqual(["loading", "ready"]);
  });

  it("a column narrower than Cloudflare's 300 px minimum gets the compact widget", async () => {
    expect(sizeFor({ clientWidth: 309 })).toBe("flexible");
    expect(sizeFor({ clientWidth: 300 })).toBe("flexible");
    expect(sizeFor({ clientWidth: 254 })).toBe("compact");
    expect(sizeFor({})).toBe("flexible");
    const f = fakeHost();
    createTurnstileWidget(
      { clientWidth: 254 } as HTMLElement,
      { siteKey: "k", action: "admin_login" },
      f.host,
    );
    f.fire(0, "load");
    await flush();
    expect(f.rendered[0]?.opts.size).toBe("compact");
  });

  it("hands a token over once; after reset() the next attempt waits for a fresh one", async () => {
    const f = fakeHost();
    const w = createTurnstileWidget(el, { siteKey: "k", action: "admin_login" }, f.host);
    f.fire(0, "load");
    await flush();
    f.cb("callback")("tok-1");
    expect(await w.token()).toBe("tok-1");
    w.reset();
    expect(f.api.resets).toEqual(["w1"]);
    const next = w.token();
    f.cb("callback")("tok-2");
    expect(await next).toBe("tok-2");
  });

  it("waits for a widget that is still working, and gives up with an empty token after waitMs", async () => {
    vi.useFakeTimers();
    const f = fakeHost();
    const w = createTurnstileWidget(el, { siteKey: "k", action: "admin_login", waitMs: 5000 }, f.host);
    const pending = w.token();
    vi.advanceTimersByTime(5000);
    expect(await pending).toBe("");
  });

  it("an expired token is never handed over", async () => {
    const f = fakeHost();
    const w = createTurnstileWidget(el, { siteKey: "k", action: "admin_login", waitMs: 50 }, f.host);
    f.fire(0, "load");
    await flush();
    f.cb("callback")("tok-old");
    f.cb("expired-callback")();
    expect(await w.token()).toBe("");
  });

  it("a widget error answers the waiting attempt with no token, and the next attempt resets the widget", async () => {
    const f = fakeHost();
    const states: TurnstileState[] = [];
    const w = createTurnstileWidget(
      el,
      { siteKey: "k", action: "portal_link", waitMs: 50, onState: (s) => states.push(s) },
      f.host,
    );
    f.fire(0, "load");
    await flush();
    const pending = w.token();
    f.cb("error-callback")();
    expect(await pending).toBe("");
    expect(states.at(-1)).toBe("error");
    const again = w.token();
    expect(f.api.resets).toEqual(["w1"]);
    f.cb("callback")("tok-3");
    expect(await again).toBe("tok-3");
  });

  it("a script that failed to load is loaded again on reset()", async () => {
    const f = fakeHost();
    const states: TurnstileState[] = [];
    const w = createTurnstileWidget(
      el,
      { siteKey: "k", action: "portal_link", onState: (s) => states.push(s) },
      f.host,
    );
    f.fire(0, "error");
    await flush();
    expect(states).toEqual(["loading", "error"]);
    w.reset();
    expect(f.scripts).toHaveLength(2);
    f.fire(1, "load");
    await flush();
    expect(f.rendered).toHaveLength(1);
    expect(states.at(-1)).toBe("ready");
  });

  it("remove() takes the widget off the page and never renders one that loads afterwards", async () => {
    const f = fakeHost();
    const w = createTurnstileWidget(el, { siteKey: "k", action: "portal_link" }, f.host);
    f.fire(0, "load");
    await flush();
    w.remove();
    expect(f.api.removed).toEqual(["w1"]);
    expect(await w.token()).toBe("");

    const g = fakeHost();
    const late = createTurnstileWidget(el, { siteKey: "k", action: "portal_link" }, g.host);
    late.remove();
    g.fire(0, "load");
    await flush();
    expect(g.rendered).toHaveLength(0);
  });
});
