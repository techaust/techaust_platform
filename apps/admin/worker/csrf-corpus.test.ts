// The shared CSRF corpus (packages/auth/test/csrf-corpus.ts), run through the ADMIN's middleware: the same decisions
// as the portal's (apps/portal/worker/csrf.test.ts), because both call `csrfCheck` [ADM-G-02, POR-02, 05 §7.1].
import { describe, expect, it } from "vitest";
import { CSRF_CORPUS } from "../../../packages/auth/test/csrf-corpus.ts";
import { counted, ORIGIN, send } from "./test-helpers.ts";

const APP_ORIGIN = "https://app.example";

describe("the shared CSRF corpus, through the admin [05 §7.1]", () => {
  for (const c of CSRF_CORPUS) {
    it(`${c.name}: ${c.verdict}`, async () => {
      const method = c.input.method ?? "POST";
      const headers: Record<string, string> = {};
      const origin = c.input.origin === undefined ? APP_ORIGIN : c.input.origin;
      if (origin !== null) headers.Origin = origin.replace(APP_ORIGIN, ORIGIN);
      if (c.input.secFetchSite) headers["Sec-Fetch-Site"] = c.input.secFetchSite;
      const contentType = c.input.contentType === undefined ? "application/json" : c.input.contentType;
      if (contentType !== null) headers["Content-Type"] = contentType;
      const safe = ["GET", "HEAD", "OPTIONS"].includes(method);
      const counter = counted();
      const res = await send(
        `${ORIGIN}/api/v1/${safe ? "health" : "auth/logout"}`,
        { method, headers, body: (c.input.hasBody ?? true) && !safe ? "{}" : null },
        counter.env,
      );
      if (c.verdict === "cross_site") expect(res.status).toBe(403);
      else if (c.verdict === "not_json") expect(res.status).toBe(415);
      else expect([403, 415]).not.toContain(res.status);
      // (the admin logs refusals in its access log, by its own rule; the portal does not: see its test)
    });
  }
});
