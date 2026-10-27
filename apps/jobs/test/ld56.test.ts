// LD56 [ADM-INV-15, ADM-PROP-07]: an invoice send is never cancelled by the offer path. M4.5's `offer.send` refuses (and MARKS CANCELLED) any send whose document is not an open
// offer, so before M5.4 a waiting send of an invoice that reached it would have been cancelled for ever. The render step (`queueWaitingSends`), the daily sweep and the offer
// consumer are therefore type-aware: an invoice-family row becomes `invoice.send`, a proposal or estimate stays `offer.send`, and each consumer leaves a row of the other family
// alone (no write at all).
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import {
  processOfferMessage,
  processOfferSend,
  processOfferSweep,
  queueWaitingSends,
} from "../src/offers.ts";
import { handleQueue } from "../src/queue.ts";
import {
  emailsQueued,
  fakes,
  makeEnv,
  mkClient,
  mkContact,
  mkDoc,
  mkSend,
  one,
  staff,
  useFakes,
} from "./billing-fixtures.ts";

useFakes();

const NOW = Date.UTC(2026, 9, 26, 5, 0, 0);

async function invoiceWithWaitingSend(over: Parameters<typeof mkDoc>[2] = {}) {
  const owner = await staff("owner");
  const export_ = over.type === "export_invoice"; // an export invoice is for an overseas client (a trigger)
  const clientId = await mkClient(export_ ? { currency: "USD" } : {});
  const contact = await mkContact(clientId);
  const doc = await mkDoc(clientId, contact, export_ ? { ...over, currency: "USD" } : over);
  const send = await mkSend(doc, clientId, contact, { createdBy: owner.id, createdAt: NOW - 1_000 });
  return { owner, clientId, contact, doc, send };
}

const cancelledAt = async (sendId: string) =>
  (
    await one<{ cancelled_at: number | null }>(
      "SELECT cancelled_at FROM document_sends WHERE id = ?1",
      sendId,
    )
  )?.cancelled_at;

describe("LD56: an invoice send is never cancelled by the offer path", () => {
  it("the render step queues invoice.send for an invoice and never offer.send", async () => {
    const w = await invoiceWithWaitingSend();
    expect(await queueWaitingSends(makeEnv(), w.doc.id, NOW)).toBe(1);
    expect(emailsQueued()).toEqual([{ kind: "invoice.send", sendId: w.send }]);
    expect(await cancelledAt(w.send)).toBeNull();
    const row = await one<{ queued_at: number }>(
      "SELECT queued_at FROM document_sends WHERE id = ?1",
      w.send,
    );
    expect(row?.queued_at).toBe(NOW);
  });

  it("credit notes, debit notes, proformas and export invoices are the same family", async () => {
    for (const type of ["credit_note", "debit_note", "proforma", "export_invoice"] as const) {
      fakes.email.length = 0;
      const w = await invoiceWithWaitingSend({ type });
      await queueWaitingSends(makeEnv(), w.doc.id, NOW);
      expect(emailsQueued(), type).toEqual([{ kind: "invoice.send", sendId: w.send }]);
    }
  });

  it("a proposal's waiting send is still offer.send", async () => {
    const owner = await staff("owner");
    const clientId = await mkClient();
    const contact = await mkContact(clientId);
    const doc = await mkDoc(clientId, contact, { type: "proposal", status: "sent" });
    const send = await mkSend(doc, clientId, contact, { createdBy: owner.id });
    await queueWaitingSends(makeEnv(), doc.id, NOW);
    expect(emailsQueued()).toEqual([{ kind: "offer.send", sendId: send }]);
  });

  it("the sweep picks waiting invoice sends (a rendered invoice with no valid_until) as invoice.send, and proposals as offer.send", async () => {
    const inv = await invoiceWithWaitingSend();
    const w2 = await invoiceWithWaitingSend({ type: "debit_note" });
    const unrendered = await invoiceWithWaitingSend({ rendered: false });
    const voided = await invoiceWithWaitingSend({ status: "void" });
    const out = await processOfferSweep(makeEnv(), { v: 1, kind: "offer.sweep", asOf: NOW });
    const bodies = emailsQueued();
    expect(bodies.filter((b) => b.kind === "offer.send")).toEqual([]);
    const ids = bodies
      .filter((b) => b.kind === "invoice.send")
      .map((b) => (b as unknown as { sendId: string }).sendId);
    expect(ids).toContain(inv.send);
    expect(ids).toContain(w2.send);
    expect(ids).not.toContain(unrendered.send); // no PDF yet: the render step queues it when it exists
    expect(ids).not.toContain(voided.send);
    expect(out.sends).toBeGreaterThanOrEqual(2);
  });

  it("the offer consumer handed an invoice send leaves it alone: acknowledged, nothing written, nothing queued", async () => {
    const w = await invoiceWithWaitingSend();
    const result = await processOfferSend(makeEnv(), { kind: "offer.send", sendId: w.send }, NOW);
    expect(result).toBe("invalid");
    expect(await cancelledAt(w.send)).toBeNull();
    const row = await one<{ queued_at: number | null }>(
      "SELECT queued_at FROM document_sends WHERE id = ?1",
      w.send,
    );
    expect(row?.queued_at).toBeNull();
    expect(fakes.email).toEqual([]);
    expect(await processOfferMessage(makeEnv(), { kind: "offer.send", sendId: w.send } as never, NOW)).toBe(
      "ack",
    );
    expect(await cancelledAt(w.send)).toBeNull();
  });

  it("through the queue: an offer.send body that names an invoice send does not cancel it", async () => {
    const w = await invoiceWithWaitingSend();
    const acked: string[] = [];
    await handleQueue(
      {
        queue: "techaust-platform-email-staging",
        messages: [
          {
            id: uuidv7(),
            body: { kind: "offer.send", sendId: w.send },
            attempts: 1,
            ack: () => acked.push("ack"),
            retry: () => acked.push("retry"),
          },
        ],
      } as never,
      makeEnv(),
    );
    expect(acked).toEqual(["ack"]);
    expect(await cancelledAt(w.send)).toBeNull();
  });
});
