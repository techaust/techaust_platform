// The REAL viewer of the offer page (M4.5 stage B; POR-04, POR-05): the stored copy goes through `@techaust/pdf/view`, so what the client's page shows is
// what the PDF shows. The other offer tests inject a viewer; this file uses the default one with a genuine envelope. Also the lead's decision
// on converted estimates (they read "accepted").
import { env } from "cloudflare:workers";
import { parseEnvelope, serializeEnvelope, toPdfView, warmEnvelope } from "@techaust/pdf";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import { createApp } from "./index.ts";
import { mkLink, mkOffer } from "./offer-fixtures.ts";
import { bodyOf, callerFor, sessionFor } from "./test-helpers.ts";

const call = callerFor(createApp());
const sign = async (c: Awaited<ReturnType<typeof fixtures>>["a"]["finance"]) => (await sessionFor(c)).cookie;

/** An offer whose stored copy is a genuine envelope (written the way the jobs Worker writes it). */
async function realOffer(f: Awaited<ReturnType<typeof fixtures>>, over: Parameters<typeof mkOffer>[1] = {}) {
  const o = await mkOffer(f.a, over);
  const e = warmEnvelope();
  const text = serializeEnvelope(e);
  await env.DOCS.put(o.snapshotKey, text);
  return { o, e, text };
}

describe("the offer page shows the PDF's own view [POR-05]", () => {
  it("the response's view equals toPdfView of the stored copy, field for field", async () => {
    const f = await fixtures();
    const { o, text } = await realOffer(f);
    const res = await call(`/offers/${o.id}`, { cookie: await sign(f.a.finance) });
    expect(res.status).toBe(200);
    const body = (await bodyOf(res)) as { view: unknown };
    const stored = parseEnvelope(text);
    expect(stored).not.toBeNull();
    expect(body.view).toEqual(
      JSON.parse(
        JSON.stringify(toPdfView(stored as NonNullable<typeof stored>, undefined, { longDates: true })),
      ),
    );
  });

  it("the page's dates carry the four-digit year (07-Q M10); the PDF's short form is the package default", async () => {
    const f = await fixtures();
    const { o } = await realOffer(f);
    const res = await call(`/offers/${o.id}`, { cookie: await sign(f.a.finance) });
    const { view } = (await bodyOf(res)) as { view: { issueDate: string; validUntil: string } };
    expect(view.issueDate).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}$/);
    expect(view.validUntil).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}$/);
  });

  it("a link opens the same view; the stored extras never reach the client (a key scan of the whole response)", async () => {
    const f = await fixtures();
    const { o } = await realOffer(f);
    const token = await mkLink(o, f.a.finance);
    const res = await call("/t/offer", { body: { token } });
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const key of [
      "catalogueRateMinor",
      "catalogueItemId",
      "catalogueLine",
      "staffId",
      "computedJson",
      "snapshotSha256",
      '"hidden"',
    ])
      expect(text, key).not.toContain(key);
  });

  it("a stored copy that cannot be read is a clean 500 that shows no stored text", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    await env.DOCS.put(o.snapshotKey, '{"v":1,"marker":"secret-marker"}');
    const res = await call(`/offers/${o.id}`, { cookie: await sign(f.a.finance) });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await bodyOf(res))).not.toContain("secret-marker");
  });
});

describe("a converted estimate stays in the client's list and reads Accepted [lead decision, 2026-10-26]", () => {
  it("the list and the page show accepted; the other client's converted estimate is not visible", async () => {
    const f = await fixtures();
    const { o } = await realOffer(f, { type: "estimate", status: "converted" });
    const theirs = await mkOffer(f.b, { type: "estimate", status: "converted" });
    const cookie = await sign(f.a.finance);
    const list = (await bodyOf(await call("/offers", { cookie }))) as {
      offers: { id: string; status: string }[];
    };
    expect(list.offers.find((x) => x.id === o.id)?.status).toBe("accepted");
    expect(list.offers.some((x) => x.id === theirs.id)).toBe(false);
    const page = (await bodyOf(await call(`/offers/${o.id}`, { cookie }))) as {
      document: { status: string };
    };
    expect(page.document.status).toBe("accepted");
    expect((await call(`/offers/${theirs.id}`, { cookie })).status).toBe(404);
  });

  it("a converted estimate cannot be accepted or declined again (it is already accepted)", async () => {
    const f = await fixtures();
    const { o } = await realOffer(f, { type: "estimate", status: "converted" });
    const cookie = await sign(f.a.finance);
    const accept = await call(`/offers/${o.id}/accept`, {
      body: { typedName: "Asha Rao", agree: true },
      cookie,
    });
    expect(accept.status).toBeGreaterThanOrEqual(400);
    const decline = await call(`/offers/${o.id}/decline`, { body: { reason: "price" }, cookie });
    expect(decline.status).toBeGreaterThanOrEqual(400);
  });
});
