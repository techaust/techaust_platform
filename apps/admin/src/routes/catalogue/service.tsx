// One service (M4.1, ADM-CAT-02, -04): the page every role reads (description, prices and tax, default lines, the payment
// schedule, what's included, the website and the price history), and for the owner the same page as one form (Edit), with
// Retire or Make active again behind the 07-L confirmations. The edit follows the M3.2 drafts pattern: what the owner has
// typed lives above every reload of the page, only the changed fields are sent with the `updatedAt` they were loaded with, a
// reload that clashes with a draft drops only that field and says so, and a 409 `stale_version` shows the stale notice.
import { isSiteReferenced } from "@techaust/core/site-references";
import { type FormEvent, type ReactNode, useState } from "react";
import { useParams } from "react-router";
import {
  type CatalogueEntry,
  type CataloguePage,
  catalogueApi,
  errorText,
  type PriceChangeRow,
  RequestError,
} from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { PageHeader, Skeleton, When } from "../../components/display.tsx";
import { ErrorSummary, SaveBar } from "../../components/form.tsx";
import { Archive, Pencil, RotateCcw } from "../../components/icons.tsx";
import { Markdown } from "../../components/markdown.tsx";
import { LoadFailed, NotFound, StaleNotice, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import {
  buildEntry,
  CATEGORY_LABELS,
  COPY,
  changedKeys,
  type EntryForm,
  ERRORS,
  entryPatch,
  type FieldErrors,
  fieldOfCode,
  formOf,
  historyText,
  milliToQty,
  PENDING,
  rebaseEntry,
  saveFailureText,
  TOASTS,
  UNIT_LABELS,
} from "../../lib/catalogue.ts";
import { bpToPercent } from "../../lib/settings-form.ts";
import type { Draft } from "../leads/drafts.ts";
import { EntryMain, EntrySide } from "./editor.tsx";
import { CatalogueGate, CRUMBS, ItemPills, Prices, ScheduleView, useCanWrite } from "./parts.tsx";

export function Component() {
  const { id = "" } = useParams();
  return (
    <CatalogueGate>
      <ServiceScreen key={id} id={id} />
    </CatalogueGate>
  );
}

type Drafts = { draft: Draft<EntryForm> | null; conflict: boolean };

function ServiceScreen({ id }: { id: string }) {
  const page = useLoad(() => catalogueApi.item(id), id);
  const [drafts, setDrafts] = useState<Drafts>({ draft: null, conflict: false });
  const [seen, setSeen] = useState<CataloguePage | null>(null);
  // A fresh copy of the entry: carry an open draft onto it (untouched fields follow the store).
  if (page.state === "ready" && page.data !== seen) {
    setSeen(page.data);
    if (drafts.draft) {
      const r = rebaseEntry(drafts.draft, formOf(page.data.item));
      setDrafts({ draft: r.draft, conflict: drafts.conflict || r.conflict });
    }
  }
  if (page.state === "failed") {
    if (page.error instanceof RequestError && (page.error.status === 404 || page.error.status === 400))
      return <NotFound />;
    return (
      <>
        <PageHeader title="Service" crumbs={CRUMBS} />
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      </>
    );
  }
  if (page.state === "loading") return <ServiceSkeleton />;
  return (
    <ServiceView
      data={page.data}
      drafts={drafts}
      setDrafts={setDrafts}
      reload={(cause = "own") => {
        if (cause === "stale") setDrafts({ draft: null, conflict: false });
        page.reload(true);
      }}
    />
  );
}

function ServiceView(props: {
  data: CataloguePage;
  drafts: Drafts;
  setDrafts: (d: Drafts) => void;
  reload: (cause?: "own" | "stale") => void;
}) {
  const { item } = props.data;
  const canWrite = useCanWrite();
  const toast = useToast();
  const { draft, conflict } = props.drafts;
  const editing = draft !== null;
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submits, setSubmits] = useState(0);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const dirty = draft !== null && changedKeys(draft).length > 0;

  const start = () => {
    const base = formOf(item);
    props.setDrafts({ draft: { base, value: base }, conflict: false });
    setErrors({});
    setFailure(null);
    requestAnimationFrame(() => document.getElementById("ce-name")?.focus());
  };
  const stop = () => {
    props.setDrafts({ draft: null, conflict: false });
    setErrors({});
    setFailure(null);
  };
  const set = (patch: Partial<EntryForm>) => {
    if (!draft) return;
    props.setDrafts({ draft: { base: draft.base, value: { ...draft.value, ...patch } }, conflict });
    setFailure(null);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    const built = buildEntry(draft.value);
    if ("errors" in built) {
      setErrors(built.errors);
      setSubmits((n) => n + 1);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await catalogueApi.update(item.id, entryPatch(draft, built.value, item.updatedAt));
      toast("success", r.changed ? TOASTS.saved : "No change: that's already saved.");
      props.setDrafts({ draft: null, conflict: false });
      props.reload();
      requestAnimationFrame(() => document.getElementById("svc-edit")?.focus());
    } catch (err) {
      const field = err instanceof RequestError ? fieldOfCode(err.code) : null;
      if (err instanceof RequestError && err.code === "stale_version") setStale(true);
      else if (err instanceof RequestError && field) {
        setErrors({ [field]: ERRORS[err.code as keyof typeof ERRORS] as string });
        setSubmits((n) => n + 1);
      } else setFailure(saveFailureText(err, errorText));
    } finally {
      setBusy(false);
    }
  }

  const summary = Object.entries(errors).map(([id, text]) => ({ id, text }));
  // The 07-L confirmation, word for word: its question is the dialog's title, the rest its body.
  const [question, ...rest] = (
    item.active ? COPY.retire(item.code, item.name) : COPY.reactivate(item.code, item.name)
  ).split("? ");
  const actions = canWrite && !editing && (
    <>
      <button type="button" className="btn btn--secondary" onClick={() => setConfirm(true)}>
        {item.active ? <Archive /> : <RotateCcw />}
        {item.active ? "Retire" : "Make active again"}
      </button>
      <button id="svc-edit" type="button" className="btn btn--primary" onClick={start}>
        <Pencil />
        Edit
      </button>
    </>
  );

  return (
    <>
      <UnsavedChangesGuard dirty={dirty && !stale} what="this service" />
      <PageHeader
        title={item.name}
        crumbs={CRUMBS}
        status={
          <span className="pill-row">
            <span className="client-code docno">{item.code}</span>
            <ItemPills item={item} />
          </span>
        }
        action={actions || undefined}
      />
      {(stale || conflict) &&
        (stale ? (
          <StaleNotice
            title={PENDING.staleService}
            onReload={() => {
              setStale(false);
              props.reload("stale");
            }}
          />
        ) : (
          <StaleNotice
            title={PENDING.staleServiceDraft}
            body="Your unsaved changes to those fields were set aside so theirs aren't overwritten; anything you had already saved is kept. Reload to see the latest, then make your change again."
            onReload={() => props.reload("stale")}
          />
        ))}
      {editing ? (
        <form id="svc-form" onSubmit={save} noValidate className="svc-form">
          <ErrorSummary errors={summary} focusKey={submits} />
          {failure && <Notice tone="error">{failure}</Notice>}
          <p className="hint">All fields are needed unless marked optional.</p>
          <fieldset className="svc-form__body" disabled={busy}>
            <div className="lead-page">
              <div className="lead-page__main">
                <EntryMain form={draft.value} set={set} error={(id) => errors[id]} mode="edit" />
              </div>
              <div className="lead-page__side">
                <EntrySide form={draft.value} set={set} error={(id) => errors[id]} mode="edit" />
                <div className="lead-panel svc-form__cancel">
                  <button type="button" className="btn btn--secondary btn--block" onClick={stop}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </fieldset>
          <SaveBar dirty={dirty} busy={busy} form="svc-form" saveLabel="Save service" onDiscard={stop} />
        </form>
      ) : (
        <ServiceRead data={props.data} />
      )}
      <ConfirmDialog
        open={confirm}
        title={`${question}?`}
        tone={item.active ? "danger" : "default"}
        confirmLabel={item.active ? "Retire" : "Make active again"}
        busyLabel="Saving…"
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          await catalogueApi.setActive(item.id, !item.active);
          toast("success", item.active ? TOASTS.retired : TOASTS.active);
          props.reload();
          return undefined;
        }}
      >
        <p>{rest.join("? ")}</p>
        {item.active && isSiteReferenced(item.code) && <Notice tone="info">{COPY.siteUsesService}</Notice>}
      </ConfirmDialog>
    </>
  );
}

