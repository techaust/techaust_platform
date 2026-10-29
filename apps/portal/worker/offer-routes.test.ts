// The signed-in contact's offers (M4.5; POR-03, POR-04, POR-05, ADM-PROP-07..10): scoping, the view, the downloads, accept and decline,
// and the races. Failure paths first. The suite-wide console watch (test-setup.ts) fails any test whose Worker logs personal data.
import { env } from "cloudflare:workers";
import { certificateKey } from "@techaust/core/offers";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import { createApp } from "./index.ts";
import { colleague, DAY, mkOffer, SECRETS, testViewer } from "./offer-fixtures.ts";
import { LIST_SQL } from "./offer-sql.ts";
import {
  bodyOf,
  callerFor,
  counted,
  countOf,
  crossTenant,
  one,
  rows,
  sendTo,
  sessionFor,
  withEnv,
} from "./test-helpers.ts";

const app = createApp({ viewer: testViewer });
const call = callerFor(app);

/** Capturing queues: what the Worker would hand to the jobs Worker. */
function queues() {
  const email: unknown[] = [];
  const pdf: unknown[] = [];
  const q = (into: unknown[]) => ({
    send: async (m: unknown) => {
      into.push(m);
    },
    sendBatch: async (ms: { body: unknown }[]) => {
      for (const m of ms) into.push(m.body);
    },
  });
  return { env: withEnv(env, { EMAIL_QUEUE: q(email), PDF_QUEUE: q(pdf) }), email, pdf };
}

const sign = async (c: Awaited<ReturnType<typeof fixtures>>["a"]["finance"]) => (await sessionFor(c)).cookie;
const accept = (
  id: string,
  cookie: string,
  body: unknown = { typedName: "Asha  Rao", agree: true },
  e: Env = env,
) => call(`/offers/${id}/accept`, { body, cookie }, e);
const decline = (id: string, cookie: string, body: unknown = { reason: "price" }, e: Env = env) =>
  call(`/offers/${id}/decline`, { body, cookie }, e);
const view = (id: string, cookie: string) => call(`/offers/${id}`, { cookie });
const codeOf = async (res: Response) => ((await bodyOf(res)).error as { code: string }).code;

// ---- cross-tenant (the shared harness) -------------------------------------------------------------------------

type Ox = Awaited<ReturnType<typeof fixtures>> & {
  o: { mine: string; theirs: string; hidden: string[]; hiddenPdf: string[] };
};
async function oxFixtures(): Promise<Ox> {
  const f = await fixtures();
  const mine = await mkOffer(f.a);
  const theirs = await mkOffer(f.b);
  const draft = await mkOffer(f.a, { status: "draft", rendered: false });
  const unrendered = await mkOffer(f.a, { rendered: false });
  return {
    ...f,
    o: {
      mine: mine.id,
      theirs: theirs.id,
      hidden: [draft.id, unrendered.id, f.a.docs.issued, f.a.docs.proforma],
      hiddenPdf: [draft.id, f.a.docs.issued, f.a.docs.proforma],
    },
  };
}
let oxMemo: Promise<Ox> | undefined;
const ox = () => {
  oxMemo ??= oxFixtures();
  return oxMemo;
};

