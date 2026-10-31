// PREVIEW ONLY (dev server, never built): /preview lists the M4.5 screens to look at with the sample API (sample-api.ts) switched on
// for this tab, and /preview/email shows the five M4.5 emails rendered by the real templates of packages/email (HTML in a frame, the
// plain text below). main.tsx adds this route only when import.meta.env.DEV, so no preview code or sample data reaches dist (checked
// after the build). Sample data only; nothing is saved or sent.
import "./preview.css";
import badge from "@techaust/ui/brand/logo-email-badge@2x.png?url";
import logoDarkPng from "@techaust/ui/brand/logo-email-dark@2x.png?url";
import { useEffect, useRef, useState } from "react";
import { Link, Route, Routes } from "react-router";
import { renderEmail } from "../../../../packages/email/src/index.ts";
import { SAMPLE_TOKENS } from "./sample-api.ts";
import { SAMPLE_INVOICE_TOKENS } from "./sample-invoices.ts";

/** Any base works: EmailFrame swaps the logo URLs for the dev server's own. */
const BASE = "/preview-assets/";

const SCREENS: [string, string][] = [
  ["/?sample=on", "Home"],
  ["/?sample=empty", "Home, nothing sent yet"],
  ["/proposals?sample=on", "Proposals and estimates"],
  ["/proposals/sample-sent?sample=on", "Proposal, sent (first view)"],
  ["/proposals/sample-estimate?sample=on", "Estimate, viewed"],
  ["/proposals/sample-usd?sample=on", "Proposal in USD (export under LUT)"],
  ["/proposals/sample-long?sample=on", "Long proposal (16 sections), version 2"],
  ["/proposals/sample-names?sample=on", "Long names"],
  ["/proposals/sample-revised?sample=on", "A new version is being prepared"],
  ["/proposals/sample-refused?sample=on", "Accept refused: a colleague accepted first"],
  ["/proposals/sample-pending?sample=on", "Accept refused: a newer version is being prepared"],
  ["/proposals/sample-accepted?sample=on", "Accepted by you"],
  ["/proposals/sample-accepted-other?sample=on", "Accepted by a colleague"],
  ["/proposals/sample-declined?sample=on", "Declined"],
  ["/proposals/sample-expired?sample=on", "Expired"],
  ["/proposals/sample-old?sample=on", "An older version's address (moves to the latest)"],
  ["/proposals/another-client?sample=on", "Another client's document (404)"],
  [`/o?sample=on#t=${SAMPLE_TOKENS.offer}`, "Email link: the document without signing in"],
  [`/o?sample=on#t=${SAMPLE_TOKENS.superseded}`, "Email link to an older version"],
  [`/o?sample=on#t=${SAMPLE_TOKENS.accepted}`, "Email link after acceptance (confirmation)"],
  [`/o?sample=on#t=${SAMPLE_TOKENS.unknown}`, "Email link that has ended (404)"],
  ["/invoices?sample=on", "M5.4 Invoices (list)"],
  ["/invoices?sample=empty", "M5.4 Invoices, none yet"],
  ["/invoices/inv-due?sample=on", "M5.4 Invoice, due"],
  ["/invoices/inv-overdue?sample=on", "M5.4 Invoice, overdue, part paid, with line discounts (IGST)"],
  ["/invoices/pro-due?sample=on", "M5.4 Payment request (proforma), PDF not ready, GST as an estimate"],
  ["/invoices/pro-old?sample=on", "FX-4 Payment request sealed before FX-4 (no estimate marker)"],
  ["/invoices/pro-withdrawn?sample=on", "ADM-INV-10 Payment request withdrawn (no amount due, no PDF)"],
  ["/invoices/dn-due?sample=on", "M5.4 Debit note, its invoice linked, a reason with words typed"],
  ["/invoices/cn-1?sample=on", "M5.4 Credit note, its invoice linked, its reason"],
  ["/invoices/inv-paid?sample=on", "M5.4 Invoice, paid and credited (Credited row)"],
  ["/invoices/exp-usd?sample=on", "M5.4 Export invoice in USD (SWIFT)"],
  ["/invoices/inv-long?sample=on", "M5.4 Invoice with 12 lines"],
  ["/invoices/another-client?sample=on", "M5.4 Another client's invoice (404)"],
  [`/i?sample=on#t=${SAMPLE_INVOICE_TOKENS.invoice}`, "M5.4 Email link: an invoice without signing in"],
  [`/i?sample=on#t=${SAMPLE_INVOICE_TOKENS.proforma}`, "M5.4 Email link: a payment request, PDF not ready"],
  [`/i?sample=on#t=${SAMPLE_INVOICE_TOKENS.credit}`, "M5.4 Email link: a credit note"],
  [`/i?sample=on#t=${SAMPLE_INVOICE_TOKENS.withdrawn}`, "ADM-INV-10 Email link: a withdrawn payment request"],
  [`/i?sample=on#t=${SAMPLE_INVOICE_TOKENS.ended}`, "M5.4 Email link that no longer works"],
  ["/preview/email-billing", "M5.4 The billing emails"],
  ["/projects?sample=on", "Projects (coming soon)"],
  ["/profile?sample=on", "Profile (coming soon)"],
  ["/preview/email", "The five emails"],
  ["/?sample=off", "Switch the sample data off (the real API)"],
];