const none = (text = "None") => <span className="muted">{text}</span>;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The page as everyone reads it. */
function ServiceRead({ data }: { data: CataloguePage }) {
  const { item } = data;
  return (
    <div className="lead-page">
      <div className="lead-page__main">
        <section className="lead-panel" aria-labelledby="svc-desc-h">
          <h2 id="svc-desc-h" className="lead-panel__title">
            Description
          </h2>
          <p className="svc-short">{item.short}</p>
          {item.longMd && <Markdown source={item.longMd} className="svc-long" />}
          <dl className="facts facts--two svc-facts">
            <Fact label="Category">{CATEGORY_LABELS[item.category]}</Fact>
            <Fact label="Unit">{UNIT_LABELS[item.unit]}</Fact>
          </dl>
        </section>

        <section className="lead-panel" aria-labelledby="svc-prices-h">
          <h2 id="svc-prices-h" className="lead-panel__title">
            Prices and tax
          </h2>
          <dl className="facts facts--two">
            <Fact label="From prices">
              {item.priceInrMinor === null && item.priceUsdMinor === null ? (
                none()
              ) : (
                <Prices inr={item.priceInrMinor} usd={item.priceUsdMinor} />
              )}
            </Fact>
            <Fact label="SAC">
              <span className="docno">{item.sac}</span>
            </Fact>
            <Fact label="GST rate">
              {item.gstRateBp === null ? none("As in settings") : `${bpToPercent(item.gstRateBp)} %`}
            </Fact>
          </dl>
          <p className="hint svc-verify">{COPY.sacHint}</p>
        </section>

        <section className="lead-panel" aria-labelledby="svc-lines-h">
          <h2 id="svc-lines-h" className="lead-panel__title">
            Default lines
          </h2>
          {item.defaultLines?.length ? <LinesTable item={item} /> : <p>{none()}</p>}
        </section>

        <section className="lead-panel" aria-labelledby="svc-sched-h">
          <h2 id="svc-sched-h" className="lead-panel__title">
            Payment schedule
          </h2>
          <ScheduleView steps={item.schedule} />
        </section>

        <section className="lead-panel" aria-labelledby="svc-incl-h">
          <h2 id="svc-incl-h" className="lead-panel__title">
            Deliverables, assumptions and exclusions
          </h2>
          <MdBlock title="Deliverables" source={item.deliverablesMd} />
          <MdBlock title="Assumptions" source={item.assumptionsMd} />
          <MdBlock title="Exclusions" source={item.exclusionsMd} />
        </section>
      </div>
      <aside className="lead-page__side" aria-label="Website and price history">
        <section className="lead-panel svc-site" aria-labelledby="svc-site-h">
          <h2 id="svc-site-h" className="lead-panel__title">
            Website
          </h2>
          <dl className="facts">
            <Fact label="Address">
              {item.slug ? <span className="docno break">/services/{item.slug}</span> : none()}
            </Fact>
            <Fact label="Show on website">{item.showOnSite ? "On" : "Off"}</Fact>
          </dl>
        </section>
        <History id={item.id} first={data.history} />
      </aside>
    </div>
  );
}

