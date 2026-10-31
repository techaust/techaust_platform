// DEV ONLY (main.tsx imports it under import.meta.env.DEV; never in a build): a sample API for the M4.5 screens, so the REAL routes
// and components can be seen in every state on the dev server without a database. It answers `/api/v1/*` from memory once switched
// on for this tab (`?sample=on`, or `?sample=empty` for an organisation with nothing sent; `?sample=off` switches it off), and labels
// every page "Preview — sample data". Nothing is saved or sent.
//
// SAMPLE DATA ONLY (the repo is public): the documents are the PDF package's test fixtures, built through core's real tax engine and
// projected by the real `toPdfView`, so every figure is the engine's. Names are "(sample)" or "Sample …", addresses @example.test, the
// GSTINs are the repo's made-up samples.
import { type Envelope, toPdfView } from "@techaust/pdf/view";
import { buildFixture, type FixtureName } from "../../../../packages/pdf/test/fixtures/index.ts";
import type { OfferItem, OfferPage, OfferStatus, SignedDeed } from "../api.ts";
import { answerInvoices } from "./sample-invoices.ts";

const KEY = "ta.sample-api";
const ME = {
  contact: { name: "Asha Iyer (sample)", email: "asha.iyer@kestrel.example.test" },
  organisation: { displayName: "Kestrel Distributors (sample)" },
  canSeeFinance: true,
};
const COLLEAGUE = { name: "Rahul Sen (sample)", email: "rahul.sen@kestrel.example.test" };
const DAY = 86_400_000;
const NOW = Date.now();

type Doc = {
  id: string;
  fixture: FixtureName;
  status: OfferStatus;
  sentAt: number;
  acceptance?: OfferPage["acceptance"];
  decline?: OfferPage["decline"];
  certificate?: "none" | "pending" | "ready";
  /** Accept answers this refusal (to show the flow). */
  refuse?: string;
  /** A version replaced by `latest`: GET answers superseded. */
  supersededBy?: string;
  /** Overrides on the fixture: the version and the validity. */
  version?: number;
  validUntil?: string;
};

const DOCS: Doc[] = [
  { id: "sample-sent", fixture: "short-intra-inr", status: "sent", sentAt: NOW - 1 * DAY },
  { id: "sample-estimate", fixture: "intra-estimate", status: "viewed", sentAt: NOW - 2 * DAY },
  { id: "sample-usd", fixture: "usd-export", status: "viewed", sentAt: NOW - 3 * DAY },
  { id: "sample-long", fixture: "long-inter-inr", status: "viewed", sentAt: NOW - 4 * DAY, version: 2 },
  { id: "sample-revised", fixture: "inter-estimate", status: "revised", sentAt: NOW - 5 * DAY },
  { id: "sample-names", fixture: "long-names", status: "sent", sentAt: NOW - 6 * DAY },
  {
    id: "sample-refused",
    fixture: "short-intra-inr",
    status: "viewed",
    sentAt: NOW - 7 * DAY,
    refuse: "already_accepted",
  },
  {
    // FX-3 (A4 9): a newer version was frozen after this page loaded and is still being made; the accept is refused and the
    // page reloads to show the version as replaced.
    id: "sample-pending",
    fixture: "short-intra-inr",
    status: "viewed",
    sentAt: NOW - 8 * DAY,
    refuse: "newer_version_pending",
  },
  {
    id: "sample-accepted",
    fixture: "short-intra-inr",
    status: "accepted",
    sentAt: NOW - 20 * DAY,
    acceptance: {
      typedName: "Asha Iyer",
      email: ME.contact.email,
      acceptedAt: NOW - 18 * DAY,
      via: "session",
    },
    certificate: "ready",
  },
  {
    id: "sample-accepted-other",
    fixture: "intra-estimate",
    status: "accepted",
    sentAt: NOW - 25 * DAY,
    acceptance: { typedName: "Rahul Sen", email: COLLEAGUE.email, acceptedAt: NOW - 24 * DAY, via: "link" },
    certificate: "ready",
  },
  {
    id: "sample-declined",
    fixture: "inter-estimate",
    status: "declined",
    sentAt: NOW - 30 * DAY,
    decline: {
      reason: "timing",
      note: "We'll come back to this after the busy season.",
      at: NOW - 29 * DAY,
      by: ME.contact.name,
    },
  },
  {
    id: "sample-expired",
    fixture: "long-names",
    status: "expired",
    sentAt: NOW - 60 * DAY,
    validUntil: "2026-09-01",
  },
  {
    id: "sample-old",
    fixture: "long-inter-inr",
    status: "revised",
    sentAt: NOW - 40 * DAY,
    supersededBy: "sample-long",
  },
];

const views = new Map<string, Promise<Envelope>>();
const envelopeOf = (f: FixtureName) => {
  let p = views.get(f);
  if (!p) {
    p = buildFixture(f).then((x) => x.envelope);
    views.set(f, p);
  }
  return p;
};