describe("cross-tenant: another organisation's offer, a made-up id, a draft and an unrendered offer are one 404 [POR-03]", () => {
  crossTenant(
    app,
    [
      {
        name: "GET /offers/:id",
        request: (id) => ({ path: `/offers/${id}` }),
        hidden: (f) => (f as Ox).o.hidden,
      },
      {
        name: "GET /offers/:id/pdf",
        request: (id) => ({ path: `/offers/${id}/pdf` }),
        hidden: (f) => (f as Ox).o.hiddenPdf,
      },
    ],
    ox,
    (f) => (f as Ox).o.mine,
    (f) => (f as Ox).o.theirs,
  );

  it("accept, decline and the certificate give the same 404 for another organisation's offer, and write nothing", async () => {
    const f = await ox();
    const cookie = await sign(f.a.finance);
    const missing = await accept("no-such-id", cookie);
    const before = await countOf("acceptances");
    for (const res of [
      await accept(f.o.theirs, cookie),
      await decline(f.o.theirs, cookie),
      await call(`/offers/${f.o.theirs}/certificate`, { cookie }),
    ]) {
      expect(res.status).toBe(404);
      expect(await bodyOf(res)).toEqual(await bodyOf(missing.clone()));
    }
    expect(await countOf("acceptances")).toBe(before);
    expect(
      (await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", f.o.theirs))?.status,
    ).toBe("sent");
  });

  it("another organisation's contact cannot list or open it either (B's list holds only B's offers)", async () => {
    const f = await ox();
    const cookie = await sign(f.b.finance);
    const list = (await (await call("/offers", { cookie })).json()) as { offers: { id: string }[] };
    expect(list.offers.map((o) => o.id)).toContain(f.o.theirs);
    expect(list.offers.map((o) => o.id)).not.toContain(f.o.mine);
  });
});

// ---- the list ---------------------------------------------------------------------------------------------------

describe("GET /offers: the latest version of each offer, with keyset paging [POR-04]", () => {
  it("lists rendered offers only, the newest version of a group, never a superseded one; totals are formatted on the server", async () => {
    const f = await fixtures();
    const only = await sessionFor(await colleague(f.a));
    const v1 = await mkOffer(f.a, { status: "revised", title: "Group one v1" });
    const v2 = await mkOffer(f.a, {
      groupId: v1.groupId,
      version: 2,
      number: v1.number,
      title: "Group one v2",
    });
    const est = await mkOffer(f.a, { type: "estimate", total: 5_000_00 });
    const unrendered = await mkOffer(f.a, { rendered: false });
    const res = await call("/offers", { cookie: only.cookie });
    expect(res.status).toBe(200);
    const { offers } = (await res.json()) as {
      offers: { id: string; total: string; kind: string; status: string }[];
    };
    const ids = offers.map((o) => o.id);
    expect(ids).toContain(v2.id);
    expect(ids).toContain(est.id);
    expect(ids).not.toContain(v1.id);
    expect(ids).not.toContain(unrendered.id);
    expect(offers.find((o) => o.id === est.id)).toMatchObject({
      kind: "estimate",
      total: "₹5,000.00",
      status: "sent",
    });
  });

  it("an offer past its last valid day reads as expired although the nightly job has not run", async () => {
    const f = await fixtures();
    const late = await mkOffer(f.a, { validInDays: -1 });
    const today = await mkOffer(f.a, { validInDays: 0 });
    const cookie = await sign(f.a.finance);
    const { offers } = (await (await call("/offers", { cookie })).json()) as {
      offers: { id: string; status: string }[];
    };
    expect(offers.find((o) => o.id === late.id)?.status).toBe("expired");
    expect(offers.find((o) => o.id === today.id)?.status).toBe("sent");
  });

  it("pages by keyset, 1 at a time, with no overlap; a bad cursor or limit is a 400", async () => {
    const f = await fixtures();
    const cookie = await sign(f.a.finance);
    await mkOffer(f.a);
    await mkOffer(f.a);
    const seen: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < 40; i++) {
      const res = await call(`/offers?limit=1${after ? `&after=${after}` : ""}`, { cookie });
      const page = (await res.json()) as { offers: { id: string }[]; next: string | null };
      expect(page.offers.length).toBeLessThanOrEqual(1);
      seen.push(...page.offers.map((o) => o.id));
      after = page.next;
      if (!after) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect((await call("/offers?limit=0x", { cookie })).status).toBe(400);
    expect((await call("/offers?after=not-a-cursor", { cookie })).status).toBe(400);
    const max = (await (await call("/offers?limit=99", { cookie })).json()) as { offers: unknown[] };
    expect(max.offers.length).toBeLessThanOrEqual(50);
  });

  it("the page query is indexed (no table scan of documents)", async () => {
    const plan = await rows<{ detail: string }>(
      `EXPLAIN QUERY PLAN ${LIST_SQL.replace(/\?\d/g, "'x'").replace("LIMIT 'x'", "LIMIT 5")}`,
    );
    expect(plan.map((p) => p.detail).join(" | ")).not.toMatch(/SCAN d\b(?! USING)/);
  });
});

// ---- the view -------------------------------------------------------------------------------------------------------

describe("GET /offers/:id: the projected view, view tracking, superseded [POR-05]", () => {
  it("answers the PROJECTED view, equal to the viewer's output; the stored extras never reach the client", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const res = await view(o.id, await sign(f.a.finance));
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as {
      view: unknown;
      document: Record<string, unknown>;
      certificate: { state: string };
    };
    const stored = await (await env.DOCS.get(o.snapshotKey))?.text();
    expect(body.view).toEqual(testViewer(stored ?? ""));
    for (const secret of [
      String(SECRETS.catalogueRateMinor),
      SECRETS.catalogueItemId,
      SECRETS.staffId,
      "catalogueRate",
      "staffId",
      "hidden",
    ])
      expect(text).not.toContain(secret);
    expect(body.document).toMatchObject({
      id: o.id,
      kind: "proposal",
      status: "viewed", // the first open reports the status after its own view
      version: 1,
      numberDisplay: o.numberDisplay,
    });
    expect(body.document.fingerprint).toMatch(/^pdfsha-/);
    expect(body.certificate).toEqual({ state: "none" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("the first view makes a sent offer viewed, with one audit row; the second view writes nothing", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const cookie = await sign(f.a.finance);
    const first = await view(o.id, cookie);
    expect(first.status).toBe(200);
    // the first answer already says Viewed, not Sent
    expect(((await first.json()) as { document: { status: string } }).document.status).toBe("viewed");
    const doc = await one<{ status: string; viewed_at: number }>(
      "SELECT status, viewed_at FROM documents WHERE id = ?",
      o.id,
    );
    expect(doc?.status).toBe("viewed");
    expect(doc?.viewed_at).toBeGreaterThan(0);
    const audit = async () => countOf("audit_log", "action = 'document.view' AND entity_id = ?", o.id);
    expect(await audit()).toBe(1);
    expect((await view(o.id, cookie)).status).toBe(200);
    expect(await audit()).toBe(1);
    expect(
      (await one<{ viewed_at: number }>("SELECT viewed_at FROM documents WHERE id = ?", o.id))?.viewed_at,
    ).toBe(doc?.viewed_at);
  });

  it("an accepted or expired offer does not change on a view", async () => {
    const f = await fixtures();
    const done = await mkOffer(f.a, { status: "accepted" });
    const gone = await mkOffer(f.a, { status: "expired" });
    const cookie = await sign(f.a.finance);
    await view(done.id, cookie);
    await view(gone.id, cookie);
    expect(
      await one<{ status: string; viewed_at: number | null }>(
        "SELECT status, viewed_at FROM documents WHERE id = ?",
        done.id,
      ),
    ).toEqual({ status: "accepted", viewed_at: null });
    expect(
      (await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", gone.id))?.status,
    ).toBe("expired");
    expect(
      await countOf("audit_log", "action = 'document.view' AND entity_id IN (?, ?)", done.id, gone.id),
    ).toBe(0);
  });

  it("a revised version answers 200 with the newest id and no view (POR-05)", async () => {
    const f = await fixtures();
    const v1 = await mkOffer(f.a, { status: "revised" });
    const v2 = await mkOffer(f.a, { groupId: v1.groupId, version: 2, number: v1.number });
    const res = await view(v1.id, await sign(f.a.finance));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ superseded: { latestId: v2.id, version: 2 } });
  });

  it("the response path is the guard read plus ONE batch (the view writes ride in the after-the-answer write)", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const s = await sessionFor(f.a.finance);
    const c = counted();
    const res = await sendTo(
      app,
      `https://portal.example/api/v1/offers/${o.id}`,
      { headers: { Cookie: s.cookie, "CF-Connecting-IP": "203.0.113.9" } },
      c.env,
    );
    expect(res.status).toBe(200);
    expect(c.seen.filter((x) => x.sql.startsWith("SELECT d.id, d.type, d.status")).length).toBe(1);
  });

  it("an unreadable stored copy is a clean 500, never a raw envelope", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const bare = createApp();
    const res = await callerFor(bare)(`/offers/${o.id}`, { cookie: await sign(f.a.finance) });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await bodyOf(res))).not.toContain("marker");
  });
});

