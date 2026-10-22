// First-touch attribution (FRM-06): on the first page of a visit (this tab's session), keep the UTM parameters and the
// host of an outside referrer in sessionStorage, so a form sent later in the visit can say where the visitor came from.
// No cookies, nothing sent anywhere until the visitor sends a form (scripts/forms.ts reads it). Runs on every page.
const KEY = "ta_attr";
const UTM = ["source", "medium", "campaign", "term", "content"] as const;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are dropped, never stored
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

try {
  if (!sessionStorage.getItem(KEY)) {
    const q = new URLSearchParams(location.search);
    const utm: Record<string, string> = {};
    for (const k of UTM) {
      const v = (q.get(`utm_${k}`) ?? "").replace(CONTROL, "").trim().slice(0, 100);
      if (v) utm[k] = v;
    }
    let ref = "";
    try {
      const r = new URL(document.referrer);
      if (r.host !== location.host) ref = r.hostname;
    } catch {
      // No referrer, or not a URL.
    }
    sessionStorage.setItem(KEY, JSON.stringify({ utm, ref }));
  }
} catch {
  // Storage blocked: no attribution, the form still works.
}
