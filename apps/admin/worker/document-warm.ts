// Start-up warm-up of the proposal and estimate schemas (M4.3, CPU tuning; same idea as warm.ts): the first parse of a zod schema is the costly
// one on the Free plan, so each request schema of the new routes parses one made-up sample while the isolate starts, not inside the first
// request. Pure of `env`, nothing stored or logged; the count of samples that parsed is returned so a test notices a sample that a schema
// change has made invalid.
import { decideBody, requestBody } from "./approvals.ts";
import { convertBody } from "./document-convert.ts";
import { patchBody } from "./document-save.ts";
import { sendBody } from "./document-send.ts";
import { createBody, listQuery } from "./documents.ts";

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
      sendBody.safeParse({ expectedUpdatedAt: 1 }).success,
      requestBody.safeParse({ expectedUpdatedAt: 1, reason: "r" }).success,
      decideBody.safeParse({ decision: "approve", note: "n" }).success,
      convertBody.safeParse({ to: "invoice" }).success,
      listQuery.safeParse({ type: "proposal", limit: "25" }).success,
    ];
    return samples.filter(Boolean).length;
  } catch {
    return 0; // never stop a Worker from starting
  }
}