function Index() {
  useEffect(() => {
    document.title = "M4.5 sample screens – preview";
  }, []);
  return (
    <main className="pv-email" id="main">
      <h1 className="pv-email__h1">M4.5 sample screens</h1>
      <p>
        Preview — sample data. Each link switches the sample API on for this tab; nothing is saved or sent.
        Light or dark follows your system setting.
      </p>
      <ul className="pv-list">
        {SCREENS.map(([to, label]) => (
          <li key={to}>
            {/* A full load, so the sample API is switched on before the app starts. */}
            <a href={to}>{label}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}

function EmailFrame(props: { title: string; html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(640);
  return (
    <iframe
      ref={ref}
      title={props.title}
      className="pv-email__frame"
      // The layout names the logos with "@" percent-encoded (for Workers static assets); the dev server wants the files' own
      // URLs, absolute (a srcdoc frame has no base of its own).
      srcDoc={props.html
        .replaceAll(`${BASE}logo-email-badge%402x.png`, new URL(badge, location.href).href)
        .replaceAll(`${BASE}logo-email-dark%402x.png`, new URL(logoDarkPng, location.href).href)}
      style={{ height: `${h}px` }}
      onLoad={() => {
        const doc = ref.current?.contentDocument;
        if (doc) setH(doc.documentElement.scrollHeight);
      }}
    />
  );
}

// Sample values only (made-up names, @example.test addresses), in the shapes the jobs Worker sends.
const SENT = {
  first_name: "Asha",
  kind: "proposal",
  title: "Sample proposal for short-intra-inr",
  number: "TH/PRP/2627/0003",
  version: "2",
  valid_until: "10 Nov 2026",
  total: "₹3,22,140.00",
  url: "https://portal.techaust.com/o#t=SAMPLE-LINK",
  sender_name: "Sample Sender",
};
const ACCEPTED = {
  typed_name: "Asha Iyer",
  email: "asha.iyer@kestrel.example.test",
  accepted_at_ist: "25 Oct 2026, 11:42 IST",
  title: SENT.title,
  number: SENT.number,
  version: SENT.version,
  next_step: "we'll confirm the start date with you and send the first invoice",
};

function EmailPreview() {
  const [attached, setAttached] = useState(false);
  useEffect(() => {
    document.title = "Emails – preview";
  }, []);
  const mails = [
    {
      key: "sent",
      label: "Proposal sent (to each chosen contact, from hello@)",
      to: "Asha Iyer <asha.iyer@kestrel.example.test>",
      r: renderEmail("offer.sent", { ...SENT, attached: attached ? "1" : "0" }, { assetBase: BASE }),
    },
    {
      key: "estimate",
      label: "Estimate sent",
      to: "Asha Iyer <asha.iyer@kestrel.example.test>",
      r: renderEmail(
        "offer.sent",
        {
          ...SENT,
          kind: "estimate",
          title: "Sample estimate",
          number: "TH/EST/2627/0002",
          version: "1",
          attached: "0",
        },
        { assetBase: BASE },
      ),
    },
    {
      key: "accepted",
      label: "Acceptance confirmation (to the client, once the certificate exists)",
      to: "Asha Iyer <asha.iyer@kestrel.example.test>",
      r: renderEmail(
        "offer.accepted.client",
        { ...ACCEPTED, url: "https://portal.techaust.com/o#t=SAMPLE-CONFIRMATION" },
        { assetBase: BASE },
      ),
    },
    {
      key: "accepted-staff",
      label: "Acceptance (to the sender and the owners)",
      to: "owner@example.test",
      r: renderEmail(
        "offer.accepted.staff",
        { ...ACCEPTED, url: "https://admin.techaust.com/documents/sample" },
        { assetBase: BASE },
      ),
    },
    {
      key: "approval",
      label: "Approval needed (to the owner)",
      to: "owner@example.test",
      r: renderEmail(
        "approval.requested",
        {
          requester_name: "Sample Sender",
          request_reason: "12 % off catalogue prices",
          title: SENT.title,
          version: "1",
          amount: "₹2,83,483.20",
          admin_url: "https://admin.techaust.com/approvals",
        },
        { assetBase: BASE },
      ),
    },
    {
      key: "approval-decided",
      label: "Approval decided (to the requester)",
      to: "sender@example.test",
      r: renderEmail(
        "approval.decided",
        {
          decision: "Approved",
          approver_name: "Sample Owner",
          title: SENT.title,
          version: "1",
          decision_note: "Fine for this client",
          admin_url: "https://admin.techaust.com/documents/sample",
        },
        { assetBase: BASE },
      ),
    },
  ];
  return (
    <main className="pv-email" id="main">
      <p className="pv-email__label">
        <strong>Preview — sample data.</strong> <Link to="/preview">All sample screens</Link>
      </p>
      <h1 className="pv-email__h1">Emails</h1>
      <label className="pv-email__toggle">
        <input type="checkbox" checked={attached} onChange={(e) => setAttached(e.target.checked)} />
        <span>The client's setting attaches the PDF</span>
      </label>
      {mails.map(({ key, label, to, r }) => (
        <section key={key} className="pv-email__one" aria-labelledby={`${key}-h`}>
          <h2 id={`${key}-h`}>{label}</h2>
          <dl className="pv-email__head">
            <div>
              <dt>From</dt>
              <dd>
                {r.from.name} &lt;{r.from.address}&gt;, reply to {r.replyTo}
              </dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{to}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>{r.subject}</dd>
            </div>
          </dl>
          <EmailFrame key={`${key}-${attached}`} title={`${label}: HTML version`} html={r.html} />
          <details className="pv-email__text">
            <summary>Plain-text version</summary>
            <pre>{r.text}</pre>
          </details>
        </section>
      ))}
    </main>
  );
}

// M5.4: every billing email (07-U, marked until approved), in the shapes the jobs Worker sends (core `INVOICE_EMAIL_DATA`). Sample values only.
const DOC = {
  first_name: "Asha",
  number: "TH/INV/2627/0007",
  issue_date: "5 Nov 2026",
  due_date: "12 Nov 2026",
  total: "₹23,600.00",
  balance: "₹23,600.00",
  url: "https://portal.techaust.com/i#t=SAMPLE-LINK",
  parent_number: "",
  sender_name: "Sample Sender",
  reason: "",
  parent_balance: "",
};
const OWNER = {
  owner_first_name: "Rupak",
  client_name: "Kestrel Distributors (sample)",
  admin_url: "https://admin.techaust.com/projects/sample",
  milestone_title: "Phase 1 delivery (sample)",
  delivered_date: "1 Oct 2026",
  days_since: "25",
};
const STAGES: [string, string, string][] = [
  ["before", "3", "3 days before"],
  ["on", "0", "on the due date"],
  ["after", "3", "3 days after"],
  ["after", "7", "7 days after"],
  ["after", "14", "14 days after"],
];

function BillingEmailPreview() {
  const [attached, setAttached] = useState(true);
  useEffect(() => {
    document.title = "Billing emails – preview";
  }, []);
  const a = attached ? "1" : "";
  const client = "Asha Iyer <asha.iyer@kestrel.example.test>";
  const r = (t: string, d: Record<string, string>) => renderEmail(t, d, { assetBase: BASE });
  const mails: { key: string; label: string; to: string; r: ReturnType<typeof renderEmail> }[] = [
    { key: "inv", label: "Invoice", to: client, r: r("invoice.sent", { ...DOC, attached: a }) },
    {
      key: "pro",
      label: "Payment request (proforma)",
      to: client,
      r: r("proforma.sent", { ...DOC, number: "TH/PRO/2627/0002", attached: a }),
    },
    {
      key: "cn",
      label: "Credit note",
      to: client,
      r: r("credit_note.sent", {
        ...DOC,
        number: "TH/CN/2627/0001",
        due_date: "",
        balance: "",
        parent_number: "TH/INV/2627/0003",
        reason: "Discount after sale: launch offer agreed on the call (sample)",
        parent_balance: "₹11,800.00",
        attached: a,
      }),
    },
    {
      key: "dn",
      label: "Debit note",
      to: client,
      r: r("debit_note.sent", {
        ...DOC,
        number: "TH/DN/2627/0001",
        total: "₹1,180.00",
        balance: "₹1,180.00",
        parent_number: "TH/INV/2627/0004",
        reason: "Price correction: hosting rate typed wrong (sample)",
        attached: a,
      }),
    },
    ...(["invoice", "proforma", "debit_note"] as const).flatMap((kind) =>
      STAGES.map(([when, n, label]) => ({
        key: `rem-${kind}-${when}-${n}`,
        label: `Reminder, ${kind.replace("_", " ")}, ${label}`,
        to: client,
        r: r("reminder.sent", { ...DOC, attached: "", kind, when, offset_days: n }),
      })),
    ),
    {
      key: "unbilled",
      label: "Unbilled work (to owners)",
      to: "owner@example.test",
      r: r("alert.unbilled", OWNER),
    },
    {
      key: "proforma-due",
      label: "Proforma unpaid after delivery (to owners)",
      to: "owner@example.test",
      r: r("alert.proforma_due", { ...OWNER, proforma_number: "TH/PRO/2627/0002", balance: "₹11,800.00" }),
    },
    {
      key: "lut-due",
      label: "LUT reminder, next year due (to owners)",
      to: "owner@example.test",
      r: r("lut.reminder", {
        owner_first_name: "Rupak",
        fy_label: "2027-28",
        state: "next_fy_due",
        admin_url: "https://admin.techaust.com/settings/tax",
      }),
    },
    {
      key: "lut-missing",
      label: "LUT reminder, this year missing (to owners)",
      to: "owner@example.test",
      r: r("lut.reminder", {
        owner_first_name: "Rupak",
        fy_label: "2026-27",
        state: "current_missing",
        admin_url: "https://admin.techaust.com/settings/tax",
      }),
    },
  ];
  return (
    <main className="pv-email" id="main">
      <p className="pv-email__label">
        <strong>Preview — sample data.</strong> <Link to="/preview">All sample screens</Link>
      </p>
      <h1 className="pv-email__h1">Billing emails (M5.4)</h1>
      <label className="pv-email__toggle">
        <input type="checkbox" checked={attached} onChange={(e) => setAttached(e.target.checked)} />
        <span>The PDF is attached (document emails; reminders never attach it)</span>
      </label>
      {mails.map(({ key, label, to, r: m }) => (
        <section key={key} id={key} className="pv-email__one" aria-labelledby={`${key}-h`}>
          <h2 id={`${key}-h`}>{label}</h2>
          <dl className="pv-email__head">
            <div>
              <dt>From</dt>
              <dd>
                {m.from.name} &lt;{m.from.address}&gt;, reply to {m.replyTo}
              </dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{to}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>{m.subject}</dd>
            </div>
          </dl>
          <EmailFrame key={`${key}-${attached}`} title={`${label}: HTML version`} html={m.html} />
          <details className="pv-email__text" open>
            <summary>Plain-text version</summary>
            <pre>{m.text}</pre>
          </details>
        </section>
      ))}
    </main>
  );
}

/** Everything under /preview/* (a descendant route tree: main.tsx loads this module lazily, in dev only). */
export function PreviewApp() {
  return (
    <Routes>
      <Route index element={<Index />} />
      <Route path="email" element={<EmailPreview />} />
      <Route path="email-billing" element={<BillingEmailPreview />} />
      <Route path="*" element={<Index />} />
    </Routes>
  );
}
