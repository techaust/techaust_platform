// DEV ONLY (sample-api.ts calls it; never in a build): the M7.1 routes answered from memory, so Home, Projects, Receipts, Profile and "I've paid" can be seen
// in every state on the dev server. Modes: `on` (everything), `empty` (an organisation with nothing yet), `nofinance` (a contact who can't see finance: the
// money keys are null or absent, as the API answers), `fail` (every M7.1 read answers 500, for the error states).
//
// SAMPLE DATA ONLY (the repo is public): every name is "(sample)", every address @example.test, every amount made up.
import type {
  HomeData,
  Milestone,
  ProjectItem,
  ReceiptItem,
  RequestItem,
  SharedFile,
  SharedNote,
} from "../api.ts";
import { SAMPLE_INVOICES, SAMPLE_PAYPAL } from "./sample-invoices.ts";

type H = {
  json: (status: number, body: unknown) => Response;
  error: (status: number, code: string, extra?: Record<string, unknown>) => Response;
  pdf: (name: string) => Response;
};
export type M71Mode = "on" | "empty" | "nofinance" | "fail";

const DAY = 86_400_000;
const NOW = Date.now();
const day = (n: number) => new Date(NOW + n * DAY + 19_800_000).toISOString().slice(0, 10);

const PROJECTS: (ProjectItem & { createdAt: number })[] = [
  {
    id: "prj-web",
    code: "KES-P01",
    name: "Website rebuild (sample)",
    status: "active",
    startDate: day(-40),
    targetDate: day(45),
    createdAt: NOW - 40 * DAY,
  },
  {
    id: "prj-care",
    code: "KES-P02",
    name: "Care plan onboarding (sample)",
    status: "planned",
    startDate: day(10),
    targetDate: null,
    createdAt: NOW - 12 * DAY,
  },
  {
    id: "prj-dash",
    code: "KES-P03",
    name: "Inventory dashboard with a long name that wraps across two lines on a phone (sample)",
    status: "on_hold",
    startDate: day(-90),
    targetDate: day(-5),
    createdAt: NOW - 95 * DAY,
  },
  {
    id: "prj-brand",
    code: "KES-P04",
    name: "Brand refresh (sample)",
    status: "completed",
    startDate: day(-200),
    targetDate: day(-150),
    createdAt: NOW - 210 * DAY,
  },
  {
    id: "prj-app",
    code: "KES-P05",
    name: "Field app pilot (sample)",
    status: "cancelled",
    startDate: day(-300),
    targetDate: null,
    createdAt: NOW - 320 * DAY,
  },
];

const MILESTONES: Record<string, Milestone[]> = {
  "prj-web": [
    {
      id: "ms-1",
      position: 1,
      title: "Discovery and site plan",
      status: "paid",
      dueDate: day(-30),
      amountMinor: 5_000_000,
      currency: "INR",
      invoice: { id: "inv-paid", numberDisplay: "TH/INV/2627/0002" },
    },
    {
      id: "ms-2",
      position: 2,
      title: "Design of the key pages",
      status: "invoiced",
      dueDate: day(-2),
      amountMinor: 2_360_000,
      currency: "INR",
      invoice: { id: "inv-due", numberDisplay: "TH/INV/2627/0007" },
    },
    {
      id: "ms-3",
      position: 3,
      title: "Build and content entry",
      status: "ready_to_bill",
      dueDate: day(20),
      amountMinor: 7_500_000,
      currency: "INR",
      invoice: null,
    },
    {
      id: "ms-4",
      position: 4,
      title: "Launch and handover, with two weeks of support after the site goes live",
      status: "pending",
      dueDate: day(45),
      amountMinor: null,
      currency: "INR",
      invoice: null,
    },
  ],
};

const NOTES: SharedNote[] = [
  {
    id: "note-1",
    projectId: "prj-web",
    bodyMd:
      "## Week 6 update\n\nThe **home page** and **services** templates are ready for your review on staging.\n\n- Please check the copy on the About page\n- Send us the final team photos by Friday\n\nWe'll start the content entry once you've signed off.",
    createdAt: NOW - 2 * DAY,
    updatedAt: NOW - 1 * DAY,
  },
  {
    id: "note-2",
    projectId: "prj-web",
    bodyMd: "Kick-off notes are attached under Files. The weekly call stays on Tuesdays at 11:00.",
    createdAt: NOW - 38 * DAY,
    updatedAt: NOW - 38 * DAY,
  },
  {
    id: "note-3",
    projectId: null,
    bodyMd: "Our office is closed on 12 November (sample). Replies resume the next working day.",
    createdAt: NOW - 5 * DAY,
    updatedAt: NOW - 5 * DAY,
  },
];

