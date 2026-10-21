// The CSRF rule (05 §7.1) as a pure function; the corpus is shared with both Workers' suites (csrf-corpus.ts).
import { describe, expect, it } from "vitest";
import { type CsrfInput, csrfCheck } from "../src/csrf.ts";
import { CSRF_CORPUS } from "./csrf-corpus.ts";

const base: CsrfInput = {
  method: "POST",
  origin: "https://app.example",
  secFetchSite: undefined,
  url: "https://app.example/api/v1/auth/x",
  contentType: "application/json",
  hasBody: true,
};

describe("csrfCheck [ADM-G-02, POR-02, 05 §7.1]", () => {
  for (const c of CSRF_CORPUS) {
    it(`${c.name}: ${c.verdict}`, () => {
      expect(csrfCheck({ ...base, ...c.input })).toBe(c.verdict);
    });
  }

  it("the corpus has every verdict", () => {
    expect(new Set(CSRF_CORPUS.map((c) => c.verdict))).toEqual(new Set(["ok", "cross_site", "not_json"]));
  });

  it("the app origin is the origin of the request URL (port and scheme included)", () => {
    const u = "https://app.example:8443/x";
    expect(csrfCheck({ ...base, url: u, origin: "https://app.example:8443" })).toBe("ok");
    expect(csrfCheck({ ...base, url: u, origin: "https://app.example" })).toBe("cross_site");
  });
});
