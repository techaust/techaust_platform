// Home (M7.1; POR-04, POR-06, POR-07, POR-08; run file G.2): one read (`GET /home`, one batch), then, in this order: what awaits a decision (M4.5's cards),
// the money (invoices to pay with a Pay link to each one's page, and the recent receipts with their PDFs; only for a contact who can see finance: the API
// sends null otherwise and the blocks aren't drawn), the projects, and the notes and files shared with the client. Loading is the quiet skeleton; a failed
// read keeps the page's title and offers to reload; every block has its own empty line. Nothing here is a view of a document (RA-10). Words: copy-zp.ts
// (C2 to C5, marked until approved), 07-N, 07-U, 07-ZI line 1.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { type HomeData, type HomeReceipt, invoicesApi, portalApi, RequestError } from "../../api.ts";
import { ArrowRight, FileCheck, FolderKanban, Receipt, Users } from "../../components/icons.tsx";
import { LoadProblemScreen } from "../../components/load-problem.tsx";
import { PageTitle } from "../../components/shell/portal-shell.tsx";
import { COPY } from "../../copy.ts";
import { N, WORDS } from "../../copy-documents.ts";
import { INV } from "../../copy-invoices.ts";
import { PAY_ZI } from "../../copy-zi.ts";
import { ZP } from "../../copy-zp.ts";
import { clientStatus, todayIst, typeLabel } from "../../lib/invoices.ts";
import { formatMoneyOf } from "../../lib/m71.ts";
import { dateText } from "../../lib/offers.ts";
import { useMe } from "../../session.tsx";
import { Awaiting, ScreenSkeleton } from "../home.tsx";
import { InvoiceStatusPill, invoiceHref } from "../invoices.tsx";
import {
  DownloadButton,
  type Downloads,
  EmptyLine,
  FilesTable,
  NoteCard,
  ProjectPill,
  projectHref,
  useDownloads,
} from "./shared.tsx";

export const offerHref = (id: string) => `/proposals/${encodeURIComponent(id)}`;

type State = { phase: "loading" } | { phase: "ready"; data: HomeData } | { phase: "failed"; error: unknown };

/** `/`: the route. */
export function Component() {
  const me = useMe();
  const [state, setState] = useState<State>({ phase: "loading" });
  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      setState({ phase: "ready", data: await portalApi.home() });
    } catch (e) {
      // 401: the session provider has gone back to the sign-in screen.
      if (!(e instanceof RequestError && e.status === 401)) setState({ phase: "failed", error: e });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (state.phase === "failed")
    return <LoadProblemScreen title={me.organisation.displayName} error={state.error} onRetry={load} />;
  if (state.phase === "loading") return <ScreenSkeleton label={COPY.loading} />;
  return <HomeScreen org={me.organisation.displayName} contactName={me.contact.name} data={state.data} />;
}