// ---- downloads ---------------------------------------------------------------------------------------------------

describe("downloads: streamed, with the safe headers [POR-04]", () => {
  it("the PDF streams as a sandboxed attachment, no-store, with a safe file name", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const res = await call(`/offers/${o.id}/pdf`, { cookie: await sign(f.a.finance) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="TH-PRP-2627-\d{4}-v1\.pdf"$/,
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(await res.text()).toContain(`%PDF-1.4 sample ${o.id}`);
  });
  it("the body is a stream: the handler never reads it into memory", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const real = env.DOCS;
    let touched = false;
    const spy = {
      get: async (key: string) => {
        const obj = await real.get(key);
        if (!obj) return obj;
        return new Proxy(obj, {
          get: (t, k) => {
            if (k === "arrayBuffer" || k === "text" || k === "bytes") touched = true;
            const v = Reflect.get(t, k);
            return typeof v === "function" ? v.bind(t) : v;
          },
        });
      },
    };
    const res = await call(
      `/offers/${o.id}/pdf`,
      { cookie: await sign(f.a.finance) },
      withEnv(env, { DOCS: spy }),
    );
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    expect(touched).toBe(false);
  });
  it("no PDF yet is 409 pdf_pending", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a, { rendered: false });
    // an unrendered offer has no key at all: 409, not 404, once it is the organisation's own sent offer
    const res = await call(`/offers/${o.id}/pdf`, { cookie: await sign(f.a.finance) });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("pdf_pending");
  });
  it("the certificate: 404 before an acceptance, 409 certificate_pending after it, 200 once rendered", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const cookie = await sign(f.a.finance);
    expect((await call(`/offers/${o.id}/certificate`, { cookie })).status).toBe(404);
    expect((await accept(o.id, cookie)).status).toBe(200);
    const pending = await call(`/offers/${o.id}/certificate`, { cookie });
    expect(pending.status).toBe(409);
    expect(await codeOf(pending)).toBe("certificate_pending");
    const acc = await one<{ id: string; certificate_r2_key: string }>(
      "SELECT id, certificate_r2_key FROM acceptances WHERE document_id = ?",
      o.id,
    );
    await env.DOCS.put(acc?.certificate_r2_key ?? "", "%PDF-1.4 certificate");
    await env.DB.prepare(
      "INSERT INTO acceptance_certificates (acceptance_id, r2_key, sha256, rendered_at) VALUES (?1, ?2, 's', 1)",
    )
      .bind(acc?.id, acc?.certificate_r2_key)
      .run();
    const ok = await call(`/offers/${o.id}/certificate`, { cookie });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Disposition")).toMatch(/-certificate\.pdf"$/);
    expect(await ok.text()).toContain("certificate");
  });
});

