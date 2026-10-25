// PREVIEW ONLY (dev server, never built): the M4.5 admin side with sample data, at /preview/send. main.tsx adds this route
// only when import.meta.env.DEV. A proposal page in the real shell with (1) the Send dialog [ADM-PROP-07]: the client's
// portal-access contacts (billing contacts ticked), the attach-PDF switch that starts from the client's setting, the
// message as it will be sent, and "Send"; and (2) after acceptance [ADM-PROP-09], the acceptance record and "Start
// project" with its confirmation. No API calls; nothing is saved. New words are "[Placeholder]"s until 07-N.
import "../shell.css";
import "../screens.css";
import "./preview.css";
import { formatIstDateTime, formatMoney, fromIst, money } from "@techaust/core";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { Modal } from "../components/dialog.tsx";
import { PageHeader, StatusPill } from "../components/display.tsx";
import { Switch } from "../components/form.tsx";
import { FolderKanban, Send } from "../components/icons.tsx";
import { AppShell } from "../components/shell/app-shell.tsx";
import { navFor } from "../components/shell/nav.tsx";
import { AccountMenu } from "../components/shell/top-menus.tsx";
import { ToastProvider, useToast } from "../components/toast.tsx";
import { FieldError } from "../components/ui.tsx";

const Ph = ({ children }: { children: string }) => (
  <>
    <span className="ph">[Placeholder]</span> {children}
  </>
);

// Sample data, made up and labelled. The total and the first instalment are the portal preview's M4.2 engine figures.
const DOC = {
  title: "Invoice-to-Tally automation pilot",
  number: "TH/PRP/2627/0003",
  version: 2,
  client: "Kestrel Distributors Pvt Ltd (sample)",
  totalMinor: 32_214_000,
  firstMinor: 12_885_600,
  validUntil: "02 Nov 2026",
};
const CONTACTS = [
  { id: "c1", name: "Asha Iyer", email: "asha.iyer@kestrel.example.test", role: "Billing", billing: true },
  { id: "c2", name: "Rahul Sen", email: "rahul.sen@kestrel.example.test", role: "Billing", billing: true },
  {
    id: "c3",
    name: "Meera Das",
    email: "meera.das@kestrel.example.test",
    role: "Operations",
    billing: false,
  },
];
/** The client's "Attach PDF" setting (M3.3, off by default). */
const CLIENT_ATTACHES_PDF = false;
const inr = (minor: number) => formatMoney(money(minor, "INR"));
const ACCEPTED_AT = fromIst({ year: 2026, month: 10, day: 25 }, 11, 42);

