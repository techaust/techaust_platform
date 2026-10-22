// The forms of /contact and /get-a-quote, enhanced (M2.4; FRM-01 to FRM-07, docs/06 §5.4). Without this script both
// are plain HTML forms that POST to the website Worker, which answers a post without a Turnstile token with the
// no-JavaScript notice (owner, 2026-10-23). With it:
//   - every check uses the SAME schemas as the server (@techaust/core: contactForm, quoteSteps), so the messages are
//     07 §5.9's and the two sides can't disagree (FRM-01); a field is checked when the visitor leaves it after typing,
//     and again on submit or "Continue" (never while typing the first characters); a shown error clears as soon as it
//     is fixed; the error summary links to each field and takes focus
//   - the quote form shows one step at a time; "Continue" checks the step, "Back" keeps every answer, focus moves to
//     the step's heading
//   - spam protection (FRM-02): the Turnstile widget is rendered explicitly (managed, shown only when Cloudflare needs
//     the visitor), its single-use token is reset after every failed request; `form_elapsed_ms` is measured here with
//     performance.now(); the honeypot is left alone
//   - attribution and consent fields (FRM-05, FRM-06) from sessionStorage (scripts/attribution.ts), no cookies
//   - sending: JSON to the form's own action, one request at a time; success goes to /thanks?ref=…; a refusal says
//     what to do in plain words (the two lines in content/forms.ts) and keeps everything typed
import { contactForm, FORM_FIELDS, LEAD_REF, MIN_FILL_MS, quoteSteps } from "@techaust/core";

type Values = Record<string, string | string[]>;
type Issue = { path: PropertyKey[]; message: string };
type Schema = { safeParse: (v: unknown) => unknown };
type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string | undefined;
  reset: (id?: string) => void;
};

const root = document.documentElement;
const shownAt = performance.now();
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ATTR_KEY = "ta_attr";
const UTM = ["source", "medium", "campaign", "term", "content"] as const;
const QUOTE_STEPS: Schema[] = [quoteSteps.service, quoteSteps.goals, quoteSteps.budget, quoteSteps.contact];
const MULTI = new Set(["tools"]);

/** First message per field (by the issue's first path segment), in the schema's order. */
function check(schema: Schema, values: Values): Map<string, string> {
  const r = schema.safeParse(values) as { success: boolean; error?: { issues: Issue[] } };
  const out = new Map<string, string>();
  if (!r.success)
    for (const i of r.error?.issues ?? []) {
      const key = String(i.path[0] ?? "");
      if (key && !out.has(key)) out.set(key, i.message);
    }
  return out;
}

let turnstileApi: Promise<Turnstile> | undefined;
function loadTurnstile(): Promise<Turnstile> {
  const w = window as Window & { turnstile?: Turnstile };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  turnstileApi ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.addEventListener("load", () => (w.turnstile ? resolve(w.turnstile) : reject(new Error("turnstile"))));
    s.addEventListener("error", () => reject(new Error("turnstile")));
    document.head.append(s);
  });
  return turnstileApi;
}