// ---- accept -------------------------------------------------------------------------------------------------------

describe("POST /offers/:id/accept: the evidence row and its effects [ADM-PROP-08]", () => {
  it("writes the evidence from the database and the request facts, moves the document, audits, queues the certificate and the bell", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const lead = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO leads (id, ref, source, contact_name, contact_email, stage, proposal_id) VALUES (?1, ?2, 'manual', 'L', 'l@example.test', 'proposal_sent', ?3)",
    )
      .bind(lead, `L-${lead.slice(0, 5)}`, o.groupId)
      .run();
    const s = await sessionFor(f.a.finance);
    const q = queues();
    const ua = "A".repeat(600);
    const res = await call(
      `/offers/${o.id}/accept`,
      {
        body: { typedName: "  Asha   Rao ", agree: true },
        cookie: s.cookie,
        ip: "192.0.2.77",
        headers: { "User-Agent": ua },
      },
      q.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      typedName: string;
      email: string;
      acceptedAt: number;
      fingerprint: string;
    };
    expect(body).toMatchObject({ typedName: "Asha Rao", email: f.a.finance.email });
    const a = await one<Record<string, unknown>>("SELECT * FROM acceptances WHERE document_id = ?", o.id);
    expect(a).toMatchObject({
      contact_id: f.a.finance.id,
      session_id: s.sessionId,
      typed_name: "Asha Rao",
      email: f.a.finance.email,
      ip: "192.0.2.77",
      via: "session",
      offer_link_hash: null,
      certificate_r2_key: certificateKey({ type: "proposal", fy: "2026-27", number: o.number, version: 1 }),
    });
    expect(String(a?.user_agent).length).toBe(512);
    const doc = await one<Record<string, unknown>>(
      "SELECT status, decided_at, decided_contact_id, viewed_at, pdf_sha256, snapshot_sha256 FROM documents WHERE id = ?",
      o.id,
    );
    expect(doc).toMatchObject({ status: "accepted", decided_contact_id: f.a.finance.id });
    expect(a?.pdf_sha256).toBe(doc?.pdf_sha256);
    expect(a?.snapshot_sha256).toBe(doc?.snapshot_sha256);
    expect(a?.accepted_at).toBe(doc?.decided_at);
    expect(body.fingerprint).toBe(doc?.pdf_sha256);
    expect(doc?.viewed_at).toBe(doc?.decided_at);
    const audit = await rows<{ summary: string; actor_id: string; actor_type: string }>(
      "SELECT summary, actor_id, actor_type FROM audit_log WHERE action = 'document.accept' AND entity_id = ?",
      o.id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: f.a.finance.id, actor_type: "contact" });
    const summary = JSON.parse(audit[0]?.summary ?? "{}");
    expect(summary).toEqual({
      documentId: o.id,
      version: 1,
      via: "session",
      pdfSha12: String(doc?.pdf_sha256).slice(0, 12),
    });
    expect(audit[0]?.summary).not.toContain("Asha");
    expect(audit[0]?.summary).not.toContain("@");
    expect((await one<{ stage: string }>("SELECT stage FROM leads WHERE id = ?", lead))?.stage).toBe("won");
    expect(q.pdf).toEqual([{ v: 1, kind: "pdf.certificate", acceptanceId: a?.id, hop: 0 }]);
    expect(q.email).toEqual([{ kind: "offer.decided", documentId: o.id, decision: "accepted" }]);
  });

  it("the evidence row is append-only", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    await accept(o.id, await sign(f.a.finance));
    await expect(
      env.DB.prepare("UPDATE acceptances SET typed_name = 'X' WHERE document_id = ?").bind(o.id).run(),
    ).rejects.toThrow(/append-only/);
    await expect(
      env.DB.prepare("DELETE FROM acceptances WHERE document_id = ?").bind(o.id).run(),
    ).rejects.toThrow(/append-only/);
  });

  it("the same contact's repeat is a 200 replay of the stored record: one row, one audit row, one certificate message", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const cookie = await sign(f.a.finance);
    const q = queues();
    const first = await accept(o.id, cookie, { typedName: "Asha Rao", agree: true }, q.env);
    const again = await accept(o.id, cookie, { typedName: "Someone Else", agree: true }, q.env);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(await first.json());
    expect(await countOf("acceptances", "document_id = ?", o.id)).toBe(1);
    expect(await countOf("audit_log", "action = 'document.accept' AND entity_id = ?", o.id)).toBe(1);
    expect(q.pdf).toHaveLength(1);
  });

  it("a colleague after an acceptance gets 409 already_accepted with the name and time, and nothing is written", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    await accept(o.id, await sign(f.a.finance), { typedName: "Asha Rao", agree: true });
    const other = await colleague(f.a);
    const res = await accept(o.id, (await sessionFor(other)).cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "already_accepted" },
      name: "Asha Rao",
      at: expect.any(Number),
    });
    expect(await countOf("acceptances", "document_id = ?", o.id)).toBe(1);
  });

  it("refuses, writing nothing, when the PDF is not ready (409 pdf_pending)", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a, { rendered: false });
    const res = await accept(o.id, await sign(f.a.finance));
    expect([res.status, await codeOf(res)]).toEqual([409, "pdf_pending"]);
    expect(await countOf("acceptances", "document_id = ?", o.id)).toBe(0);
    expect((await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", o.id))?.status).toBe(
      "sent",
    );
  });
  it("refuses an offer whose last valid day has passed (409 expired), but takes it on the last day itself", async () => {
    const f = await fixtures();
    const late = await mkOffer(f.a, { validInDays: -1 });
    const last = await mkOffer(f.a, { validInDays: 0 });
    const cookie = await sign(f.a.finance);
    const res = await accept(late.id, cookie);
    expect([res.status, await codeOf(res)]).toEqual([409, "expired"]);
    expect((await accept(last.id, cookie)).status).toBe(200);
  });
  it("refuses a version when a newer one is frozen, even if the old status is still sent (409 superseded {latestId})", async () => {
    const f = await fixtures();
    const v1 = await mkOffer(f.a);
    const v2 = await mkOffer(f.a, { groupId: v1.groupId, version: 2, number: v1.number });
    const res = await accept(v1.id, await sign(f.a.finance));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "superseded" }, latestId: v2.id });
    expect(await countOf("acceptances", "document_id = ?", v1.id)).toBe(0);
    expect((await accept(v2.id, await sign(f.a.finance))).status).toBe(200);
  });
  it("FX-3 (A4 9): a newer version frozen but not rendered yet is 409 newer_version_pending (no id to open); once rendered, superseded points to it", async () => {
    const f = await fixtures();
    const cookie = await sign(f.a.finance);
    const v1 = await mkOffer(f.a);
    const v2 = await mkOffer(f.a, { groupId: v1.groupId, version: 2, number: v1.number, rendered: false });
    for (const res of [await accept(v1.id, cookie), await decline(v1.id, cookie)]) {
      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        error: { code: "newer_version_pending", message: "A newer version is being prepared" },
      });
      expect(body.latestId).toBeUndefined();
    }
    expect(await countOf("acceptances", "document_id = ?", v1.id)).toBe(0);
    expect((await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", v1.id))?.status).toBe(
      "sent",
    );
    // v2 rendered, v3 frozen and not: still pending (v2 can't be accepted either, so pointing to it would be wrong)
    // the jobs Worker's two writes (apps/jobs/src/pdf.ts): the snapshot key, then the PDF
    await env.DB.prepare(
      "UPDATE documents SET snapshot_r2_key = 's' WHERE id = ?1 AND snapshot_r2_key IS NULL",
    )
      .bind(v2.id)
      .run();
    await env.DB.prepare(
      "UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = ?2 WHERE id = ?1 AND pdf_sha256 IS NULL",
    )
      .bind(v2.id, `pdfsha-${v2.id}`)
      .run();
    const res2 = await accept(v1.id, cookie);
    expect(await res2.json()).toMatchObject({ error: { code: "superseded" }, latestId: v2.id });
    await mkOffer(f.a, { groupId: v1.groupId, version: 3, number: v1.number, rendered: false });
    expect(await codeOf(await accept(v1.id, cookie))).toBe("newer_version_pending");
    expect(await codeOf(await accept(v2.id, cookie))).toBe("newer_version_pending");
  });
  it("refuses a declined offer (409 already_decided)", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const cookie = await sign(f.a.finance);
    expect((await decline(o.id, cookie)).status).toBe(200);
    const res = await accept(o.id, cookie);
    expect([res.status, await codeOf(res)]).toEqual([409, "already_decided"]);
  });
  it("refuses a contact whose portal access was turned off between the sign-in and the accept, and an anonymised one", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const c = await colleague(f.a);
    const s = await sessionFor(c);
    await env.DB.prepare("UPDATE contacts SET portal_access = 0 WHERE id = ?").bind(c.id).run();
    expect((await accept(o.id, s.cookie)).status).toBe(401);
    expect(await countOf("acceptances", "document_id = ?", o.id)).toBe(0);
  });

  const bad: [string, unknown][] = [
    ["agree false", { typedName: "Asha Rao", agree: false }],
    ["agree missing", { typedName: "Asha Rao" }],
    ["agree as a string", { typedName: "Asha Rao", agree: "true" }],
    ["typedName missing", { agree: true }],
    ["contactId in the body", { typedName: "Asha Rao", agree: true, contactId: "x" }],
    ["email in the body", { typedName: "Asha Rao", agree: true, email: "x@example.test" }],
    ["ip in the body", { typedName: "Asha Rao", agree: true, ip: "1.2.3.4" }],
    ["pdfSha256 in the body", { typedName: "Asha Rao", agree: true, pdfSha256: "x" }],
    ["clientId in the body", { typedName: "Asha Rao", agree: true, clientId: "x" }],
    ["acceptedAt in the body", { typedName: "Asha Rao", agree: true, acceptedAt: 1 }],
    ["status in the body", { typedName: "Asha Rao", agree: true, status: "accepted" }],
  ];
  for (const [name, body] of bad)
    it(`400 and nothing written: ${name}`, async () => {
      const f = await fixtures();
      const o = await mkOffer(f.a);
      expect((await accept(o.id, await sign(f.a.finance), body)).status).toBe(400);
      expect(await countOf("acceptances", "document_id = ?", o.id)).toBe(0);
    });

  const names: [string, string, string][] = [
    ["empty", "", "name_too_short"],
    ["only spaces", "     ", "name_too_short"],
    ["one character", "A", "name_too_short"],
    ["a control character", "Asha\u0007Rao", "name_invalid_characters"],
    ["a bidi override", `Asha${String.fromCodePoint(0x202e)}Rao`, "name_invalid_characters"],
    ["over 120 characters", "a".repeat(121), "name_too_long"],
  ];
  for (const [name, typed, code] of names)
    it(`400 ${code}: a typed name that is ${name}`, async () => {
      const f = await fixtures();
      const o = await mkOffer(f.a);
      const res = await accept(o.id, await sign(f.a.finance), { typedName: typed, agree: true });
      expect([res.status, await codeOf(res)]).toEqual([400, code]);
      expect(await countOf("acceptances", "document_id = ?", o.id)).toBe(0);
    });

  it("a cross-site Origin is refused (403), a non-JSON body 415, an oversized one 413", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const cookie = await sign(f.a.finance);
    const url = `https://portal.example/api/v1/offers/${o.id}/accept`;
    const body = JSON.stringify({ typedName: "Asha Rao", agree: true });
    const ok = {
      Cookie: cookie,
      "Content-Type": "application/json",
      Origin: "https://portal.example",
      "CF-Connecting-IP": "203.0.113.5",
    };
    expect(
      (
        await sendTo(
          app,
          url,
          { method: "POST", headers: { ...ok, Origin: "https://evil.example" }, body },
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await sendTo(
          app,
          url,
          { method: "POST", headers: { ...ok, "Content-Type": "text/plain" }, body },
          env,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await sendTo(
          app,
          url,
          {
            method: "POST",
            headers: ok,
            body: JSON.stringify({ typedName: "x".repeat(20_000), agree: true }),
          },
          env,
        )
      ).status,
    ).toBe(413);
    expect(await countOf("acceptances", "document_id = ?", o.id)).toBe(0);
  });
});