export function HomeScreen(props: { org: string; contactName: string; data: HomeData; now?: number }) {
  const d = props.data;
  const downloads = useDownloads();
  const names = new Map(d.projects.map((p) => [p.id, p.name]));
  return (
    <div className="screen m71-home">
      <header className="screen__head">
        <PageTitle text={props.org} className="screen__title">
          {props.org}
        </PageTitle>
        <p className="screen__lede">
          {WORDS.signedInAs} <strong>{props.contactName}</strong>
        </p>
      </header>

      <Awaiting
        docs={d.awaiting}
        hrefOf={(o) => offerHref(o.id)}
        more={
          <p className="block__more">
            <Link to="/proposals" className="textlink">
              {N.backToList}
              <ArrowRight size={16} />
            </Link>
          </p>
        }
      />

      {/* RB-31: the money blocks exist only when the API sent them (a contact who can see finance), never as an empty block. */}
      {(d.toPay !== null || d.receipts !== null) && (
        <div className="block m71-money">
          {d.toPay !== null && <ToPay items={d.toPay} now={props.now} />}
          {d.receipts !== null && <RecentReceipts items={d.receipts} downloads={downloads} />}
        </div>
      )}

      <section className="block" aria-labelledby="home-projects-h">
        <h2 id="home-projects-h" className="block__title">
          {ZP.projectsTitle}
        </h2>
        {d.projects.length === 0 ? (
          <EmptyLine icon={<FolderKanban size={24} />}>{N.soon.projects}</EmptyLine>
        ) : (
          <ul className="m71-pcards">
            {d.projects.map((p) => (
              <li key={p.id}>
                <Link to={projectHref(p.id)} className="m71-pcard">
                  <span className="m71-pcard__top">
                    {p.code && <span className="m71-pcard__code docno">{p.code}</span>}
                    <ProjectPill status={p.status} />
                  </span>
                  <span className="m71-pcard__name">{p.name}</span>
                  {(p.startDate || p.targetDate) && (
                    <span className="m71-pcard__dates">
                      {p.startDate && <span>{ZP.started(dateText(p.startDate))}</span>}
                      {p.targetDate && <span>{ZP.target(dateText(p.targetDate))}</span>}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="block__more">
          <Link to="/projects" className="textlink">
            {WORDS.nav.projects}
            <ArrowRight size={16} />
          </Link>
        </p>
      </section>

      <section className="block" aria-labelledby="home-shared-h">
        <h2 id="home-shared-h" className="block__title">
          {ZP.sharedTitle}
        </h2>
        <p className="m71-lede">{ZP.sharedLede}</p>
        {d.notes.length === 0 && d.files.length === 0 ? (
          <EmptyLine icon={<Users size={24} />}>{ZP.sharedEmpty}</EmptyLine>
        ) : (
          <div className="m71-shared">
            {d.notes.length > 0 && (
              <div className="m71-shared__col">
                <h3 className="m71-subtitle">{ZP.notes}</h3>
                <ul className="m71-notes">
                  {d.notes.map((n) => {
                    const name = n.projectId ? names.get(n.projectId) : undefined;
                    return (
                      <li key={n.id}>
                        <NoteCard
                          note={n}
                          headingLevel={4}
                          clamp={n.projectId !== null && name !== undefined}
                          project={n.projectId && name ? { href: projectHref(n.projectId), name } : null}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {d.files.length > 0 && (
              <div className="m71-shared__col">
                <h3 className="m71-subtitle">{ZP.files}</h3>
                <FilesTable
                  caption={ZP.files}
                  files={d.files}
                  downloads={downloads}
                  onDownload={(f) => downloads.run(f.id, () => portalApi.file(f.id), f.filename, ZP.fileGone)}
                />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** C2: what the organisation still has to pay, soonest due first (at most five); each row opens its page, where it is paid. */
function ToPay(props: { items: NonNullable<HomeData["toPay"]>; now?: number | undefined }) {
  const today = todayIst(props.now);
  return (
    <section className="m71-money__col" aria-labelledby="home-topay-h">
      <h2 id="home-topay-h" className="block__title">
        <Receipt size={20} />
        {ZP.toPayTitle}
      </h2>
      {props.items.length === 0 ? (
        <p className="muted m71-money__empty">{ZP.toPayEmpty}</p>
      ) : (
        <ul className="m71-rows">
          {props.items.map((d) => {
            const s = clientStatus(d, today);
            return (
              <li key={d.id} className="m71-row">
                <span className="m71-row__main">
                  <Link to={invoiceHref(d.id)} className="m71-row__link docno">
                    {d.numberDisplay ?? "–"}
                  </Link>
                  <span className="m71-row__meta">
                    {typeLabel(d.type)}
                    {d.dueDate && <span className="nowrap">{`, ${INV.dueOn(dateText(d.dueDate))}`}</span>}
                  </span>
                </span>
                <span className="m71-row__figure">
                  <span className="m71-row__label">{INV.balanceDue}</span>
                  <span className="m71-row__amount">{d.balance}</span>
                  {(s === "overdue" || s === "due") && <InvoiceStatusPill status={s} />}
                </span>
                <Link to={invoiceHref(d.id)} className="btn btn--primary m71-row__act">
                  {PAY_ZI.payNow}
                  <span className="visually-hidden">{` ${d.numberDisplay ?? ""}`}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="block__more">
        <Link to="/invoices" className="textlink">
          {INV.title}
          <ArrowRight size={16} />
        </Link>
      </p>
    </section>
  );
}

/** C3: the latest receipts, each with its PDF (M6.5's route); the way to the full list. */
function RecentReceipts(props: { items: HomeReceipt[]; downloads: Downloads }) {
  return (
    <section className="m71-money__col" aria-labelledby="home-receipts-h">
      <h2 id="home-receipts-h" className="block__title">
        <FileCheck size={20} />
        {ZP.receiptsTitle}
      </h2>
      {props.items.length === 0 ? (
        <p className="muted m71-money__empty">{ZP.receiptsEmpty}</p>
      ) : (
        <ul className="m71-rows">
          {props.items.map((r) => (
            <li key={r.id} className="m71-row">
              <span className="m71-row__main">
                <span className="m71-row__strong docno">{r.numberDisplay ?? "–"}</span>
                <span className="m71-row__meta">{r.issueDate ? dateText(r.issueDate) : ""}</span>
              </span>
              <span className="m71-row__figure">
                <span className="m71-row__amount">{formatMoneyOf(r.amountMinor, r.currency)}</span>
              </span>
              <DownloadButton
                id={r.id}
                label={ZP.downloadPdf}
                what={r.numberDisplay ?? ""}
                downloads={props.downloads}
                onPress={() =>
                  props.downloads.run(
                    r.id,
                    () => invoicesApi.receiptPdf(r.id),
                    `${(r.numberDisplay ?? "receipt").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`,
                    COPY.server,
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      <p className="block__more">
        <Link to="/receipts" className="textlink">
          {ZP.allReceipts}
          <ArrowRight size={16} />
        </Link>
      </p>
    </section>
  );
}
