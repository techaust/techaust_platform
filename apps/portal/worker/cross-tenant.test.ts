// M7.1 cross-tenant suite [POR-03, POR-04, POR-07, POR-08; run file I]: every M7.1 route that takes an id runs through the shared `crossTenant` harness on the
// fixtures' M7.1 rows (my thing is served; another organisation's, a made-up and a hidden one are one and the same 404; a finance route is the same 404 without
// finance). scope.test.ts classifies every guarded route and checks this file holds each case it names. Also here: no answer of any signed-in GET ever holds
// an internal note's words (the canary), the finance keys are ABSENT for a contact without finance, and every public row is health, sign-in or a token.
import { describe, expect, it } from "vitest";
import { fixtures, INTERNAL_CANARY } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import { createApp } from "./index.ts";
import { call, crossTenant, sessionFor } from "./test-helpers.ts";

const app = createApp();
let ref = 0;
const today = () => new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);

describe("cross-tenant: M7.1's routes that take an id [POR-03]", () => {
  crossTenant(
    app,
    [
      { name: "GET /projects/:id", request: (id) => ({ path: `/projects/${id}` }) },
      // early check 2, finding 6: the milestones' follow-up page is scoped like the first
      { name: "GET /projects/:id?after=", request: (id) => ({ path: `/projects/${id}?after=1` }) },
    ],
    fixtures,
    (f) => f.a.portal.project,
    (f) => f.b.portal.project,
  );
  crossTenant(
    app,
    [
      { name: "GET /notes?project=", request: (id) => ({ path: `/notes?project=${id}` }) },
      { name: "GET /files?project=", request: (id) => ({ path: `/files?project=${id}` }) },
    ],
    fixtures,
    (f) => f.a.portal.project,
    (f) => f.b.portal.project,
  );
  crossTenant(
    app,
    [
      {
        name: "GET /files/:id/download",
        request: (id) => ({ path: `/files/${id}/download` }),
        // an unshared file of my own organisation is the same 404
        hidden: (f) => [f.a.portal.unsharedFile],
      },
    ],
    fixtures,
    (f) => f.a.portal.sharedFile,
    (f) => f.b.portal.sharedFile,
  );
  crossTenant(
    app,
    [
      {
        name: "GET /receipts/:id/pdf",
        request: (id) => ({ path: `/receipts/${id}/pdf` }),
        finance: true,
        // an id of my own organisation's that is not a receipt (an invoice) is the same 404
        hidden: (f) => [f.a.portal.payable],
      },
    ],
    fixtures,
    (f) => f.a.portal.receipt,
    (f) => f.b.portal.receipt,
  );
  crossTenant(
    app,
    [
      {
        name: "GET /invoices/:id/pdf (a credit note)",
        request: (id) => ({ path: `/invoices/${id}/pdf` }),
        finance: true,
      },
    ],
    fixtures,
    (f) => f.a.portal.creditNote,
    (f) => f.b.portal.creditNote,
  );
  crossTenant(
    app,
    [
      {
        name: "POST /invoices/:id/paid-notice",
        request: (id) => ({
          path: `/invoices/${id}/paid-notice`,
          init: { body: { amountMinor: 100, paidOn: today(), reference: `XT${++ref}` } },
        }),
        finance: true,
        hidden: (f) => [f.a.docs.draft, f.a.docs.pending, f.a.docs.void],
      },
    ],
    fixtures,
    (f) => f.a.portal.payable,
    (f) => f.b.portal.payable,
  );
});

describe("shared items: an internal note never reaches the client [POR-08, ADM-PRJ-03]", () => {
  it("no signed-in GET answer, for a finance contact or a plain one, holds an internal note's words or any R2 key", async () => {
    const f = await fixtures();
    for (const who of [f.a.finance, f.a.plain]) {
      const s = await sessionFor(who);
      for (const path of [
        "/home",
        "/projects",
        `/projects/${f.a.portal.project}`,
        `/projects/${f.a.portal.doneProject}`,
        "/notes",
        `/notes?project=${f.a.portal.project}`,
        "/files",
        `/files?project=${f.a.portal.project}`,
        "/profile",
        "/receipts",
        "/invoices",
        "/offers",
      ]) {
        const res = await call(path, { cookie: s.cookie });
        const text = await res.text();
        expect(text, `${who.name} ${path}`).not.toContain(INTERNAL_CANARY);
        expect(text, `${who.name} ${path}`).not.toContain("files/");
        expect(text, `${who.name} ${path}`).not.toContain("docs/");
      }
    }
  });
});

describe("can see finance [POR-03, RB-31]: no money key for a contact without finance", () => {
  it("Home: invoices to pay and receipts are null; the finance contact gets them", async () => {
    const f = await fixtures();
    const plain = (await (
      await call("/home", { cookie: (await sessionFor(f.a.plain)).cookie })
    ).json()) as Record<string, unknown>;
    expect(plain.toPay).toBeNull();
    expect(plain.receipts).toBeNull();
    const fin = (await (
      await call("/home", { cookie: (await sessionFor(f.a.finance)).cookie })
    ).json()) as Record<string, unknown[]>;
    expect(Array.isArray(fin.toPay)).toBe(true);
    expect(fin.receipts?.map((r) => (r as { id: string }).id)).toContain(f.a.portal.receipt);
  });

  it("the project page: milestones carry no amountMinor, currency or invoice key without finance; with finance, the invoice is named", async () => {
    const f = await fixtures();
    const read = async (who: typeof f.a.plain) =>
      (
        (await (
          await call(`/projects/${f.a.portal.project}`, { cookie: (await sessionFor(who)).cookie })
        ).json()) as { milestones: Record<string, unknown>[] }
      ).milestones;
    const plain = await read(f.a.plain);
    expect(plain).toHaveLength(2);
    for (const m of plain) {
      for (const k of ["amountMinor", "currency", "invoice"]) expect(Object.keys(m)).not.toContain(k);
    }
    const fin = await read(f.a.finance);
    expect(fin.map((m) => m.amountMinor)).toEqual([50000, 118000]);
    expect(fin[1]?.invoice).toMatchObject({ id: f.a.docs.issued });
    expect(fin[0]?.invoice).toBeNull();
  });

  it("every finance row is a 404 for a contact without finance (the guard)", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    for (const [path, body] of [
      ["/receipts", undefined],
      [`/receipts/${f.a.portal.receipt}/pdf`, undefined],
      [`/invoices/${f.a.docs.issued}/paid-notice`, { amountMinor: 1, paidOn: today(), reference: "NOFIN1" }],
    ] as const) {
      const res = await call(path, { cookie: s.cookie, ...(body ? { body } : {}) });
      expect(res.status, path).toBe(404);
    }
  });
});

describe("the public rows [POR-03; run file I PUBLIC_CASES]", () => {
  it("every public row is the health check, a sign-in route, a token route (the token in the body) or PayPal's return (a state only)", () => {
    for (const r of ROUTES.filter((x) => x.access === "public"))
      expect(r.path, r.path).toMatch(
        /^\/api\/v1\/(health|auth\/(magic|magic\/verify|logout)|t\/|pay\/paypal\/return)$|^\/api\/v1\/t\//,
      );
    // M7.1 adds exactly one public row, a token route, a POST.
    expect(ROUTES.find((r) => r.path === "/api/v1/t/document/paid-notice")).toMatchObject({
      method: "POST",
      access: "public",
      audit: "payment.notice",
    });
  });
});