function enhance(form: HTMLFormElement) {
  const kind = form.dataset.form === "quote" ? "quote" : "contact";
  const msg = {
    generic: form.dataset.msgGeneric ?? "",
    rate: form.dataset.msgRate ?? "",
    step: form.dataset.msgStep ?? "",
    yourTime: form.dataset.msgYourtime ?? "",
  };
  form.noValidate = true;

  const $ = <T extends Element>(sel: string, scope: ParentNode = form) => scope.querySelector<T>(sel);
  const $$ = <T extends Element>(sel: string, scope: ParentNode = form) => [...scope.querySelectorAll<T>(sel)];
  const summary = $<HTMLElement>("[data-error-summary]");
  const summaryList = $<HTMLElement>("[data-error-list]");
  const statusText = $<HTMLElement>("[data-status-text]");
  const submitBtn = $<HTMLButtonElement>("[data-submit]");
  const steps = $$<HTMLFieldSetElement>("[data-qstep]");
  let step = 1;

  // ---------- Values and fields ----------

  const values = (): Values => {
    const out: Values = {};
    const data = new FormData(form);
    for (const key of new Set(data.keys())) {
      const all = data.getAll(key).map(String);
      out[key] = MULTI.has(key) ? all : (all[0] ?? "");
    }
    for (const key of MULTI) out[key] ??= [];
    return out;
  };

  const wrapOf = (name: string) => $<HTMLElement>(`[data-field="${name}"]`);
  const controlsOf = (name: string) =>
    $$<HTMLInputElement>(`[name="${name}"]`).filter((el) => el.type !== "hidden" && !el.disabled);
  const focusTargetOf = (name: string) => {
    const controls = controlsOf(name);
    return controls.find((c) => c.checked) ?? controls[0];
  };
  const stepOfField = (name: string) => {
    const owner = wrapOf(name)?.closest<HTMLElement>("[data-qstep]");
    return owner ? Number(owner.dataset.qstep) : 1;
  };
  const schemaFor = (name: string): Schema =>
    kind === "contact" ? contactForm : (QUOTE_STEPS[stepOfField(name) - 1] ?? quoteSteps.contact);

  const shown = new Map<string, string>();
  const dirty = new Set<string>();

  function setError(name: string, message: string | undefined) {
    const wrap = wrapOf(name);
    if (!wrap) return;
    const text = $<HTMLElement>("[data-error-text]", wrap);
    if (text) text.textContent = message ?? "";
    if (message) shown.set(name, message);
    else shown.delete(name);
    wrap.toggleAttribute("data-invalid", Boolean(message));
    for (const c of controlsOf(name))
      if (c.type !== "radio" && c.type !== "checkbox") c.setAttribute("aria-invalid", String(Boolean(message)));
  }

  /** Re-checks one field and updates its error and, if it is showing, the summary. */
  function recheck(name: string) {
    if (!wrapOf(name)) return;
    setError(name, check(schemaFor(name), values()).get(name));
    if (summary && !summary.hidden) renderSummary(false);
  }

  function renderSummary(focus: boolean) {
    if (!summary || !summaryList) return;
    const items = [...shown].filter(([name]) => kind === "contact" || stepOfField(name) === step);
    summaryList.replaceChildren(
      ...items.map(([name, message]) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        const target = focusTargetOf(name);
        a.href = `#${target?.id ?? ""}`;
        a.textContent = message;
        a.addEventListener("click", (event) => {
          event.preventDefault();
          const t = focusTargetOf(name);
          t?.focus({ preventScroll: true });
          wrapOf(name)?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
        });
        li.append(a);
        return li;
      }),
    );
    summary.hidden = items.length === 0;
    if (focus && items.length > 0) summary.focus();
  }

  const hideSummary = () => {
    if (summary) summary.hidden = true;
  };

  /** Shows the errors of a set of fields (clears the ones that pass); true when all pass. */
  function validate(schema: Schema, names: string[]): boolean {
    const errors = check(schema, values());
    for (const n of names) setError(n, errors.get(n));
    for (const [n, m] of errors) if (!names.includes(n)) setError(n, m);
    renderSummary(true);
    return errors.size === 0;
  }

  const namesIn = (scope: ParentNode) => [
    ...new Set($$<HTMLElement>("[data-field]", scope).map((el) => el.dataset.field ?? "")),
  ];

  form.addEventListener("input", (event) => {
    const name = (event.target as HTMLInputElement).name;
    if (!name) return;
    dirty.add(name);
    if (shown.has(name)) recheck(name);
  });
  form.addEventListener("change", (event) => {
    const t = event.target as HTMLInputElement;
    if (!t.name) return;
    dirty.add(t.name);
    if (shown.has(t.name)) recheck(t.name);
  });
  form.addEventListener("focusout", (event) => {
    const t = event.target as HTMLInputElement;
    if (!t.name || t.type === "radio" || t.type === "checkbox" || !dirty.has(t.name)) return;
    recheck(t.name);
  });

  // ---------- Status and sending ----------

  const setStatus = (text: string) => {
    if (statusText) statusText.textContent = text;
  };

  let sending = false;
  function setSending(on: boolean) {
    sending = on;
    form.toggleAttribute("data-sending", on);
    form.setAttribute("aria-busy", String(on));
    submitBtn?.setAttribute("aria-disabled", String(on));
    const label = $<HTMLElement>("[data-submit-label]");
    const busy = $<HTMLElement>("[data-sending-label]");
    if (label) label.hidden = on;
    if (busy) busy.hidden = !on;
  }

  // ---------- Turnstile ----------

  const box = $<HTMLElement>("[data-turnstile]");
  const siteKey = box?.dataset.sitekey ?? "";
  let widgetId: string | undefined;
  let token = "";
  let failed = false;
  const waiters: ((t: string) => void)[] = [];
  const settle = (t: string) => {
    token = t;
    for (const w of waiters.splice(0)) w(t);
  };

  let api: Turnstile | undefined;
  if (box && siteKey) {
    loadTurnstile()
      .then((ts) => {
        api = ts;
        const dark =
          root.dataset.theme === "dark" ||
          (root.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
        widgetId = ts.render(box, {
          sitekey: siteKey,
          action: box.dataset.action,
          appearance: "interaction-only",
          theme: dark ? "dark" : "light",
          size: "flexible",
          "refresh-expired": "auto",
          callback: (t: string) => {
            failed = false;
            settle(t);
          },
          "expired-callback": () => {
            token = "";
          },
          "error-callback": () => {
            failed = true;
            settle("");
            return true;
          },
        });
      })
      .catch(() => {
        failed = true;
        settle("");
      });
  }

  /** A fresh token, waiting for the widget if it is still working (up to 20 s); "" when there is none. */
  function getToken(): Promise<string> {
    if (!siteKey) return Promise.resolve("");
    if (token) return Promise.resolve(token);
    if (failed) {
      // One more try after an error (the widget may have been blocked for a moment).
      failed = false;
      if (api && widgetId !== undefined) api.reset(widgetId);
    }
    return new Promise((resolve) => {
      waiters.push(resolve);
      setTimeout(() => {
        const i = waiters.indexOf(resolve);
        if (i >= 0) {
          waiters.splice(i, 1);
          resolve(token);
        }
      }, 20_000);
    });
  }

  /** Tokens are single-use: after a request that didn't succeed, get a new one before the visitor tries again. */
  function resetToken() {
    token = "";
    if (api && widgetId !== undefined) api.reset(widgetId);
  }

  // ---------- Attribution, consent, fill time ----------

  function fillHidden() {
    const set = (name: string, value: string) => {
      const input = $<HTMLInputElement>(`[data-meta="${name}"]`);
      if (input) input.value = value;
    };
    let attr: { utm?: Record<string, string>; ref?: string } = {};
    try {
      attr = JSON.parse(sessionStorage.getItem(ATTR_KEY) ?? "null") ?? {};
    } catch {
      // Storage blocked or unreadable: no attribution.
    }
    for (const k of UTM) set(`utm_${k}`, attr.utm?.[k] ?? "");
    set("referrerHost", attr.ref ?? "");
    let source = location.pathname;
    try {
      const r = new URL(document.referrer);
      if (r.host === location.host && r.pathname !== location.pathname) source = r.pathname;
    } catch {
      // No same-site page before this one: the form's own page is the source.
    }
    set("sourcePage", source.slice(0, 200));
    const elapsed = $<HTMLInputElement>("[data-elapsed]");
    if (elapsed) elapsed.value = String(Math.round(performance.now() - shownAt));
  }

  // ---------- Currency (the budget bands follow <html data-currency>) ----------

  function syncCurrency() {
    const cur = root.dataset.currency === "usd" ? "USD" : "INR";
    for (const set of $$<HTMLElement>("[data-bands]"))
      for (const input of $$<HTMLInputElement>("input", set)) input.disabled = set.dataset.bands !== cur;
    for (const f of $$<HTMLInputElement>("[data-currency-field]")) f.value = cur;
  }
  syncCurrency();
  new MutationObserver(syncCurrency).observe(root, { attributes: true, attributeFilter: ["data-currency"] });

  // ---------- Quote steps ----------

  function go(n: number, focus = true) {
    step = n;
    form.dataset.step = String(n);
    for (const s of steps) s.hidden = Number(s.dataset.qstep) !== n;
    const title = $<HTMLElement>("[data-step-title]", steps[n - 1] ?? form);
    const progressN = $<HTMLElement>("[data-progress-n]");
    const progressTitle = $<HTMLElement>("[data-progress-title]");
    if (progressN) progressN.textContent = msg.step.replace("{n}", String(n)).replace("{total}", String(steps.length));
    if (progressTitle && title) progressTitle.textContent = title.textContent;
    for (const item of $$<HTMLElement>("[data-rail-step]", document)) {
      const i = Number(item.dataset.railStep);
      item.classList.toggle("is-done", i < n);
      if (i === n) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    }
    if (focus) title?.focus();
  }

  function next() {
    const current = steps[step - 1];
    if (!current) return;
    if (!validate(QUOTE_STEPS[step - 1] ?? quoteSteps.contact, namesIn(current))) return;
    hideSummary();
    go(step + 1);
  }

  if (kind === "quote") {
    form.addEventListener("click", (event) => {
      const t = (event.target as Element).closest("[data-next], [data-back]");
      if (!t) return;
      if (t.hasAttribute("data-next")) next();
      else if (step > 1) {
        hideSummary();
        setStatus("");
        go(step - 1);
      }
    });

    // Links in: ?service=Sx pre-selects; type=pilot and plan=<tier> ride along (07 §2.3).
    const q = new URLSearchParams(location.search);
    const service = q.get("service");
    if (service) {
      const radio = $$<HTMLInputElement>('[name="service"]').find((r) => r.value === service);
      if (radio) radio.checked = true;
    }
    for (const key of ["type", "plan"]) {
      const v = q.get(key) ?? "";
      const input = $<HTMLInputElement>(`[data-carry="${key}"]`);
      if (input && /^[a-z0-9-]{1,30}$/.test(v)) input.value = v;
    }

    // "Best time for a call": the visitor's own time beside each IST window, when their clock isn't on IST.
    const IST = 330;
    if (-new Date().getTimezoneOffset() !== IST) {
      const fmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      const now = new Date();
      const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const at = (min: number) => fmt.format(new Date(day + (min - IST) * 60_000));
      for (const input of $$<HTMLInputElement>("[data-from]")) {
        const sub = $<HTMLElement>("[data-sub]", input.closest("label") ?? form);
        if (sub)
          sub.textContent = `${msg.yourTime} ${at(Number(input.dataset.from))}–${at(Number(input.dataset.to))}`;
      }
    }

    go(1, false);
    form.setAttribute("data-ready", "");
  }

  // ---------- Submit ----------

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    if (kind === "quote" && step < steps.length) {
      next();
      return;
    }
    if (kind === "contact") {
      if (!validate(contactForm, namesIn(form))) return;
    } else {
      // The last step, and every earlier one (the currency may have changed since the budget was chosen).
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i] as HTMLFieldSetElement;
        const errors = check(QUOTE_STEPS[i] ?? quoteSteps.contact, values());
        if (errors.size > 0) {
          if (i + 1 !== step) go(i + 1, false);
          validate(QUOTE_STEPS[i] ?? quoteSteps.contact, namesIn(s));
          return;
        }
      }
    }
    hideSummary();
    setStatus("");
    setSending(true);

    const wait = MIN_FILL_MS + 100 - (performance.now() - shownAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const t = await getToken();
    if (siteKey && !t) {
      setStatus(msg.generic);
      setSending(false);
      return;
    }
    fillHidden();
    const body: Values = { ...values(), [FORM_FIELDS.turnstile]: t };

    let res: Response | undefined;
    let data: { ok?: boolean; ref?: string; error?: string; fields?: unknown } | null = null;
    try {
      res = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      data = await res.json();
    } catch {
      // Network error or not JSON: the generic line below.
    }
    if (res?.ok && data?.ok && typeof data.ref === "string" && LEAD_REF.test(data.ref)) {
      location.assign(`/thanks?ref=${encodeURIComponent(data.ref)}`);
      return;
    }
    resetToken();
    setSending(false);
    if (data?.error === "invalid" && Array.isArray(data.fields)) {
      // The server found what this page didn't: show the shared schema's messages for those fields if it can.
      const all = kind === "contact" ? check(contactForm, values()) : new Map<string, string>();
      if (kind === "quote") for (const s of QUOTE_STEPS) for (const [k, m] of check(s, values())) all.set(k, m);
      const named = (data.fields as unknown[]).map(String).filter((f) => all.has(f));
      if (named.length > 0) {
        for (const f of named) setError(f, all.get(f));
        const first = named[0] as string;
        if (kind === "quote" && stepOfField(first) !== step) go(stepOfField(first), false);
        renderSummary(true);
        return;
      }
    }
    setStatus(res?.status === 429 || data?.error === "rate_limited" ? msg.rate : msg.generic);
  });

  // Back from /thanks with the browser's Back button: the page may come back from the cache mid-"Sending".
  addEventListener("pageshow", (event) => {
    if (event.persisted && sending) {
      setSending(false);
      resetToken();
    }
  });
}

for (const form of document.querySelectorAll<HTMLFormElement>("form[data-form]")) enhance(form);
