// The Publish to website tab (M4.1, ADM-CAT-05, WEB-G-07): what publishing does (07-L), the owner's "Publish prices", and the
// answer in place: published, unchanged, published again (the same prices as an earlier list), or `snapshot_invalid` with the
// services to fix. The API answers that with snapshot paths only ("items.3.unit", never values); the snapshot holds the active
// services marked for the website in code order, which is the order of GET /catalogue?active=1&onSite=1, so the screen reads
// that list to name each service. What the website itself needs (a service it shows, its price or default line) comes as `needs`
// by code, one line each, with a link to the services list at that code. Below: the last 20 published price lists (every role
// reads them). "Publish prices" is shown by the `catalogue.publish` action, not `catalogue.write`.
import { formatIstDateTime } from "@techaust/core";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { type CatalogueListItem, catalogueApi, errorText, RequestError } from "../../api.ts";
import { Skeleton } from "../../components/display.tsx";
import { Upload } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { Notice } from "../../components/ui.tsx";
import {
  COPY,
  ERRORS,
  maxItemIndex,
  PENDING,
  type PublishProblem,
  publishProblems,
} from "../../lib/catalogue.ts";
import { useCanPublish } from "./parts.tsx";

type Answer =
  | { kind: "published" | "unchanged" | "republished" }
  | { kind: "invalid"; problems: PublishProblem[] }
  | { kind: "failed"; text: string };

/** The active services on the website, in code order, far enough down the list to reach `upTo` (at most 50 a page). */
async function onSiteItems(upTo: number) {
  const out: CatalogueListItem[] = [];
  let after: string | undefined;
  do {
    const page = await catalogueApi.list({ active: "1", onSite: "1", limit: "50", after });
    out.push(...page.items);
    after = page.next ?? undefined;
  } while (after && out.length <= upTo);
  return out;
}

export function PublishTab() {
  const canPublish = useCanPublish();
  const history = useLoad(() => catalogueApi.snapshots(), "snapshots");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  async function publish() {
    setBusy(true);
    setAnswer(null);
    let next: Answer;
    try {
      const r = await catalogueApi.publish();
      if (r.unchanged) next = { kind: "unchanged" };
      else {
        const list = await catalogueApi.snapshots().catch(() => null);
        const earlier = list?.snapshots.some((s) => s.sha256 === r.sha256 && s.id !== r.id);
        next = { kind: earlier ? "republished" : "published" };
      }
      history.reload(true);
    } catch (e) {
      if (e instanceof RequestError && e.code === "snapshot_invalid") {
        // Only index paths ("items.3.unit") need the list of services to name them; a need by code ("items.S7") names itself.
        const upTo = maxItemIndex(e.paths);
        const items = upTo < 0 ? [] : await onSiteItems(upTo).catch(() => []);
        next = { kind: "invalid", problems: publishProblems(e.paths, items, e.needs) };
      } else next = { kind: "failed", text: errorText(e) };
    } finally {
      setBusy(false);
    }
    setAnswer(next);
    requestAnimationFrame(() => answerRef.current?.focus());
  }

  return (
    <div className="publish">
      <section className="lead-panel publish__panel" aria-labelledby="pub-h">
        <h2 id="pub-h" className="lead-panel__title">
          Publish to website
        </h2>
        <p className="publish__intro">{COPY.publishIntro}</p>
        {canPublish && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={publish}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            <Upload />
            {busy ? "Publishing…" : COPY.publishButton}
          </button>
        )}
        <div className="publish__answer" ref={answerRef} tabIndex={-1}>
          {answer && <AnswerNotice answer={answer} />}
        </div>
      </section>

      <section className="lead-panel" aria-labelledby="pub-history-h">
        <h2 id="pub-history-h" className="lead-panel__title">
          {COPY.publishedHeading}
        </h2>
        {history.state === "failed" ? (
          <LoadFailed error={history.error} onRetry={() => history.reload()} headingLevel={3} />
        ) : history.state === "loading" ? (
          <div className="stack-sm" aria-hidden="true">
            <Skeleton width="60%" />
            <Skeleton width="50%" />
          </div>
        ) : history.data.snapshots.length === 0 ? (
          <p className="muted">{COPY.publishedEmpty}</p>
        ) : (
          <ol className="pub-list">
            {history.data.snapshots.map((s) => (
              <li key={s.id} className="pub-list__row">
                {COPY.publishedRow(
                  s.publishedByName ?? "A former staff member",
                  formatIstDateTime(s.publishedAt),
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function AnswerNotice({ answer }: { answer: Answer }) {
  if (answer.kind === "published") return <Notice tone="success">{COPY.published}</Notice>;
  if (answer.kind === "republished") return <Notice tone="success">{COPY.republished}</Notice>;
  if (answer.kind === "unchanged") return <Notice tone="info">{COPY.unchanged}</Notice>;
  if (answer.kind === "failed") return <Notice tone="error">{answer.text}</Notice>;
  if (answer.kind !== "invalid") return null;
  return (
    <Notice tone="error">
      <p>{ERRORS.snapshot_invalid}</p>
      <ul className="pub-fix">
        {answer.problems.map((p, i) =>
          p.kind === "site" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: the problems in their order
            <li key={i}>
              <Link to={`/catalogue?q=${encodeURIComponent(p.code)}`}>
                <span className="docno">{p.code}</span>
              </Link>{" "}
              {ERRORS.siteNeeds(p.code, p.what)}
            </li>
          ) : p.kind === "service" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: the problems in their order
            <li key={i}>
              {p.item ? (
                <Link to={`/catalogue/${p.item.id}`}>
                  <span className="docno">{p.item.code}</span> {p.item.name}
                </Link>
              ) : (
                <span>{PENDING.noneOnSite}</span>
              )}
              {p.fields.length > 0 && <span className="pub-fix__fields">{p.fields.join(", ")}</span>}
            </li>
          ) : p.kind === "terms" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: the problems in their order
            <li key={i}>
              <Link to="/settings/payment-terms">Settings › Payment terms</Link>
              <span className="pub-fix__fields">{PENDING.otherFix}</span>
            </li>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: the problems in their order
            <li key={i}>{PENDING.noneOnSite}</li>
          ),
        )}
      </ul>
    </Notice>
  );
}
