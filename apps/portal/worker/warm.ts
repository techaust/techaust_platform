// CPU tuning 3: the first zod parse, the first HMAC and the first regexes of a sign-in request move into isolate start-up
// (shown in local workerd; confirmed on staging by the first `/magic`'s `cpuTimeMs`). Errors are swallowed inside.
// Imported by the Worker entry for its side effect; the promise is exported so a test proves the entry really runs it
// (kept out of the entry itself, where an extra named export could be read as an entrypoint).
//
// M4.5: the offer routes' body schemas and the typed-name check are sampled too, so the first accept does not pay for their first parse.
//
// M7.1 J (the M6.2 CPU diagnosis applies): one sample parse of each new body schema, `paidNoticeVerdict` and `noticeAllowed`, and the home, project, profile,
// receipt and notice row mappers on made-up rows (`warmPortalRows`, a count the test pins). No `env`, no I/O, no `import()`; never throws.
import { warmPortalAuth } from "@techaust/auth";
import { checkDecline, normaliseTypedName } from "@techaust/core/offers";
import { noticeAllowed, paidNoticeVerdict } from "@techaust/core/portal";
import { warmPortalSchemas } from "@techaust/core/portal-schemas";
import { awaitingOf, recentReceiptOf } from "./home.ts";
import { listItemOf } from "./invoice-summary.ts";
import {
  acceptRequest,
  declineRequest,
  linkAcceptRequest,
  linkDeclineRequest,
  linkDocRequest,
  linkRequest,
} from "./offer-schemas.ts";
import { requestOf } from "./profile.ts";
import { milestoneOf, projectOf } from "./projects.ts";
import { receiptRowOf } from "./receipts.ts";
import { fileOf, noteOf } from "./shared.ts";

/** One sample parse of each offer body, and one typed name and one decline reason. Never throws. */
export function warmOffers(): void {
  try {
    acceptRequest.safeParse({ typedName: "Warm Up", agree: true });
    declineRequest.safeParse({ reason: "price" });
    linkRequest.safeParse({ token: "warm-up" });
    linkDocRequest.safeParse({ token: "warm-up", documentId: "warm-up" });
    linkAcceptRequest.safeParse({
      token: "warm-up",
      documentId: "warm-up",
      typedName: "Warm Up",
      agree: true,
    });
    linkDeclineRequest.safeParse({ token: "warm-up", documentId: "warm-up", reason: "other", note: "warm" });
    normaliseTypedName("Warm Up");
    checkDecline("other", "warm");
  } catch {
    // a failed warm-up never blocks start-up
  }
}

/** M7.1: the new schemas and rules, and each row mapper once on a made-up row. Returns how many steps ran (the test pins it). Never throws. */
export function warmPortalRows(): number {
  let n = 0;
  try {
    n += warmPortalSchemas(); // 6
    if (
      paidNoticeVerdict({
        amountMinor: 100,
        balanceMinor: 100,
        paidOn: "2026-11-04",
        issueDate: "2026-11-01",
        todayIst: "2026-11-04",
      }) === "ok"
    )
      n++;
    if (noticeAllowed({ type: "tax_invoice", status: "issued", balanceMinor: 100, withdrawn: false }).ok) n++;
    const at = 1_800_000_000_000;
    awaitingOf(
      {
        id: "warm",
        type: "proposal",
        title: "Warm",
        number_display: "TH/PRP/0001",
        version: 1,
        status: "sent",
        valid_until: "2099-01-01",
        total_minor: 100,
        currency: "INR",
      },
      "2026-11-04",
    );
    n++;
    recentReceiptOf({
      id: "rct_warm",
      number_display: "TH/RCT/0001",
      issue_date: "2026-11-04",
      currency: "INR",
      total_minor: 100,
      has_pdf: 1,
    });
    n++;
    listItemOf({
      id: "warm",
      type: "tax_invoice",
      status: "issued",
      number_display: "TH/INV/0001",
      issue_date: "2026-11-04",
      due_date: "2026-11-11",
      currency: "INR",
      total_minor: 100,
      balance_minor: 100,
      voided_at: null,
    });
    n++;
    const project = {
      id: "warm",
      code: "P-0001",
      name: "Warm",
      status: "active",
      start_date: null,
      target_date: null,
      created_at: at,
    };
    projectOf(project);
    n++;
    milestoneOf({ id: "warm", position: 1, title: "Warm", status: "pending", due_date: null }, false);
    milestoneOf(
      {
        id: "warm",
        position: 1,
        title: "Warm",
        status: "invoiced",
        due_date: null,
        amount_minor: 100,
        currency: "INR",
        invoice_id: "warm",
        invoice_number: "TH/INV/0001",
      },
      true,
    );
    n++;
    noteOf({ id: "warm", project_id: null, body_md: "Warm", created_at: at, updated_at: at });
    fileOf({
      id: "warm",
      project_id: null,
      filename: "warm.pdf",
      mime: "application/pdf",
      size: 1,
      created_at: at,
    });
    n++;
    receiptRowOf({
      id: "rct_warm",
      type: "receipt",
      number_display: "TH/RCT/0001",
      issue_date: "2026-11-04",
      currency: "INR",
      total_minor: 100,
      has_pdf: 1,
      applied_to: '[{"number":"TH/INV/0001"}]',
      applied_more: 0,
      parent_number: null,
      parent_open_id: null,
    });
    n++;
    requestOf({
      id: "warm",
      kind: "grievance",
      details: "Warm",
      status: "open",
      outcome: null,
      created_at: at,
      closed_at: null,
      due_at: at,
    });
    n++;
  } catch {
    // a failed warm-up never blocks start-up
  }
  return n;
}

warmOffers();
export const portalRowsWarm: number = warmPortalRows();
export const portalWarm: Promise<number> = warmPortalAuth();