const FILES: SharedFile[] = [
  {
    id: "file-1",
    projectId: "prj-web",
    filename: "Sitemap v2 (sample).pdf",
    mime: "application/pdf",
    size: 248_000,
    createdAt: NOW - 3 * DAY,
  },
  {
    id: "file-2",
    projectId: "prj-web",
    filename: "Kick-off meeting notes and decisions log with a long file name (sample).docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 1_840_000,
    createdAt: NOW - 38 * DAY,
  },
  {
    id: "file-gone",
    projectId: "prj-web",
    filename: "Old brief (sample, no longer shared).pdf",
    mime: "application/pdf",
    size: 512,
    createdAt: NOW - 60 * DAY,
  },
];

const RECEIPTS: ReceiptItem[] = [
  {
    id: "rct_sample-1",
    kind: "receipt",
    numberDisplay: "TH/RCT/2627/0004",
    issueDate: day(-3),
    currency: "INR",
    amountMinor: 1_180_000,
    pdfReady: true,
    for: { numbers: ["TH/INV/2627/0002"], more: 0 },
  },
  {
    id: "rct_sample-2",
    kind: "receipt",
    numberDisplay: "TH/RCT/2627/0003",
    issueDate: day(-9),
    currency: "INR",
    amountMinor: 4_720_000,
    pdfReady: false,
    for: { numbers: ["TH/INV/2627/0001", "TH/INV/2627/0003", "TH/DN/2627/0001"], more: 2 },
  },
  {
    id: "cn-1",
    kind: "credit_note",
    numberDisplay: "TH/CN/2627/0001",
    issueDate: day(-12),
    currency: "INR",
    amountMinor: 118_000,
    pdfReady: true,
    for: { numbers: ["TH/INV/2627/0002"], more: 0, invoiceId: "inv-paid" },
  },
  {
    id: "rct_sample-3",
    kind: "receipt",
    numberDisplay: "TH/RCT/2627/0001",
    issueDate: day(-40),
    currency: "USD",
    amountMinor: 125_000,
    pdfReady: true,
    for: { numbers: ["TH/EXP/2627/0001"], more: 0 },
  },
];

let requests: (RequestItem & { contact: string })[] = [
  {
    id: "req-2",
    kind: "contact_change",
    details:
      "Please give portal access to our accountant, Meera Das (sample), meera.das@kestrel.example.test.",
    status: "open",
    outcome: null,
    createdAt: NOW - 1 * DAY,
    closedAt: null,
    contact: "me",
  },
  {
    id: "req-1",
    kind: "data_access",
    details: null,
    status: "closed",
    outcome: "done",
    createdAt: NOW - 50 * DAY,
    closedAt: NOW - 45 * DAY,
    contact: "me",
  },
];

let me: { name: string; email: string; phone: string | null; title: string | null; updatedAt: number } = {
  name: "Asha Iyer (sample)",
  email: "asha.iyer@kestrel.example.test",
  phone: "+91 98300 00000",
  title: "Operations head (sample)",
  updatedAt: NOW - 30 * DAY,
};

const toPay = () =>
  SAMPLE_INVOICES.filter(
    (d) =>
      d.type !== "credit_note" &&
      d.status !== "withdrawn" &&
      d.status !== "void" &&
      (d.balanceMinor ?? 0) > 0,
  )
    .slice(0, 5)
    .map((d) => ({
      id: d.id,
      type: d.type,
      status: d.status,
      numberDisplay: d.numberDisplay,
      issueDate: d.issueDate,
      dueDate: d.dueDate,
      currency: d.currency,
      totalMinor: d.totals.totalMinor,
      balanceMinor: d.balanceMinor,
      total: d.total,
      balance: d.balance,
      withdrawnOn: null,
    }));

const strip = (m: Milestone, finance: boolean): Milestone => {
  if (finance) return m;
  const { amountMinor: _a, currency: _c, invoice: _i, ...rest } = m;
  return rest;
};