/** The fixture with this document's version and validity (the fixture's figures and words stay as the engine made them). */
async function pageOf(d: Doc): Promise<OfferPage> {
  const base = await envelopeOf(d.fixture);
  const env: Envelope = {
    ...base,
    documentId: d.id,
    version: d.version ?? base.version,
    snapshot: {
      ...base.snapshot,
      header: {
        ...base.snapshot.header,
        document: {
          ...base.snapshot.header.document,
          version: d.version ?? base.version,
          validUntil: d.validUntil ?? base.snapshot.header.document.validUntil,
        },
      },
    },
  };
  const view = toPdfView(env, undefined, { longDates: true });
  return {
    document: {
      id: d.id,
      kind: env.type,
      status: d.status,
      version: env.version,
      title: env.snapshot.header.document.title,
      numberDisplay: env.numberDisplay,
      validUntil: env.snapshot.header.document.validUntil,
      fingerprint: "3f9a1c0b7e24d5a6b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5",
    },
    view,
    ...(d.acceptance ? { acceptance: d.acceptance } : {}),
    ...(d.decline ? { decline: d.decline } : {}),
    certificate: { state: d.certificate ?? "none" },
  };
}

async function itemOf(d: Doc): Promise<OfferItem> {
  const p = await pageOf(d);
  return {
    id: d.id,
    kind: p.document.kind,
    title: p.document.title,
    numberDisplay: p.document.numberDisplay,
    version: p.document.version,
    status: d.status,
    total: p.view.totals.find((t) => t.strong)?.value ?? "",
    validUntil: p.document.validUntil,
    decidedAt: d.acceptance?.acceptedAt ?? d.decline?.at ?? null,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const error = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  json(status, { error: { code, message: code }, request_id: "sample-request", ...extra });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** T11: the sample organisation's one signed deed, on "Accepted by you" (sample-accepted). Made-up number, moment and transaction ID. */
const SAMPLE_DEEDS: SignedDeed[] = [
  {
    id: "sample-deed",
    number: "TH/DA/2627/0001",
    sourceDocumentId: "sample-accepted",
    offer: { type: "proposal", number: "TH/PRP/2627/0004", version: 1 },
    esignAt: Date.UTC(2026, 10, 3, 8, 35),
    esignMoment: "03 Nov 2026, 14:05 IST",
    esignTxn: "SAMPLE-ESIGN-7F3K-29QD",
    signatureLine:
      "Signed by the assignor with an Aadhaar-based electronic signature (eSign): Rupak Sarkar, sole proprietor, TecHaust Technologies · 03 Nov 2026, 14:05 IST · SAMPLE-ESIGN-7F3K-29QD.",
    signedAt: Date.UTC(2026, 10, 3, 9, 0),
    size: 245_812,
  },
];

function pdf(name: string) {
  // Not a real PDF: a labelled text file under a .pdf name, so the download path can be tried.
  return new Response(new Blob(["Preview: sample data. This stands in for the PDF; nothing was rendered."]), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"` },
  });
}

/** The link tokens of the sample: 43 characters; the first letter picks the case. */
export const SAMPLE_TOKENS = {
  offer: `S${"a".repeat(42)}`,
  superseded: `R${"a".repeat(42)}`,
  accepted: `A${"a".repeat(42)}`,
  unknown: `X${"a".repeat(42)}`,
};

function docOfToken(token: string): { doc: Doc; from?: number } | null {
  if (token.startsWith("S")) return { doc: DOCS[0] as Doc };
  if (token.startsWith("R")) return { doc: DOCS.find((d) => d.id === "sample-long") as Doc, from: 1 };
  if (token.startsWith("A")) return { doc: DOCS.find((d) => d.id === "sample-accepted") as Doc };
  return null;
}

async function answer(
  path: string,
  method: string,
  body: Record<string, unknown>,
  empty: boolean,
): Promise<Response> {
  await wait(250);
  if (path === "/me") return json(200, ME);
  if (path === "/auth/logout") return new Response(null, { status: 204 });
  if (path === "/auth/sessions/revoke-all") return json(200, { ok: true, revoked: 2 });
  if (path.startsWith("/offers") && method === "GET" && /^\/offers(\?|$)/.test(path)) {
    const live = empty ? [] : DOCS.filter((d) => !d.supersededBy);
    return json(200, { offers: await Promise.all(live.map(itemOf)), next: null });
  }

  const m = /^\/offers\/([^/]+)(?:\/(pdf|certificate|accept|decline))?$/.exec(path);
  if (m) {
    const doc = DOCS.find((d) => d.id === decodeURIComponent(m[1] ?? ""));
    if (!doc || empty) return error(404, "not_found");
    return act(doc, m[2] ?? "", body, ME.contact.name);
  }

  const t = /^\/t\/offer(?:\/(pdf|certificate|accept|decline))?$/.exec(path);
  if (t) {
    const found = docOfToken(String(body.token ?? ""));
    if (!found) return error(404, "not_found");
    if (!t[1]) {
      const page = await pageOf(found.doc);
      return json(200, {
        ...page,
        link: { purpose: "offer", ...(found.from ? { supersededFrom: found.from } : {}) },
      });
    }
    if (body.documentId !== found.doc.id) return error(404, "not_found");
    return act(found.doc, t[1], body, null);
  }
  // T11: the signed deed of the sample accepted proposal (sample values; the eSign moment and transaction ID are made up)
  if (path === "/deeds" && method === "GET") return json(200, { deeds: empty ? [] : SAMPLE_DEEDS });
  if (path === "/deeds/pdf") {
    const d = empty ? undefined : SAMPLE_DEEDS.find((x) => x.id === body.id);
    if (!d) return error(404, "not_found");
    return pdf(`${d.number.replaceAll("/", "-")}-signed.pdf`);
  }
  // M5.4: invoices, payment requests and notes (signed in and by link)
  const inv = answerInvoices(path, method, body, empty, { json, error, pdf });
  if (inv) return inv;
  return error(404, "not_found");
}

async function act(
  doc: Doc,
  what: string,
  body: Record<string, unknown>,
  by: string | null,
): Promise<Response> {
  const page = await pageOf(doc);
  const file = `${page.document.numberDisplay?.replaceAll("/", "-")}-v${page.document.version}`;
  switch (what) {
    case "": {
      if (doc.supersededBy) {
        const latest = DOCS.find((d) => d.id === doc.supersededBy) as Doc;
        return json(200, { superseded: { latestId: latest.id, version: latest.version ?? 1 } });
      }
      if (doc.status === "sent") doc.status = "viewed";
      return json(200, page);
    }
    case "pdf":
      return pdf(`${file}.pdf`);
    case "certificate":
      if (!doc.acceptance) return error(404, "not_found");
      if (doc.certificate !== "ready") {
        doc.certificate = "ready"; // ready on the next try
        return error(409, "certificate_pending");
      }
      return pdf(`${file}-certificate.pdf`);
    case "accept": {
      await wait(500);
      if (doc.refuse === "already_accepted") {
        doc.status = "accepted";
        doc.acceptance = {
          typedName: "Rahul Sen",
          email: COLLEAGUE.email,
          acceptedAt: Date.now() - 60_000,
          via: "session",
        };
        doc.certificate = "pending";
        return error(409, "already_accepted", { name: "Rahul Sen", at: doc.acceptance.acceptedAt });
      }
      if (doc.refuse === "newer_version_pending") {
        doc.status = "revised";
        return error(409, "newer_version_pending");
      }
      if (doc.status !== "sent" && doc.status !== "viewed") return error(409, "already_decided");
      const name = String(body.typedName ?? "").trim();
      if (name.length < 2) return error(400, "name_too_short");
      if (name.length > 120) return error(400, "name_too_long");
      doc.status = "accepted";
      doc.acceptance = {
        typedName: name,
        email: ME.contact.email,
        acceptedAt: Date.now(),
        via: by ? "session" : "link",
      };
      doc.certificate = "pending";
      return json(200, {
        typedName: name,
        email: ME.contact.email,
        acceptedAt: doc.acceptance.acceptedAt,
        fingerprint: page.document.fingerprint,
      });
    }
    case "decline": {
      await wait(500);
      if (doc.status !== "sent" && doc.status !== "viewed") return error(409, "already_decided");
      const reason = String(body.reason ?? "");
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
      doc.status = "declined";
      // The API names the deciding contact on a link too (review fix 8).
      doc.decline = { reason, note, at: Date.now(), by: by ?? ME.contact.name };
      return json(200, { declined: { reason, at: doc.decline.at, by: doc.decline.by } });
    }
  }
  return error(404, "not_found");
}

function label() {
  if (document.getElementById("sample-label")) return;
  const bar = document.createElement("p");
  bar.id = "sample-label";
  bar.className = "sample-label";
  const strong = document.createElement("strong");
  strong.textContent = "Preview — sample data.";
  const link = document.createElement("a");
  link.href = "/preview";
  link.textContent = "All sample screens";
  bar.append(strong, " Nothing is saved or sent. ", link);
  // Deliberately unlike the product (a dashed warning edge), so a screenshot can never pass for the real portal. Tokens only.
  const style = document.createElement("style");
  style.textContent = `.sample-label{margin:0;padding:0 var(--gutter);background:var(--color-surface-alt);border-bottom:2px dashed var(--color-warning);font-size:var(--text-sm);line-height:var(--text-sm--line-height)}.sample-label strong{color:var(--color-warning)}.sample-label a{display:inline-flex;align-items:center;min-height:var(--target-min)}`;
  document.head.append(style);
  document.body.prepend(bar);
}

/** Switches the sample API on or off from `?sample=`, then answers /api/v1 while it is on. */
export function installSampleApi() {
  const q = new URLSearchParams(location.search).get("sample");
  if (q === "off") sessionStorage.removeItem(KEY);
  else if (q === "on" || q === "empty") sessionStorage.setItem(KEY, q);
  const mode = sessionStorage.getItem(KEY);
  if (!mode) return;
  label();
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      location.href,
    );
    if (!url.pathname.startsWith("/api/v1/")) return real(input, init);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    return answer(
      url.pathname.slice("/api/v1".length) + url.search,
      init?.method ?? "GET",
      body,
      mode === "empty",
    );
  };
}
