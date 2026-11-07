// M7.5 (A1 F10, L8): the portal's Pay path (`PortalPayments` → createLinkFor) refuses another client's document for Stripe and PayPal as it does for Razorpay
// (gateway.test.ts): the client comes from the portal session, so a contact of client B naming client A's document, a contact named under another client,
// and a contact without finance all get the same `not_found`, and no checkout is made or reached at the gateway. All data is made up.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { countOf } from "./test-helpers.ts";
import { currentFy, lutOf, putSwiftBank, putTax } from "./test-invoice-types.ts";
import { putBank, putCompany } from "./test-invoices.ts";
import { apiCalls, payPalLink, paypalStub } from "./test-paypal.ts";
import { stripeCalls, stripeLink, stripeStub, usdClient, usdDoc } from "./test-stripe.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});
afterEach(() => setStubTransport(null));

type Link = typeof stripeLink;
const cases: [string, () => void, Link, () => number][] = [
  ["stripe", () => stripeStub(), stripeLink, () => stripeCalls.length],
  ["paypal", () => paypalStub(), payPalLink, () => apiCalls().length],
];

for (const [provider, stub, link, gatewayCalls] of cases) {
  describe(`the portal's Pay with ${provider}: one client's session never pays another client's document [POR-06, L8]`, () => {
    beforeEach(() => stub());

    it("another client's document, a contact of another client and a contact without finance: not_found, no checkout, no gateway call", async () => {
      const a = await usdClient();
      const docA = await usdDoc(a.clientId);
      const b = await usdClient();
      const docB = await usdDoc(b.clientId);
      const checkouts = () => countOf("checkout_sessions", "document_id IN (?1, ?2)", docA, docB);

      // B's contact, signed in to B, names A's document
      const before = gatewayCalls();
      expect(await link(b, docA)).toEqual({ ok: false, error: "not_found" });
      // a contact of B presented under A's client id (a session can't do this; the RPC still refuses it)
      expect(await link({ clientId: a.clientId, contactId: b.contactId }, docA)).toEqual({
        ok: false,
        error: "not_found",
      });
      // B's own document, once B's contact has lost finance access
      await env.DB.prepare("UPDATE contacts SET can_see_finance = 0 WHERE id = ?1").bind(b.contactId).run();
      expect(await link(b, docB)).toEqual({ ok: false, error: "not_found" });
      expect(await checkouts()).toBe(0);
      expect(gatewayCalls()).toBe(before);

      // the control: A's own contact pays A's document
      expect(await link(a, docA)).toMatchObject({ ok: true });
      expect(
        await countOf("checkout_sessions", "document_id = ?1 AND client_id = ?2", docA, a.clientId),
      ).toBe(1);
    });
  });
}