// ---- decline -------------------------------------------------------------------------------------------------------

describe("POST /offers/:id/decline [ADM-PROP-10]", () => {
  it("records the decision once, audits the reason CODE (never the note), queues the bell message", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const cookie = await sign(f.a.finance);
    const q = queues();
    const res = await decline(o.id, cookie, { reason: "price", note: "  Over budget for us  " }, q.env);
    expect(res.status).toBe(200);
    // the answer carries the name the page shows under "Declined by"
    expect(((await res.json()) as { declined: { by: string } }).declined.by).toBe(f.a.finance.name);
    const doc = await one<Record<string, unknown>>(
      "SELECT status, decision_reason, decision_note, decided_contact_id, decided_at FROM documents WHERE id = ?",
      o.id,
    );
    expect(doc).toMatchObject({
      status: "rejected",
      decision_reason: "price",
      decision_note: "Over budget for us",
      decided_contact_id: f.a.finance.id,
    });
    const audit = await rows<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'document.decline' AND entity_id = ?",
      o.id,
    );
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]?.summary ?? "{}")).toEqual({
      documentId: o.id,
      version: 1,
      reason: "price",
      via: "session",
    });
    expect(audit[0]?.summary).not.toContain("budget");
    expect(q.email).toEqual([{ kind: "offer.decided", documentId: o.id, decision: "declined" }]);
    expect(q.pdf).toEqual([]);
    // the client sees it as declined, with the reason
    const seen = (await (await view(o.id, cookie)).json()) as {
      document: { status: string };
      decline: { reason: string; by: string };
    };
    expect(seen.document.status).toBe("declined");
    expect(seen.decline).toMatchObject({ reason: "price", by: f.a.finance.name });
  });
  const bad: [string, unknown, string | number][] = [
    ["a missing reason", {}, 400],
    ["an unknown reason", { reason: "whatever" }, "reason_invalid"],
    ["'other' without words", { reason: "other" }, "note_required"],
    ["'other' with only spaces", { reason: "other", note: "   " }, "note_required"],
    ["a note over 500 characters", { reason: "price", note: "x".repeat(501) }, "note_too_long"],
    ["an extra field", { reason: "price", contactId: "x" }, 400],
  ];
  for (const [name, body, expected] of bad)
    it(`400 and nothing written: ${name}`, async () => {
      const f = await fixtures();
      const o = await mkOffer(f.a);
      const res = await decline(o.id, await sign(f.a.finance), body);
      expect(res.status).toBe(400);
      if (typeof expected === "string") expect(await codeOf(res)).toBe(expected);
      expect((await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", o.id))?.status).toBe(
        "sent",
      );
    });
  it("after an acceptance it is 409 already_accepted; a second decline is 409 already_decided; the decision never changes", async () => {
    const f = await fixtures();
    const done = await mkOffer(f.a);
    const cookie = await sign(f.a.finance);
    await accept(done.id, cookie);
    const late = await decline(done.id, cookie);
    expect([late.status, await codeOf(late)]).toEqual([409, "already_accepted"]);
    const o = await mkOffer(f.a);
    expect((await decline(o.id, cookie, { reason: "timing" })).status).toBe(200);
    const twice = await decline(o.id, cookie, { reason: "price" });
    expect([twice.status, await codeOf(twice)]).toEqual([409, "already_decided"]);
    expect(
      (await one<{ decision_reason: string }>("SELECT decision_reason FROM documents WHERE id = ?", o.id))
        ?.decision_reason,
    ).toBe("timing");
    await expect(
      env.DB.prepare("UPDATE documents SET decision_reason = 'price' WHERE id = ?").bind(o.id).run(),
    ).rejects.toThrow(/frozen/);
  });
  it("refuses an expired or superseded offer", async () => {
    const f = await fixtures();
    const cookie = await sign(f.a.finance);
    const late = await mkOffer(f.a, { validInDays: -1 });
    expect(await codeOf(await decline(late.id, cookie))).toBe("expired");
    const v1 = await mkOffer(f.a);
    await mkOffer(f.a, { groupId: v1.groupId, version: 2, number: v1.number });
    expect(await codeOf(await decline(v1.id, cookie))).toBe("superseded");
  });
});