function MdBlock({ title, source }: { title: string; source: string | null }) {
  return (
    <div className="md-block">
      <h3 className="md-block__title">{title}</h3>
      {source ? <Markdown source={source} /> : none()}
    </div>
  );
}

function LinesTable({ item }: { item: CatalogueEntry }) {
  return (
    <div className="lines-table">
      <table>
        <caption className="visually-hidden">Default lines</caption>
        <thead>
          <tr>
            <th scope="col">Description</th>
            <th scope="col">Unit</th>
            <th scope="col" className="num">
              Quantity
            </th>
            <th scope="col" className="num">
              Rate
            </th>
          </tr>
        </thead>
        <tbody>
          {item.defaultLines?.map((l) => (
            <tr key={l.description}>
              <th scope="row">{l.description}</th>
              <td>{UNIT_LABELS[l.unit]}</td>
              <td className="num">{milliToQty(l.qtyMilli)}</td>
              <td className="num">
                <Prices inr={l.rateInrMinor} usd={l.rateUsdMinor} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The price history (ADM-CAT-04), newest first, 25 at a time ("Show older" continues the cursor). */
function History({ id, first }: { id: string; first: CataloguePage["history"] }) {
  const [more, setMore] = useState<PriceChangeRow[]>([]);
  const [next, setNext] = useState<string | null>(first.next);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = [...first.items, ...more];
  async function older() {
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      const r = await catalogueApi.item(id, next);
      const known = new Set(items.map((h) => h.id));
      const fresh = r.history.items.filter((h) => !known.has(h.id));
      setMore((m) => [...m, ...fresh]);
      setNext(r.history.next);
      const firstNew = fresh[0];
      if (firstNew) requestAnimationFrame(() => document.getElementById(`ph-${firstNew.id}`)?.focus());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="lead-panel" aria-labelledby="svc-history-h">
      <h2 id="svc-history-h" className="lead-panel__title">
        {COPY.historyHeading}
      </h2>
      {items.length === 0 ? (
        <p className="muted">{COPY.historyEmpty}</p>
      ) : (
        <ol className="price-history">
          {items.map((h) => (
            <li key={h.id} id={`ph-${h.id}`} tabIndex={-1} className="price-history__row">
              <p className="price-history__text">{historyText(h)}</p>
              <When ms={h.changedAt} inline />
            </li>
          ))}
        </ol>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {next && (
        <button
          type="button"
          className="btn btn--text"
          onClick={older}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? "Loading…" : "Show older"}
        </button>
      )}
    </section>
  );
}

function ServiceSkeleton(): ReactNode {
  return (
    <>
      <PageHeader title="Service" crumbs={CRUMBS} />
      <p className="visually-hidden" role="status">
        Loading the service
      </p>
      <div className="lead-page" aria-hidden="true">
        <div className="lead-page__main">
          {[0, 1, 2].map((i) => (
            <div key={i} className="lead-panel stack-sm">
              <Skeleton width="30%" />
              <Skeleton width="85%" />
              <Skeleton width="60%" />
            </div>
          ))}
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
