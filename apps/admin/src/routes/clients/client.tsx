// One client (M3.3, ADM-CLI-01..05): the header with the client code, the identity strip (type, GST status, GSTIN or
// state, currency), and the tabs (ADM-CLI-03), kept in the URL as `?tab=`:
// - Overview, Contacts and Activity for every role that reads clients;
// - Projects and Files (M3.4) for every role that reads projects (not the Accountant: the API denies them too);
// - Proposals and estimates and Care plans as the M3.1 "coming soon" state, with their milestone;
// - Invoices and payments and Statement only for roles with clients.finance.read (never Sales: the API denies them too),
//   with the 07-J lines until invoicing exists.
// What a person has typed and not saved (the details and billing drafts) lives above every reload, as on the lead page.
import { fyOf, istDate, toIsoDate } from "@techaust/core/dates";
import { countryName } from "@techaust/core/form-labels";
import { type ReactNode, useReducer, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { api, type ClientPage, RequestError } from "../../api.ts";
import { EmptyState, PageHeader, Skeleton, StatusPill } from "../../components/display.tsx";
import { FileText, Lock, Receipt } from "../../components/icons.tsx";
import { LoadFailed, NotFound, StaleNotice, useLoad } from "../../components/states.tsx";
import { type TabItem, Tabs } from "../../components/tabs.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { allowed } from "../../lib/access.ts";
import {
  billingOf,
  clientDrafts,
  detailsOf,
  GST_STATUS_LABELS,
  NO_CLIENT_DRAFTS,
  stateText,
  TYPE_LABELS,
} from "../../lib/clients.ts";
import { COPY, PENDING } from "../../lib/projects.ts";
import { useUser } from "../../session.tsx";
import { ClientCarePlans } from "../care/client-tab.tsx";
import { ClientDocuments } from "../documents/client-tab.tsx";
import { ClientProjects } from "../projects/client-tabs.tsx";
import { FilesPanel } from "../projects/files.tsx";
import { Activity } from "./activity.tsx";
import { Contacts } from "./contacts.tsx";
import { INVOICES_LINE, Overview } from "./overview.tsx";
import { ClientsGate, CRUMBS } from "./parts.tsx";

export function Component() {
  const { id = "" } = useParams();
  return (
    <ClientsGate>
      <ClientScreen key={id} id={id} />
    </ClientsGate>
  );
}

type TabKey =
  | "overview"
  | "contacts"
  | "projects"
  | "proposals"
  | "invoices"
  | "statement"
  | "files"
  | "care-plans"
  | "activity";

/** The tabs in the PRD's order; the finance ones only for a finance role, Projects and Files only for a projects role. */
function tabsFor(finance: boolean, projects: boolean): TabItem<TabKey>[] {
  return [
    { key: "overview", label: "Overview" },
    { key: "contacts", label: "Contacts" },
    ...(projects ? ([{ key: "projects", label: "Projects" }] as TabItem<TabKey>[]) : []),
    { key: "proposals", label: "Proposals and estimates" },
    ...(finance
      ? ([
          { key: "invoices", label: "Invoices and payments" },
          { key: "statement", label: "Statement" },
        ] as TabItem<TabKey>[])
      : []),
    ...(projects ? ([{ key: "files", label: "Files" }] as TabItem<TabKey>[]) : []),
    { key: "care-plans", label: "Care plans" },
    { key: "activity", label: "Activity" },
  ];
}

function ClientScreen({ id }: { id: string }) {
  const page = useLoad(() => api.client(id), id);
  const [drafts, draft] = useReducer(clientDrafts, NO_CLIENT_DRAFTS);
  const [seen, setSeen] = useState<ClientPage | null>(null);
  if (page.state === "ready" && page.data !== seen) {
    setSeen(page.data);
    draft({ type: "loaded", details: detailsOf(page.data.client), billing: billingOf(page.data.client) });
  }
  if (page.state === "failed") {
    if (page.error instanceof RequestError && page.error.status === 404) return <NotFound />;
    return (
      <>
        <PageHeader title="Client" crumbs={CRUMBS} />
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      </>
    );
  }
  if (page.state === "loading") return <ClientSkeleton />;
  return (
    <ClientView
      key={page.data.client.updatedAt}
      data={page.data}
      drafts={drafts}
      draft={draft}
      reload={(cause = "own") => {
        if (cause === "stale") draft({ type: "reloaded-latest" });
        page.reload(true);
      }}
    />
  );
}

function ClientView(props: {
  data: ClientPage;
  drafts: ReturnType<typeof clientDrafts>;
  draft: Parameters<typeof Overview>[0]["draft"];
  reload: (cause?: "own" | "stale") => void;
}) {
  const user = useUser();
  const { client } = props.data;
  const finance = allowed(user.role, "clients.finance.read");
  const projects = allowed(user.role, "projects.read");
  const tabs = tabsFor(finance, projects);
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: TabKey = tabs.some((t) => t.key === asked) ? (asked as TabKey) : "overview";
  const select = (k: TabKey) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (k === "overview") n.delete("tab");
        else n.set("tab", k);
        return n;
      },
      { replace: true },
    );
  const [saveStale, setSaveStale] = useState(false);
  const conflict = props.drafts.conflict.details || props.drafts.conflict.billing;
  const dirty =
    (props.drafts.details !== null &&
      JSON.stringify(props.drafts.details.value) !== JSON.stringify(props.drafts.details.base)) ||
    (props.drafts.billing !== null &&
      JSON.stringify(props.drafts.billing.value) !== JSON.stringify(props.drafts.billing.base));

  return (
    <>
      <UnsavedChangesGuard dirty={dirty && !saveStale} what="this client" />
      <PageHeader
        title={client.displayName}
        crumbs={CRUMBS}
        status={
          <>
            <span className="client-code docno">{client.code}</span>
            {client.legalHold && (
              <StatusPill tone="warning" icon="lock">
                Legal hold
              </StatusPill>
            )}
          </>
        }
      />
      <IdentityStrip data={props.data} finance={finance} />
      {props.data.anonymised && <Notice tone="info">{PENDING.clientAnonymised}</Notice>}
      {(saveStale || conflict) &&
        (saveStale ? (
          <StaleNotice title="Someone else changed this client." onReload={() => props.reload("stale")} />
        ) : (
          <StaleNotice
            title="Someone else changed this client while you were editing it."
            body="Your unsaved changes to those fields were set aside so theirs aren't overwritten; anything you had already saved is kept. Reload to see the latest, then make your change again."
            onReload={() => props.reload("stale")}
          />
        ))}
      <Tabs label="Client sections" tabs={tabs} selected={tab} onSelect={select}>
        {tab === "overview" ? (
          <Overview
            data={props.data}
            drafts={props.drafts}
            draft={props.draft}
            reload={props.reload}
            onStale={() => setSaveStale(true)}
            onContacts={() => select("contacts")}
          />
        ) : tab === "contacts" ? (
          <Contacts data={props.data} reload={() => props.reload()} />
        ) : tab === "projects" ? (
          <ClientProjects clientId={client.id} readOnly={props.data.anonymised} />
        ) : tab === "files" ? (
          <FilesPanel
            scope={{ kind: "client", id: client.id }}
            emptyText={COPY.clientFilesEmpty}
            readOnly={props.data.anonymised}
          />
        ) : tab === "activity" ? (
          <Activity clientId={client.id} contacts={props.data.contacts} />
        ) : tab === "invoices" ? (
          <InvoicesTab id={client.id} />
        ) : tab === "statement" ? (
          <StatementTab id={client.id} />
        ) : tab === "care-plans" ? (
          <ClientCarePlans clientId={client.id} readOnly={props.data.anonymised} />
        ) : (
          <ClientDocuments clientId={client.id} readOnly={props.data.anonymised} />
        )}
      </Tabs>
    </>
  );
}

