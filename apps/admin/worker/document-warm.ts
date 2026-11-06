// Start-up warm-up of the proposal and estimate schemas (M4.3, CPU tuning; same idea as warm.ts): the first parse of a zod schema is the costly
// one on the Free plan, so each request schema of the new routes parses one made-up sample while the isolate starts, not inside the first
// request. Pure of `env`, nothing stored or logged; the count of samples that parsed is returned so a test notices a sample that a schema
// change has made invalid.
import { requestBody } from "./approval-requests.ts";
import { convertBody } from "./document-convert.ts";
import { resendBody } from "./document-links.ts";
import { patchBody } from "./document-save.ts";
import { sendBody } from "./document-send.ts";
import { startBody } from "./document-start.ts";
import { createBody, listQuery, searchStatement } from "./documents.ts";

export function warmDocuments(): number {
  try {
    const line = { description: "Build", qtyMilli: 1000, unit: "fixed", rateMinor: 100 } as const;
    const samples: boolean[] = [
      createBody.safeParse({ type: "proposal", clientId: "c", services: [{ catalogueItemId: "i" }] }).success,
      patchBody.safeParse({
        expectedUpdatedAt: 1,
        fields: { title: "t", discount: { kind: "percent", value: 100 } },
        lines: [line],
        sections: [{ kind: "estimate", title: "Estimate", bodyMd: "x" }],
        schedule: [{ label: "On acceptance", trigger: "on_accept", pctBp: 10_000 }],
      }).success,
      sendBody.safeParse({ expectedUpdatedAt: 1, contactIds: ["c"], attachPdf: true }).success,
      resendBody.safeParse({ contactIds: ["c"] }).success,
      startBody.safeParse({ expectedUpdatedAt: 1 }).success,
      requestBody.safeParse({ expectedUpdatedAt: 1, reason: "r" }).success,
      convertBody.safeParse({ to: "invoice" }).success,
      convertBody.safeParse({ to: "care_plan", startDate: "2026-11-01", billingDay: 1 }).success,
      listQuery.safeParse({ type: "proposal", limit: "25" }).success,
      // M7.3 C7: the search query and both of its statements built once
      listQuery.safeParse({ q: "PR/26", after: "x" }).success &&
        searchStatement("number", ["proposal", "estimate"], "PR/26", { cursor: { k: 1, id: "x" } }, 26).binds
          .length === 6 &&
        searchStatement("client", ["estimate"], "Ac", { status: "sent", clientId: "c" }, 26).binds.length ===
          7,
    ];
    return samples.filter(Boolean).length;
  } catch {
    return 0; // never stop a Worker from starting
  }
}
