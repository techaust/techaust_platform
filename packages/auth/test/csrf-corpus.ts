// One corpus for the CSRF rule, used by the pure function's test here and by the portal Worker's test (and the admin
// one), so both apps are held to the same decisions (05 §7.1). Plain data: no imports from the code under test.
export type CsrfCase = {
  name: string;
  /** Overrides on top of a same-origin JSON POST to https://app.example. */
  input: {
    method?: string;
    origin?: string | null;
    secFetchSite?: string | null;
    contentType?: string | null;
    hasBody?: boolean;
  };
  verdict: "ok" | "cross_site" | "not_json";
};

const EVIL = "https://evil.example";

export const CSRF_CORPUS: CsrfCase[] = [
  { name: "same-origin JSON POST", input: {}, verdict: "ok" },
  {
    name: "same-origin POST with a charset",
    input: { contentType: "application/json; charset=utf-8" },
    verdict: "ok",
  },
  { name: "JSON in any case", input: { contentType: "Application/JSON" }, verdict: "ok" },
  {
    name: "no Origin, Sec-Fetch-Site same-origin",
    input: { origin: null, secFetchSite: "same-origin" },
    verdict: "ok",
  },
  {
    name: "same-origin POST without a body and without a type",
    input: { hasBody: false, contentType: null },
    verdict: "ok",
  },
  {
    name: "GET from anywhere",
    input: { method: "GET", origin: EVIL, contentType: null, hasBody: false },
    verdict: "ok",
  },
  { name: "HEAD from anywhere", input: { method: "HEAD", origin: EVIL }, verdict: "ok" },
  { name: "OPTIONS from anywhere", input: { method: "OPTIONS", origin: EVIL }, verdict: "ok" },
  { name: "cross-origin POST", input: { origin: EVIL }, verdict: "cross_site" },
  { name: "a different port", input: { origin: "https://app.example:8443" }, verdict: "cross_site" },
  { name: "http instead of https", input: { origin: "http://app.example" }, verdict: "cross_site" },
  { name: "a sub-domain", input: { origin: "https://x.app.example" }, verdict: "cross_site" },
  { name: "Origin: null (sandboxed frame)", input: { origin: "null" }, verdict: "cross_site" },
  {
    name: "no Origin and no Sec-Fetch-Site",
    input: { origin: null, secFetchSite: null },
    verdict: "cross_site",
  },
  {
    name: "no Origin, Sec-Fetch-Site cross-site",
    input: { origin: null, secFetchSite: "cross-site" },
    verdict: "cross_site",
  },
  {
    name: "no Origin, Sec-Fetch-Site same-site",
    input: { origin: null, secFetchSite: "same-site" },
    verdict: "cross_site",
  },
  {
    name: "a wrong Origin beats a same-origin Sec-Fetch-Site",
    input: { origin: EVIL, secFetchSite: "same-origin" },
    verdict: "cross_site",
  },
  {
    name: "DELETE cross-origin",
    input: { method: "DELETE", origin: EVIL, hasBody: false },
    verdict: "cross_site",
  },
  { name: "PATCH cross-origin", input: { method: "PATCH", origin: EVIL }, verdict: "cross_site" },
  { name: "a form post", input: { contentType: "application/x-www-form-urlencoded" }, verdict: "not_json" },
  { name: "multipart", input: { contentType: "multipart/form-data; boundary=x" }, verdict: "not_json" },
  { name: "text/plain", input: { contentType: "text/plain" }, verdict: "not_json" },
  { name: "a body with no content type", input: { contentType: null }, verdict: "not_json" },
  { name: "a look-alike type", input: { contentType: "application/jsonx" }, verdict: "not_json" },
  { name: "a look-alike prefix", input: { contentType: "text/application/json" }, verdict: "not_json" },
  {
    name: "cross-origin wins over the content type",
    input: { origin: EVIL, contentType: "text/plain" },
    verdict: "cross_site",
  },
];
