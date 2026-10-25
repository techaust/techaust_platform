// PREVIEW ONLY: the M4.5 design preview on the dev server, at /preview/*. main.tsx adds this route only when
// import.meta.env.DEV, so the production bundle has no preview route and no sample data (the build check proves it).
// Sample data only: no API call is made and nothing is saved; every action changes this page's state and says so in the
// preview bar.
import "./preview.css";
import { formatDate, formatIstDateTime } from "@techaust/core";
import badge from "@techaust/ui/brand/logo-email-badge@2x.png?url";
import logoDarkPng from "@techaust/ui/brand/logo-email-dark@2x.png?url";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useParams, useSearchParams } from "react-router";
import { LogIn } from "../components/icons.tsx";
import { Ph } from "../components/pending.tsx";
import { type NavKey, PortalShell, TokenShell } from "../components/shell/portal-shell.tsx";
import { COPY } from "../copy.ts";
import { PENDING } from "../copy-documents.ts";
import { amount, type DocumentView } from "../lib/document-view.ts";
import { DocumentPage } from "../screens/document-page.tsx";
import { DocumentsScreen, HomeScreen, NotFoundScreen, SoonScreen } from "../screens/home.tsx";
import { proposalAccepted, proposalSent } from "./emails.ts";
import { ESTIMATE, ME, ORG, STATES, type StateKey, summaryOf } from "./sample.ts";

/** Any base works: EmailFrame swaps the logo URLs for the dev server's own. */
const BASE = "/preview-assets/";

const HREF: Record<NavKey, string> = {
  home: "/preview/home",
  documents: "/preview/proposals",
  invoices: "/preview/invoices",
  projects: "/preview/projects",
  profile: "/preview/profile",
};
const hrefOf = (k: NavKey) => HREF[k];

// ---------- The preview bar: the label every screen carries, the screen list and what an action would have done ----------

const Say = createContext<(text: string) => void>(() => {});
const useSay = () => useContext(Say);

const SCREENS: [string, string][] = [
  ["/preview/shell", "Shell (account menu open)"],
  ["/preview/home", "Home"],
  ["/preview/home?empty=1", "Home, empty"],
  ["/preview/proposals", "Proposals and estimates"],
  ...Object.entries(STATES).map(([k, s]): [string, string] => [
    `/preview/proposal?state=${k}`,
    `Proposal: ${s.label}`,
  ]),
  ["/preview/proposal?state=viewed&fail=1", "Proposal: accept fails (network)"],
  ["/preview/token", "Token view (from the email link)"],
  ["/preview/proposal/other-client", "Another client's document (404)"],
  ["/preview/invoices", "Invoices (coming soon)"],
  ["/preview/projects", "Projects (coming soon)"],
  ["/preview/profile", "Profile (coming soon)"],
  ["/preview/email", "Emails"],
];