/** The M7.1 answer for `path`, or null when the path isn't M7.1's. */
export function answerM71(
  path: string,
  method: string,
  body: Record<string, unknown>,
  mode: M71Mode,
  h: H,
): Response | null {
  const empty = mode === "empty";
  const finance = mode !== "nofinance";
  const fail = mode === "fail";
  const url = new URL(path, "http://sample.test");
  const p = url.pathname;
  const isM71 =
    p === "/home" ||
    p.startsWith("/projects") ||
    p === "/notes" ||
    p.startsWith("/files") ||
    p === "/receipts" ||
    p === "/profile" ||
    p === "/requests" ||
    /\/paid-notice$/.test(p);
  if (!isM71) return null;
  if (fail && method === "GET") return h.error(500, "server");

  if (p === "/home") {
    const data: HomeData = {
      awaiting: [],
      toPay: finance ? (empty ? [] : toPay()) : null,
      receipts: finance
        ? empty
          ? []
          : RECEIPTS.filter((r) => r.kind === "receipt").map((r) => ({
              id: r.id,
              numberDisplay: r.numberDisplay,
              issueDate: r.issueDate,
              currency: r.currency,
              amountMinor: r.amountMinor,
              pdfReady: r.pdfReady,
            }))
        : null,
      projects: empty ? [] : PROJECTS.filter((x) => ["planned", "active", "on_hold"].includes(x.status)),
      notes: empty ? [] : NOTES,
      files: empty ? [] : FILES.slice(0, 2),
    };
    return h.json(200, data);
  }
  if (p === "/projects" && method === "GET")
    return h.json(200, { projects: empty ? [] : PROJECTS, next: null });
  const pj = /^\/projects\/([^/]+)$/.exec(p);
  if (pj && method === "GET") {
    const project = PROJECTS.find((x) => x.id === decodeURIComponent(pj[1] ?? ""));
    if (!project || empty) return h.error(404, "not_found");
    const ms = (MILESTONES[project.id] ?? []).map((m) => strip(m, finance));
    const notes = NOTES.filter((n) => n.projectId === project.id);
    const files = FILES.filter((f) => f.projectId === project.id);
    return h.json(200, {
      project,
      milestones: ms,
      milestonesNext: null,
      notes,
      notesNext: null,
      files,
      filesNext: null,
    });
  }
  const fd = /^\/files\/([^/]+)\/download$/.exec(p);
  if (fd) {
    const f = FILES.find((x) => x.id === decodeURIComponent(fd[1] ?? ""));
    if (!f || f.id === "file-gone") return h.error(404, "not_found");
    return h.pdf(f.filename);
  }
  if (p === "/receipts") {
    if (!finance) return h.error(404, "not_found");
    return h.json(200, { items: empty ? [] : RECEIPTS, next: null });
  }
  if (p === "/profile" && method === "GET")
    return h.json(200, {
      me,
      organisation: "Kestrel Distributors (sample)",
      colleagues: [
        { name: me.name, title: me.title, you: true },
        { name: "Rahul Sen (sample)", title: "Finance lead (sample)", you: false },
        { name: "Zara Thomas (sample)", title: null, you: false },
      ],
      requests: empty ? [] : requests,
      requestsNext: null,
    });
  if (p === "/profile" && method === "POST") {
    const name = String(body.name ?? "");
    if (name.toLowerCase().includes("stale")) return h.error(409, "stale_version");
    if (name.length > 100) return h.error(400, "bad_request");
    me = { ...me, name, phone: (body.phone as string | null) ?? null, updatedAt: Date.now() };
    return h.json(200, { me });
  }
  if (p === "/requests" && method === "POST") {
    const kind = String(body.kind ?? "");
    if (requests.some((r) => r.kind === kind && r.status === "open")) return h.error(409, "request_open");
    if (requests.filter((r) => r.createdAt > NOW - DAY).length >= 5) return h.error(429, "too_many_requests");
    const r = {
      id: `req-${requests.length + 1}`,
      kind,
      details: typeof body.details === "string" ? body.details : null,
      status: "open",
      outcome: null,
      createdAt: Date.now(),
      closedAt: null,
      contact: "me",
    };
    requests = [r, ...requests];
    return h.json(201, { request: r });
  }
  if (/\/paid-notice$/.test(p) && method === "POST") {
    const amount = Number(body.amountMinor);
    const ref = String(body.reference ?? "");
    const doc =
      p === "/t/document/paid-notice"
        ? SAMPLE_INVOICES[0]
        : [...SAMPLE_INVOICES, ...SAMPLE_PAYPAL].find((d) => p === `/invoices/${d.id}/paid-notice`);
    if (!doc) return h.error(404, "not_found");
    if (amount > (doc.balanceMinor ?? 0))
      return h.error(400, "amount_above_balance", { balanceMinor: doc.balanceMinor });
    if (String(body.paidOn ?? "") > day(0)) return h.error(400, "date_in_future");
    if (ref.toUpperCase().startsWith("DUP")) return h.error(409, "notice_duplicate");
    if (ref.toUpperCase().startsWith("MAX")) return h.error(409, "notice_open_limit");
    // review M1 and question 2: a note the server refuses (the 400 names the note), and a link or document gone since the page loaded
    if (String(body.note ?? "").includes("REFUSE"))
      return h.error(400, "bad_request", { fields: ["note"] });
    if (ref.toUpperCase().startsWith("GONE")) return h.error(404, "not_found");
    return h.json(201, {
      notice: {
        id: "notice-sample",
        status: "open",
        amountMinor: amount,
        paidOn: body.paidOn,
        reference: ref,
      },
    });
  }
  return h.error(404, "not_found");
}
