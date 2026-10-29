// The money figures of a client's Overview and a project's Figures panel (FX-3, A3 4 and A3 5; ADM-CLI-03, ADM-PRJ-05), from
// GET /clients/:id/finance and the project page's `figures.billed` (worker/figures.ts: the client statement's rules, tax included).
// The figure that matters, what the client owes now, is set large in the display face with a hairline under it, as a ledger's total;
// overdue, billed to date and the credit notes follow as quiet rows, right-aligned in tabular figures. Overdue money carries the
// warning icon and its count in words, never colour alone. "Collected" arrives with payments (M6) and says so (07-V's line).
// Amounts are formatted by core (`moneyText`); nothing is added up here.
import type { ClientFigures, ProjectBilled } from "../../api.ts";
import { api } from "../../api.ts";
import { AlertTriangle, Receipt, RefreshCw } from "../../components/icons.tsx";
import { useLoad } from "../../components/states.tsx";
import { Y } from "../../lib/copy-y.ts";
import { moneyText } from "../../lib/projects.ts";
import { FINANCE_COPY } from "../../lib/reports.ts";

/** 07-Y (FX-3): the figure labels 07-V's dashboard tiles didn't have. */
export const FIGURES_COPY = {
  title: "Figures",
  billed: Y("Billed to date"),
  billedHint: Y("Invoices and debit notes, GST included."),
  credited: Y("Credit notes"),
  openStatement: Y("Open the statement"),
} as const;

function Amount({
  minor,
  currency,
  big,
}: {
  minor: number;
  currency: ClientFigures["currency"];
  big?: boolean;
}) {
  return (
    <span className={big ? "acct__amount acct__amount--big" : "acct__amount"}>
      {moneyText(minor, currency)}
    </span>
  );
}

function CurrencyFigures({ f, many }: { f: ClientFigures; many: boolean }) {
  const groupId = `acct-${f.currency}`;
  const rows = (
    <dl className="acct__rows">
      <div className="acct__row acct__lead">
        <dt>{FINANCE_COPY.outstanding}</dt>
        <dd>
          {f.balanceMinor > 0 ? (
            <Amount minor={f.balanceMinor} currency={f.currency} big />
          ) : (
            <span className="acct__none">{FINANCE_COPY.noneOutstanding}</span>
          )}
        </dd>
      </div>
      <div className="acct__row">
        <dt>{FINANCE_COPY.overdue}</dt>
        <dd>
          {f.overdueCount > 0 ? (
            <>
              <span className="acct__overdue">
                <AlertTriangle size={16} />
                <Amount minor={f.overdueMinor} currency={f.currency} />
              </span>
              <span className="acct__sub">{FINANCE_COPY.documents(f.overdueCount)}</span>
            </>
          ) : (
            <span className="acct__none">{FINANCE_COPY.noneOverdue}</span>
          )}
        </dd>
      </div>
      <div className="acct__row">
        {/* The note names what the figure counts, so it sits under the label; the amount keeps its own column. */}
        <dt>
          {FIGURES_COPY.billed}
          <span className="acct__sub">{FIGURES_COPY.billedHint}</span>
        </dt>
        <dd>
          <Amount minor={f.billedMinor} currency={f.currency} />
        </dd>
      </div>
      {f.creditedMinor > 0 && (
        <div className="acct__row">
          <dt>{FIGURES_COPY.credited}</dt>
          <dd>
            <Amount minor={f.creditedMinor} currency={f.currency} />
          </dd>
        </div>
      )}
    </dl>
  );
  // With two currencies each is its own labelled group under its code; with one the code adds nothing (the amounts carry the symbol).
  return many ? (
    <section className="acct__group" aria-labelledby={groupId}>
      <h3 className="acct__currency docno" id={groupId}>
        {f.currency}
      </h3>
      {rows}
    </section>
  ) : (
    <div className="acct__group">{rows}</div>
  );
}

/** The client Overview's figures panel (finance roles; not shown for an anonymised client). */
export function ClientFiguresPanel(props: { clientId: string; onStatement: () => void }) {
  const finance = useLoad(() => api.clientFinance(props.clientId), props.clientId);
  if (finance.state === "ready" && !finance.data.available) return null;
  const rows = finance.state === "ready" && finance.data.available ? finance.data.currencies : [];
  return (
    <section
      className="lead-panel acct"
      aria-labelledby="acct-h"
      aria-busy={finance.state === "loading" || undefined}
    >
      <h2 id="acct-h" className="lead-panel__title">
        {FIGURES_COPY.title}
      </h2>
      {finance.state === "loading" ? (
        <div className="acct__loading" aria-hidden="true">
          <span className="skeleton" style={{ width: "45%" }} />
          <span className="skeleton skeleton--figure" style={{ width: "70%" }} />
          <span className="skeleton" style={{ width: "85%" }} />
          <span className="skeleton" style={{ width: "60%" }} />
        </div>
      ) : finance.state === "failed" ? (
        // One quiet line inside the panel (never a card in a card), in the words of the shared LoadFailed.
        <>
          <p className="panel-empty" role="alert">
            <RefreshCw size={20} />
            <span>This didn't load. Try again in a moment.</span>
          </p>
          <button type="button" className="btn btn--text panel-link" onClick={() => finance.reload()}>
            Try again
          </button>
        </>
      ) : rows.length === 0 ? (
        <p className="panel-empty">
          <Receipt size={20} />
          <span>{FINANCE_COPY.noneInvoiced}</span>
        </p>
      ) : (
        <>
          {rows.map((f) => (
            <CurrencyFigures key={f.currency} f={f} many={rows.length > 1} />
          ))}
          <p className="acct__foot">{FINANCE_COPY.collectedArrives}</p>
          <button type="button" className="btn btn--text panel-link" onClick={props.onStatement}>
            <Receipt size={16} />
            {FIGURES_COPY.openStatement}
          </button>
        </>
      )}
    </section>
  );
}

/** The project's billed rows, for its Figures list (absent for Sales; none for an anonymised client). */
export function ProjectBilledFacts({ billed }: { billed: ProjectBilled[] }) {
  const many = billed.length > 1;
  if (billed.length === 0)
    return (
      <div>
        <dt>{FIGURES_COPY.billed}</dt>
        <dd>
          <span className="panel-empty">
            <Receipt size={20} />
            <span>{FINANCE_COPY.noneInvoiced}</span>
          </span>
        </dd>
      </div>
    );
  return (
    <>
      <div>
        <dt>{FIGURES_COPY.billed}</dt>
        <dd className="acct__stack">
          {billed.map((b) => (
            <span key={b.currency} className="acct__line">
              <Amount minor={b.billedMinor} currency={b.currency} />
              {many && <span className="acct__code docno">{b.currency}</span>}
            </span>
          ))}
          <span className="acct__sub">{FIGURES_COPY.billedHint}</span>
        </dd>
      </div>
      {billed.some((b) => b.creditedMinor > 0) && (
        <div>
          <dt>{FIGURES_COPY.credited}</dt>
          <dd className="acct__stack">
            {billed
              .filter((b) => b.creditedMinor > 0)
              .map((b) => (
                <span key={b.currency} className="acct__line">
                  <Amount minor={b.creditedMinor} currency={b.currency} />
                  {many && <span className="acct__code docno">{b.currency}</span>}
                </span>
              ))}
          </dd>
        </div>
      )}
    </>
  );
}