function PreviewBar(props: { said: string }) {
  const { pathname, search } = useLocation();
  const here = pathname + search;
  return (
    <section className="pv" aria-label="Preview">
      <div className="pv__row">
        <p className="pv__label">
          <strong>Preview — sample data</strong>
          <span className="pv__sub">
            Nothing is saved or sent. Light or dark follows your system setting.
          </span>
        </p>
        <details className="pv__screens">
          <summary>Screens</summary>
          <ul>
            {SCREENS.map(([to, label]) => (
              <li key={to}>
                <Link to={to} aria-current={here === to ? "page" : undefined}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <p className="pv__said" role="status">
        {props.said}
      </p>
    </section>
  );
}

function PreviewFrame({ children }: { children: ReactNode }) {
  const [said, setSaid] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const say = useCallback((text: string) => {
    setSaid(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaid(""), 8000);
  }, []);
  return (
    <Say.Provider value={say}>
      <PreviewBar said={said} />
      {children}
    </Say.Provider>
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function useAccount() {
  const say = useSay();
  return {
    org: ORG,
    contact: ME,
    onSignOut: async () => {
      await wait(400);
      say("Preview: Sign out would end this session and show the sign-in screen.");
    },
    onSignOutAll: async () => {
      await wait(400);
      say("Preview: this would end every portal session of this contact for this organisation.");
    },
  };
}

function Shell(props: { current: NavKey | null; children: ReactNode; accountOpen?: boolean }) {
  return (
    <PortalShell
      current={props.current}
      hrefOf={hrefOf}
      account={useAccount()}
      accountOpen={props.accountOpen}
    >
      {props.children}
    </PortalShell>
  );
}

// ---------- Screens ----------

const docHref = (id: string) =>
  id === ESTIMATE.id ? "/preview/proposal?state=sent" : "/preview/proposal?state=viewed";

function HomePreview() {
  const [params] = useSearchParams();
  const empty = params.get("empty") === "1";
  const awaiting = empty ? [] : [summaryOf(STATES.sent.doc), ESTIMATE];
  return (
    <Shell current="home">
      <HomeScreen org={ORG} contactName={ME.name} awaiting={awaiting} hrefOf={(d) => docHref(d.id)} />
    </Shell>
  );
}

function ListPreview() {
  return (
    <Shell current="documents">
      <DocumentsScreen
        awaiting={[summaryOf(STATES.viewed.doc), ESTIMATE]}
        decided={[
          {
            ...summaryOf(STATES.accepted.doc),
            id: "a",
            title: "Discovery Sprint",
            number: "TH/PRP/2627/0001",
          },
          {
            ...summaryOf(STATES.declined.doc),
            id: "b",
            title: "WhatsApp order reminders",
            number: "TH/EST/2627/0002",
          },
          {
            ...summaryOf(STATES.expired.doc),
            id: "c",
            title: "Dealer ordering portal",
            number: "TH/PRP/2526/0014",
          },
        ]}
        hrefOf={(d) =>
          d.id === "a"
            ? "/preview/proposal?state=accepted"
            : d.id === "b"
              ? "/preview/proposal?state=declined"
              : d.id === "c"
                ? "/preview/proposal?state=expired"
                : docHref(d.id)
        }
      />
    </Shell>
  );
}

/** The document with its decision live in this page's state: accept or decline it here and the page follows. */
function useLiveDocument(start: DocumentView, fail: boolean) {
  const say = useSay();
  const [doc, setDoc] = useState(start);
  useEffect(() => setDoc(start), [start]);
  return {
    doc,
    me: ME,
    onAccept: async (typedName: string) => {
      await wait(700);
      if (fail) throw new Error(COPY.network);
      setDoc((d) => ({
        ...d,
        status: "accepted",
        acceptance: { name: typedName, email: ME.email, atMs: Date.now(), fingerprint: d.fingerprint },
      }));
      say("Preview: the acceptance would be recorded and confirmed by email to both sides.");
    },
    onDecline: async (reason: string, note: string | null) => {
      await wait(700);
      if (fail) throw new Error(COPY.network);
      setDoc((d) => ({
        ...d,
        status: "declined",
        decline: { name: ME.name, atMs: Date.now(), reason, note },
      }));
      say("Preview: the reason would be saved on the proposal and the team told.");
    },
    onDownload: (what: "accepted" | "certificate") =>
      say(
        what === "accepted"
          ? "Preview: this would download the accepted PDF (not connected)."
          : "Preview: this would download the acceptance certificate PDF (not connected).",
      ),
    onDownloadPdf: () => say("Preview: this would download the PDF (not connected)."),
  };
}

function ProposalPreview() {
  const [params] = useSearchParams();
  const key = (params.get("state") ?? "viewed") as StateKey;
  const start = (STATES[key] ?? STATES.viewed).doc;
  const live = useLiveDocument(start, params.get("fail") === "1");
  return (
    <Shell current="documents">
      <DocumentPage {...live} backHref={HREF.documents} />
    </Shell>
  );
}

function TokenPreview() {
  const live = useLiveDocument(STATES.sent.doc, false);
  return (
    <TokenShell>
      <DocumentPage
        {...live}
        backHref={null}
        notices={
          <div className="notice notice--info notice--action" role="note">
            <LogIn size={20} />
            <div>
              <Ph>{PENDING.token}</Ph>
            </div>
            <Link to="/preview/home" className="btn btn--secondary">
              {COPY.signIn.title}
            </Link>
          </div>
        }
      />
    </TokenShell>
  );
}

function SoonPreview() {
  const { section } = useParams();
  const s = section === "projects" || section === "profile" ? section : "invoices";
  return (
    <Shell current={s}>
      <SoonScreen section={s} org={ORG} />
    </Shell>
  );
}

function ShellPreview() {
  return (
    <Shell current="invoices" accountOpen>
      <SoonScreen section="invoices" org={ORG} />
    </Shell>
  );
}

function OtherClient() {
  return (
    <Shell current="documents">
      <NotFoundScreen homeHref={HREF.home} />
    </Shell>
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
      // The layout names the logos with "@" percent-encoded (for Workers static assets); the dev server wants the files'
      // own URLs, absolute (a srcdoc frame has no base of its own).
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

function EmailPreview() {
  const base = BASE;
  const doc = STATES.viewed.doc;
  const [attached, setAttached] = useState(false);
  const sent = proposalSent(
    {
      firstName: "Asha",
      to: `${ME.name} <${ME.email}>`,
      title: doc.title,
      number: doc.number,
      version: doc.version,
      total: amount(doc.computed.totalMinor, doc.currency),
      validUntil: formatDate(doc.validUntil),
      url: "https://portal.techaust.com/proposals/sample-prp-0003",
      attached,
    },
    base,
  );
  const accepted = proposalAccepted(
    {
      to: `${ME.name} <${ME.email}>; hello@techaust.com`,
      typedName: ME.name,
      title: doc.title,
      number: doc.number,
      version: doc.version,
      acceptedAt: formatIstDateTime(STATES.accepted.doc.acceptance?.atMs ?? 0),
      pdfUrl: "https://portal.techaust.com/proposals/sample-prp-0003/accepted.pdf",
      certificateUrl: "https://portal.techaust.com/proposals/sample-prp-0003/certificate.pdf",
    },
    base,
  );
  useEffect(() => {
    document.title = "Emails – preview";
  }, []);
  return (
    <main className="pv-email" id="main">
      <h1 className="pv-email__h1">Emails</h1>
      <label className="pv-email__toggle">
        <input type="checkbox" checked={attached} onChange={(e) => setAttached(e.target.checked)} />
        <span>The client's setting attaches the PDF</span>
      </label>
      {[
        { key: "sent", label: "Proposal sent (to the chosen contacts)", mail: sent },
        { key: "accepted", label: "Acceptance confirmation (to both sides)", mail: accepted },
      ].map(({ key, label, mail }) => (
        <section key={key} className="pv-email__one" aria-labelledby={`${key}-h`}>
          <h2 id={`${key}-h`}>{label}</h2>
          <dl className="pv-email__head">
            <div>
              <dt>From</dt>
              <dd>{mail.from}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{mail.to}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>{mail.subject}</dd>
            </div>
          </dl>
          <EmailFrame key={`${key}-${attached}`} title={`${label}: HTML version`} html={mail.html} />
          <details className="pv-email__text">
            <summary>Plain-text version</summary>
            <pre>{mail.text}</pre>
          </details>
        </section>
      ))}
    </main>
  );
}

/** Everything under /preview/* (a descendant route tree: main.tsx loads this module lazily, in dev only). */
export function PreviewApp() {
  return (
    <PreviewFrame>
      <Routes>
        <Route index element={<Navigate to="/preview/home" replace />} />
        <Route path="shell" element={<ShellPreview />} />
        <Route path="home" element={<HomePreview />} />
        <Route path="proposals" element={<ListPreview />} />
        <Route path="proposal" element={<ProposalPreview />} />
        <Route path="proposal/:other" element={<OtherClient />} />
        <Route path="token" element={<TokenPreview />} />
        <Route path="email" element={<EmailPreview />} />
        <Route path=":section" element={<SoonPreview />} />
      </Routes>
    </PreviewFrame>
  );
}