/** The client at a glance, the same for every role: code, type, GST status, GSTIN or state, currency. */
function IdentityStrip({ data, finance }: { data: ClientPage; finance: boolean }) {
  const c = data.client;
  const facts: [string, ReactNode][] = [
    ["Type", TYPE_LABELS[c.type]],
    ["GST status", GST_STATUS_LABELS[c.gstStatus]],
  ];
  if (c.gstin)
    facts.push([
      "GSTIN",
      <span key="g" className="docno">
        {c.gstin}
      </span>,
    ]);
  if (c.gstStatus !== "overseas")
    facts.push([
      "State",
      c.stateCode ? (
        stateText(c.stateCode)
      ) : (
        <span key="s" className="muted">
          Not set yet
        </span>
      ),
    ]);
  else facts.push(["Country", countryName(c.country)]);
  facts.push([
    "Currency",
    <span key="c" className="strip-currency">
      <span className="docno">{c.currency}</span>
      {finance && data.currencyLocked && (
        <span className="strip-lock" title="The currency can't change once this client has an invoice.">
          <Lock size={16} />
          <span>Locked</span>
        </span>
      )}
    </span>,
  ]);
  return (
    <dl className="client-strip">
      {facts.map(([label, v]) => (
        <div key={label} className="client-strip__fact">
          <dt>{label}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Invoices and payments (finance roles): GET /finance answers `{available:false}` until invoicing (M5/M6). */
function InvoicesTab({ id }: { id: string }) {
  const fin = useLoad(() => api.clientFinance(id), id);
  if (fin.state === "failed") return <LoadFailed error={fin.error} onRetry={() => fin.reload()} />;
  return (
    <EmptyState icon={<Receipt />} title="Invoices and payments">
      <p>{INVOICES_LINE}</p>
    </EmptyState>
  );
}

/** The statement of account (ADM-CLI-04; finance roles): this financial year so far, `{available:false}` until M5. */
function StatementTab({ id }: { id: string }) {
  const now = Date.now();
  const from = toIsoDate(istDate(fyOf(now).startMs));
  const to = toIsoDate(istDate(now));
  const st = useLoad(() => api.clientStatement(id, from, to), `${id}:${from}:${to}`);
  if (st.state === "failed") return <LoadFailed error={st.error} onRetry={() => st.reload()} />;
  return (
    <EmptyState icon={<FileText />} title="Statement of account">
      <p>Statements arrive with invoicing. There's nothing to show yet.</p>
    </EmptyState>
  );
}

function ClientSkeleton() {
  return (
    <>
      <PageHeader title="Client" crumbs={CRUMBS} />
      <p className="visually-hidden" role="status">
        Loading the client
      </p>
      <div className="client-strip client-strip--skeleton" aria-hidden="true">
        <Skeleton width="60%" />
      </div>
      <div className="lead-page" aria-hidden="true">
        <div className="lead-page__main">
          <div className="lead-panel stack-sm">
            <Skeleton width="30%" />
            <Skeleton width="80%" />
            <Skeleton width="65%" />
          </div>
        </div>
        <div className="lead-page__side">
          <div className="lead-panel stack-sm">
            <Skeleton width="40%" />
            <Skeleton width="70%" />
          </div>
        </div>
      </div>
    </>
  );
}