function SendDialog(props: { open: boolean; onClose: () => void; onSent: (n: number) => void }) {
  const [picked, setPicked] = useState(() => new Set(CONTACTS.filter((c) => c.billing).map((c) => c.id)));
  const [attach, setAttach] = useState(CLIENT_ATTACHES_PDF);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groupId = useId();
  const attachId = useId();
  const first = CONTACTS.filter((c) => picked.has(c.id))[0];

  async function send(e: FormEvent) {
    e.preventDefault();
    if (picked.size === 0) {
      setError("Choose at least one contact.");
      document.getElementById(`${groupId}-0`)?.focus();
      return;
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 700));
    setBusy(false);
    props.onSent(picked.size);
  }

  return (
    <Modal
      open={props.open}
      title={`Send ${DOC.number} v${DOC.version}`}
      onClose={props.onClose}
      busy={busy}
      wide
    >
      <form className="sendd" noValidate onSubmit={send}>
        <div className="sendd__form">
          <fieldset
            className="radios sendd__to"
            aria-describedby={`${groupId}-hint${error ? ` ${groupId}-error` : ""}`}
          >
            <legend>Send to</legend>
            <p className="hint" id={`${groupId}-hint`}>
              <Ph>
                Contacts with portal access. Billing contacts are ticked. Give someone access on the client's
                Contacts tab.
              </Ph>
            </p>
            {CONTACTS.map((c, i) => (
              <label key={c.id} className="check sendd__contact">
                <input
                  id={`${groupId}-${i}`}
                  type="checkbox"
                  checked={picked.has(c.id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    setPicked(next);
                    setError(null);
                  }}
                />
                <span>
                  <span className="sendd__name">{c.name}</span>
                  <span className="sendd__meta">
                    {c.email}, {c.role}
                  </span>
                </span>
              </label>
            ))}
            {error && <FieldError id={`${groupId}-error`}>{error}</FieldError>}
          </fieldset>
          <div className="sendd__attach">
            <div>
              <p className="sendd__label" id={`${attachId}-label`}>
                Attach the PDF
              </p>
              <p className="hint" id={`${attachId}-hint`}>
                <Ph>
                  Starts from this client's setting (off: the email carries the portal link only). A change
                  here applies to this email only.
                </Ph>
              </p>
            </div>
            <Switch
              id={attachId}
              checked={attach}
              onChange={setAttach}
              labelledBy={`${attachId}-label`}
              describedBy={`${attachId}-hint`}
            />
          </div>
        </div>
        <section className="sendd__preview" aria-labelledby={`${groupId}-pv`}>
          <h3 id={`${groupId}-pv`} className="sendd__label">
            <Ph>The message</Ph>
          </h3>
          <dl className="sendd__head">
            <div>
              <dt>From</dt>
              <dd>TecHaust Technologies, hello@techaust.com</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>
                Proposal: {DOC.title} ({DOC.number} v{DOC.version})
              </dd>
            </div>
          </dl>
          <div className="sendd__body">
            <p>
              Hi {first ? first.name.split(" ")[0] : "‹first name›"}, your proposal is ready. It covers scope,
              timeline, price and payment schedule, and it's valid until {DOC.validUntil}.
            </p>
            <p className="sendd__facts">
              Total {inr(DOC.totalMinor)}, valid until {DOC.validUntil}
            </p>
            <p>
              <span className="sendd__btn">Review and accept</span>
            </p>
            {attach && (
              <p>
                <Ph>The proposal is attached to this email as a PDF.</Ph>
              </p>
            )}
            <p className="muted">Questions? Just reply to this email.</p>
          </div>
          <p className="hint">
            <Ph>
              Each contact gets their own email and link. The words come from 07 §8; the full design is on the
              portal's /preview/email.
            </Ph>
          </p>
        </section>
        <div className="dialog__actions sendd__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            <Send size={20} />
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="pv-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Page() {
  const [params] = useSearchParams();
  const toast = useToast();
  const [state, setState] = useState<"draft" | "sent" | "accepted" | "started">(
    params.get("state") === "accepted" ? "accepted" : "draft",
  );
  const [sending, setSending] = useState(params.get("open") === "send");
  const [starting, setStarting] = useState(params.get("open") === "start");
  useEffect(() => {
    document.title = "Send – preview";
  }, []);

  const status =
    state === "draft" ? (
      <StatusPill tone="neutral" icon="pencil">
        Draft
      </StatusPill>
    ) : state === "sent" ? (
      <StatusPill tone="info" icon="send">
        Sent
      </StatusPill>
    ) : (
      <StatusPill tone="success" icon="check">
        Accepted
      </StatusPill>
    );

  const action =
    state === "draft" ? (
      <button type="button" className="btn btn--primary" onClick={() => setSending(true)}>
        <Send size={20} />
        Send
      </button>
    ) : state === "accepted" ? (
      <button type="button" className="btn btn--primary" onClick={() => setStarting(true)}>
        <FolderKanban size={20} />
        Start project
      </button>
    ) : null;

  return (
    <>
      <PageHeader
        title={DOC.title}
        crumbs={[{ label: "Proposals" }]}
        status={status}
        action={action}
        lede={
          <>
            {DOC.number}, version {DOC.version}, for {DOC.client}
          </>
        }
      />
      <div className="pv-cards">
        <section className="pv-card" aria-labelledby="sum-h">
          <h2 id="sum-h">
            <Ph>This version</Ph>
          </h2>
          <Facts
            rows={[
              [
                "Total",
                <span key="t" className="tabular">
                  {inr(DOC.totalMinor)}
                </span>,
              ],
              ["Valid until", DOC.validUntil],
              ["Client", DOC.client],
            ]}
          />
        </section>
        {(state === "accepted" || state === "started") && (
          <section className="pv-card" aria-labelledby="acc-h">
            <h2 id="acc-h">
              <Ph>Acceptance</Ph>
            </h2>
            <Facts
              rows={[
                ["Accepted by", "Asha Iyer (asha.iyer@kestrel.example.test)"],
                ["Date and time", formatIstDateTime(ACCEPTED_AT)],
                ["Document fingerprint", "3f9a1c0b7e24"],
                ["Evidence", "IP address and browser kept with the record (VERIFY WITH CA/LEGAL)"],
              ]}
            />
          </section>
        )}
        {state === "started" && (
          <p className="pv-done">
            <Ph>
              Project PRJ-0007 is set up. The first instalment's proforma is a draft for the owner to issue.
            </Ph>{" "}
            <Link to="/preview/send">Back to the start of the preview</Link>
          </p>
        )}
      </div>

      <SendDialog
        open={sending}
        onClose={() => setSending(false)}
        onSent={(n) => {
          setSending(false);
          setState("sent");
          toast("success", `Sent to ${n} contact${n === 1 ? "" : "s"}.`);
        }}
      />
      <ConfirmDialog
        open={starting}
        title="Start the project?"
        confirmLabel="Start project"
        busyLabel="Starting…"
        onClose={() => setStarting(false)}
        onConfirm={async () => {
          await new Promise((r) => setTimeout(r, 700));
          setState("started");
          setStarting(false);
          toast("success", "Project PRJ-0007 started.");
          return undefined;
        }}
      >
        <p>
          <Ph>This sets up the project from the accepted version and drafts the first instalment.</Ph>
        </p>
        <Facts
          rows={[
            ["Project", `PRJ-0007, ${DOC.title}`],
            ["Milestones", "3, from the payment schedule"],
            ["First instalment", `Proforma (draft), ${inr(DOC.firstMinor)}, 40 % on acceptance`],
          ]}
        />
        <p className="hint">
          <Ph>
            Nothing is sent to the client. The proforma stays a draft until the owner issues it. Pressing
            twice still makes one project.
          </Ph>
        </p>
      </ConfirmDialog>
    </>
  );
}

export function SendPreview() {
  return (
    <>
      <div className="pv-bar" role="region" aria-label="Preview">
        <p>
          <strong>Preview — sample data</strong> Nothing is saved or sent.{" "}
          <Link to="/preview/send">Before sending</Link> ·{" "}
          <Link to="/preview/send?state=accepted">After acceptance</Link>
        </p>
      </div>
      <ToastProvider>
        <AppShell
          items={navFor("owner")}
          current="proposals"
          hrefOf={(i) => `/preview/send#${i.key}`}
          homeHref="/preview/send"
          search={null}
          bell={null}
          account={
            <AccountMenu
              user={{ name: "Sample Owner", email: "owner@example.test", role: "owner" }}
              accountHref="/preview/send"
              onSignOut={() => {}}
            />
          }
        >
          <Page />
        </AppShell>
      </ToastProvider>
    </>
  );
}
