// M7.4 early check 1 M3: one row in every table the retention matrix marks financial (`RETENTION_MATRIX`, rule "financial record"), so the retention test's
// "never deleted" check counts real rows. Each row is inserted the way the code under test finds it (through every trigger). Invented test data only.
import { uuidv7 } from "@techaust/core";
import {
  mkCareDraft,
  mkCarePlan,
  mkContact,
  mkIssued,
  mkReceipt,
  mkReminder,
  mkSend,
  next,
} from "./billing-helpers.ts";
import { run } from "./helpers.ts";
import { mkQuote, send } from "./quotes.ts";

const H = (c: string) => c.repeat(64);

/** Seeds one row (at least) of every financial table for `clientId` (a client in India). Throws listing every table it could not seed. */
export async function seedMoney(clientId: string, owner: string): Promise<void> {
  const failed: string[] = [];
  const step = async (name: string, f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      failed.push(`${name}: ${(e as Error).message}`);
    }
  };
  const contact = await mkContact(clientId, { email: `money.${uuidv7().slice(-6)}@example.test` });

  // an offer with its children, sent, accepted, with its certificate, send and link
  const q = await mkQuote({ clientId, type: "proposal" });
  await step("document_sections", () =>
    run(
      "INSERT INTO document_sections (id, document_id, kind, position, title, body_md) VALUES (?1, ?2, 'scope', 1, 'Scope', 'The work')",
      uuidv7(),
      q.id,
    ),
  );
  await step("payment_schedules", () =>
    run(
      "INSERT INTO payment_schedules (id, document_id, position, label, trigger, pct_bp, amount_minor, detail) VALUES (?1, ?2, 1, 'Advance', 'on_accept', 10000, 100, 'In full')",
      uuidv7(),
      q.id,
    ),
  );
  await step("document_lines", () =>
    run(
      "INSERT INTO document_lines (id, document_id, position, description, qty_milli, unit, rate_minor, taxable_minor, gst_rate_bp, line_total_minor) VALUES (?1, ?2, 1, 'Website', 1000, 'job', 100, 100, 1800, 118)",
      uuidv7(),
      q.id,
    ),
  );
  await send(q);
  const acceptance = uuidv7();
  await step("acceptances", () =>
    run(
      "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256) VALUES (?1, ?2, ?3, 'Asha', 'asha@example.test', 2000, 'x')",
      acceptance,
      q.id,
      contact,
    ),
  );
  await step("acceptance_certificates", () =>
    run(
      "INSERT INTO acceptance_certificates (acceptance_id, r2_key, sha256, rendered_at) VALUES (?1, ?2, ?3, 3000)",
      acceptance,
      `docs/proposal/2026-27/${acceptance}-certificate.pdf`,
      H("c"),
    ),
  );
  let offerSend = "";
  await step("document_sends", async () => {
    offerSend = await mkSend(q.id, clientId, contact, { createdBy: owner });
  });
  await step("offer_links", () =>
    run(
      "INSERT INTO offer_links (token_hash, send_id, document_id, version_group_id, client_id, contact_id, email, purpose, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'a@example.test', 'offer', 9999999999999)",
      H("1"),
      offerSend,
      q.id,
      q.groupId,
      clientId,
      contact,
    ),
  );

  // an issued invoice with its reminder, link and an approval on a care draft
  const invoice = await mkIssued(clientId);
  await step("reminders", () => mkReminder(invoice, 0, Date.now() + 86_400_000));
  await step("doc_access_tokens", async () => {
    const s = await mkSend(invoice, clientId, contact, { createdBy: owner });
    await run(
      "INSERT INTO doc_access_tokens (token_hash, document_id, purpose, expires_at, contact_id, client_id, email, send_id) VALUES (?1, ?2, 'view_pay', 9999999999999, ?3, ?4, 'a@example.test', ?5)",
      H("2"),
      invoice,
      contact,
      clientId,
      s,
    );
  });
  // care: plan, terms, status, the billed period's draft and its approval
  await step("care_plans", async () => {
    const plan = await mkCarePlan(clientId, owner);
    const draft = await mkCareDraft(plan);
    await run(
      "INSERT INTO approvals (id, kind, document_id, requested_by, content_sha256, status) VALUES (?1, 'issue', ?2, ?3, ?4, 'pending')",
      uuidv7(),
      draft,
      owner,
      H("h"),
    );
    await run(
      "INSERT INTO time_logs (id, user_id, work_date, minutes, project_id, care_plan_id, billable, created_at, updated_at) VALUES (?1, ?2, '2026-01-06', 30, NULL, ?3, 1, 1000, 1000)",
      uuidv7(),
      owner,
      plan.planId,
    );
  });

  // money in: a confirmed payment with its receipt, an allocation, an advice; a notice; a proforma's advance
  const { paymentId } = await mkReceipt(clientId);
  await step("payment_allocations", () =>
    run(
      "INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_at) VALUES (?1, ?2, ?3, 1000, 'allocate', 2000)",
      uuidv7(),
      paymentId,
      invoice,
    ),
  );
  await step("payment_notices", () =>
    run(
      `INSERT INTO payment_notices (id, client_id, document_id, contact_id, via, amount_minor, currency, paid_on, reference, reference_norm, note, status)
       VALUES (?1, ?2, ?3, ?4, 'portal', 1000, 'INR', '2026-11-04', 'UTR1', 'UTR1', 'Paid by NEFT', 'open')`,
      uuidv7(),
      clientId,
      invoice,
      contact,
    ),
  );
  await step("advance_receipts", async () => {
    const proforma = await mkIssued(clientId, { type: "proforma" });
    const advanceInvoice = await mkIssued(clientId, { parentId: proforma });
    await run(
      `INSERT INTO advance_receipts (id, proforma_id, invoice_id, client_id, currency, amount_minor, received_on, reference_norm, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, 'INR', 118000, '2026-10-28', 'ADV1', ?5, 2000)`,
      uuidv7(),
      proforma,
      advanceInvoice,
      clientId,
      owner,
    );
  });

  // gateway: an event, a checkout, a review item; reconciliation: a settlement, its line and a bank match; a refund
  await step("webhook_events", () =>
    run(
      "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, facts) VALUES (?1, 'razorpay', ?2, 'payment_link.paid', 2000, 'received', '{}')",
      uuidv7(),
      `evt_${uuidv7().slice(-12)}`,
    ),
  );
  await step("checkout_sessions", () =>
    run(
      `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
       VALUES (?1, 'razorpay', ?2, ?3, ?4, 'staff', 'INR', 50000, 'creating', ?5, 2000, 2000)`,
      uuidv7(),
      invoice,
      clientId,
      owner,
      Date.now() + 86_400_000,
    ),
  );
  await step("review_items", () =>
    run(
      "INSERT INTO review_items (id, source, provider, kind, status, client_id, amount_minor, currency, facts, created_at) VALUES (?1, 'webhook', 'razorpay', 'amount_mismatch', 'open', ?2, 1000, 'INR', '{}', 2000)",
      uuidv7(),
      clientId,
    ),
  );
  const settlement = uuidv7();
  await step("settlements", () =>
    run(
      "INSERT INTO settlements (id, provider, settlement_id, currency, amount_minor, fees_minor, tax_minor, settled_on, fetched_at) VALUES (?1, 'razorpay', ?2, 'INR', 9764, 200, 36, '2026-11-02', 1)",
      settlement,
      `setl_${uuidv7().slice(-8)}`,
    ),
  );
  await step("settlement_items", () =>
    run(
      "INSERT INTO settlement_items (id, settlement_id, provider, entity_type, entity_id, direction, amount_minor, fee_minor, tax_minor, match) VALUES (?1, ?2, 'razorpay', 'payment', 'pay_X', 'credit', 10000, 200, 36, 'unmatched')",
      uuidv7(),
      settlement,
    ),
  );
  await step("bank_matches", () =>
    run(
      "INSERT INTO bank_matches (id, target_kind, payment_id, settlement_id, refund_id, statement_on, matched_by, matched_at) VALUES (?1, 'settlement', NULL, ?2, NULL, '2026-11-03', ?3, 1)",
      uuidv7(),
      settlement,
      owner,
    ),
  );
  await step("payment_refunds", () =>
    run(
      `INSERT INTO payment_refunds (id, payment_id, client_id, provider, origin, status, mode, paid_to, reason_code, currency, amount_minor, reference_norm, paid_on,
         requested_by, requested_at, attempts, settled_at, settled_on, updated_at)
       VALUES (?1, ?2, ?3, 'manual', 'owner', 'succeeded', 'neft', 'own_account', 'overpayment', 'INR', 100, ?4, '2026-11-02', ?5, 3000, 0, 3000, '2026-11-02', 3000)`,
      uuidv7(),
      paymentId,
      clientId,
      `UTR${next()}`,
      owner,
    ),
  );

  // exports: an export invoice in USD with an extension and a reduction (a USD client of its own)
  await step("realisation_extensions", async () => {
    const usd = uuidv7();
    const n = next();
    await run(
      `INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, currency) VALUES (?1, ?2, 'Overseas Co', 'Overseas Co', 'business', 'US', 'overseas', 'USD')`,
      usd,
      `C-U${String(n).padStart(5, "0")}`,
    );
    const exp = uuidv7();
    await run(
      `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, content_sha256, updated_at)
       VALUES (?1, 'export_invoice', 'issued', ?2, 'USD', 'usd-r', '9999', ?3, ?4, 1000, '2026-10-28', '2026-11-04', 50000, 50000, 50000, 50000, ?5, 7000)`,
      exp,
      usd,
      n,
      `U/${n}`,
      H("h"),
    );
    await run(
      "INSERT INTO realisation_extensions (id, document_id, extended_to, bank_ref, recorded_by) VALUES (?1, ?2, '2028-04-28', 'ADB/EXT/1', ?3)",
      uuidv7(),
      exp,
      owner,
    );
    await run(
      "INSERT INTO realisation_reductions (id, document_id, currency, amount_minor, approved_on, bank_ref, recorded_by) VALUES (?1, ?2, 'USD', 1000, '2026-11-03', 'ADB/REG6/1', ?3)",
      uuidv7(),
      exp,
      owner,
    );
    // a bank transfer from abroad and its remittance advice (M6.4)
    const usdPay = await mkReceipt(usd, { currency: "USD", amount: 50_000 });
    const advice = uuidv7();
    await run(
      "INSERT INTO realisation_advices (id, provider, kind, advice_ref, issued_on, recorded_by) VALUES (?1, 'bank', 'efira', 'R-1', '2026-11-02', ?2)",
      advice,
      owner,
    );
    await run(
      "INSERT INTO realisation_advice_payments (id, advice_id, payment_id, created_by) VALUES (?1, ?2, ?3, ?4)",
      uuidv7(),
      advice,
      usdPay.paymentId,
      owner,
    );
  });

  // reference data
  await step("fx_rates", () =>
    run(
      "INSERT INTO fx_rates (id, date, pair, rate_micros, source, entered_by) VALUES (?1, '2026-10-28', 'USD/INR', 84000000, 'manual', ?2)",
      uuidv7(),
      owner,
    ),
  );
  await step("bank_accounts", () =>
    run(
      "INSERT INTO bank_accounts (id, kind, account_name, account_no, ifsc, bank_name, active) VALUES (?1, 'INR', 'TecHaust Technologies', '000000000000', 'ABCD0000001', 'Example Bank', 0)",
      uuidv7(),
    ),
  );
  if (failed.length) throw new Error(`seedMoney could not seed:\n${failed.join("\n")}`);
}