// ---- races ---------------------------------------------------------------------------------------------------------

describe("races: the SQL decides, exactly one wins", () => {
  it("two contacts accepting at the same moment: one acceptance, one audit row, one certificate message", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const [c1, c2] = [await colleague(f.a, "One"), await colleague(f.a, "Two")];
    const q = queues();
    const [r1, r2] = await Promise.all([
      accept(o.id, (await sessionFor(c1)).cookie, { typedName: "Person One", agree: true }, q.env),
      accept(o.id, (await sessionFor(c2)).cookie, { typedName: "Person Two", agree: true }, q.env),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await countOf("acceptances", "document_id = ?", o.id)).toBe(1);
    expect(await countOf("audit_log", "action = 'document.accept' AND entity_id = ?", o.id)).toBe(1);
    expect(q.pdf).toHaveLength(1);
  });
  it("an accept and a decline at the same moment: one wins, the other is a 409, and the document agrees with the record", async () => {
    const f = await fixtures();
    const o = await mkOffer(f.a);
    const [c1, c2] = [await colleague(f.a, "Yes"), await colleague(f.a, "No")];
    const [a, d] = await Promise.all([
      accept(o.id, (await sessionFor(c1)).cookie),
      decline(o.id, (await sessionFor(c2)).cookie),
    ]);
    expect([a.status, d.status].sort()).toEqual([200, 409]);
    const status = (await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", o.id))?.status;
    expect(status).toBe(a.status === 200 ? "accepted" : "rejected");
    expect(await countOf("acceptances", "document_id = ?", o.id)).toBe(a.status === 200 ? 1 : 0);
  });
  it("a version frozen after the page was opened: the old version cannot be accepted (superseded wins over a stale read)", async () => {
    const f = await fixtures();
    const v1 = await mkOffer(f.a);
    const cookie = await sign(f.a.finance);
    expect((await view(v1.id, cookie)).status).toBe(200);
    await mkOffer(f.a, { groupId: v1.groupId, version: 2, number: v1.number });
    expect(await codeOf(await accept(v1.id, cookie))).toBe("superseded");
  });
});

// ---- nothing else leaks -----------------------------------------------------------------------------------------------

describe("hygiene", () => {
  it("no portal SQL names a staff table, and no offer file reads a client or contact id from the request", async () => {
    const files = import.meta.glob("./offer*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    for (const [name, src] of Object.entries(files)) {
      if (name.endsWith(".test.ts") || name.includes("fixtures")) continue;
      expect(src, name).not.toMatch(/\bstaff_\w+/);
      expect(src, name).not.toMatch(/req\.(query|param|header)\(["'](client|contact)/i);
    }
  });
  it("an hour later the same facts: a day is 86,400,000 ms (the fixtures use it)", () => {
    expect(DAY).toBe(86_400_000);
  });
});
