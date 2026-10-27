// Pieces the four reports share (M5.5b): the list of problems that stop a file (each with its document, 07-V §2.1), the warnings to check before
// filing (§2.2), a figure in tabular numerals, and the progress line of a read.
import { type FormEvent, type ReactNode, useState } from "react";
import { Link } from "react-router";
import type { Currency } from "../../api.ts";
import { DateField, useUnreadDates } from "../../components/date-field.tsx";
import { FormField } from "../../components/form.tsx";
import { AlertTriangle, Info } from "../../components/icons.tsx";
import { FieldError } from "../../components/ui.tsx";
import { dateError } from "../../lib/date-field.ts";
import { moneyText } from "../../lib/documents.ts";
import { type DocRef, documentHref, GST_COPY, type IssueLine } from "../../lib/reports.ts";

/** An amount through core's formatter, in tabular numerals, never broken across lines. */
export function Amount({ minor, currency = "INR" }: { minor: number; currency?: Currency }) {
  return <span className="amount tnum">{moneyText(minor, currency)}</span>;
}

/** A document's number linking to its page. */
export function DocLink({ doc }: { doc: DocRef }) {
  return (
    <Link to={documentHref(doc.id)} className="docno">
      {doc.number}
    </Link>
  );
}

/**
 * What stops the files (07-V §2: "{count} problems to fix…"; each line "{document number}: {message}" with "Open document"). Announced once
 * (`role="alert"`) and focusable, so the person lands on it after "Make files".
 */
export function ProblemList(props: { problems: readonly IssueLine[]; heading: string; id: string }) {
  return (
    <section className="report-problems" role="alert" aria-labelledby={props.id}>
      <h2 id={props.id} className="report-problems__h" tabIndex={-1}>
        <AlertTriangle size={20} />
        <span>{props.heading}</span>
      </h2>
      <ol className="report-problems__list">
        {props.problems.map((p) => (
          <li key={p.key} className="report-problems__item">
            <p className="report-problems__text">
              {p.doc ? (
                <>
                  <span className="docno">{p.doc.number}</span>: {p.message}
                </>
              ) : (
                p.message
              )}
            </p>
            {p.doc && (
              <Link to={documentHref(p.doc.id)} className="btn btn--text report-problems__open">
                {GST_COPY.openDocument}
                <span className="visually-hidden"> {p.doc.number}</span>
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** "Check before filing" (07-V §2.2): what the files carry but a person should look at; never blocks the download. */
export function WarningList(props: {
  warnings: readonly { key: string; text: string; doc: DocRef | null }[];
}) {
  if (props.warnings.length === 0) return null;
  return (
    <section className="report-warnings" aria-labelledby="report-warnings-h">
      <h2 id="report-warnings-h" className="report-sub">
        {GST_COPY.warningsHeading}
      </h2>
      <ul className="report-warnings__list">
        {props.warnings.map((w) => (
          <li key={w.key}>
            <Info size={16} />
            <span>
              {w.doc && (
                <>
                  <DocLink doc={w.doc} />:{" "}
                </>
              )}
              {w.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The live line of a read ("Reading issued documents: 50 so far", "Checking 120 documents"): polite, and the bar is indeterminate. */
export function Progress({ text }: { text: string }) {
  return (
    <p className="report-progress" role="status">
      {text}
    </p>
  );
}

/** A labelled block of a report's results. */
export function ReportBlock(props: { id: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="report-block" aria-labelledby={props.id}>
      <div className="report-block__head">
        <h2 id={props.id} className="report-sub">
          {props.title}
        </h2>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

/**
 * From and To (07-V §3, §6), two shared date fields side by side and the button that reads the range. The range rule is the caller's (`check`:
 * a sentence when the range can't be read, null when it can); an unreadable date blocks the read with the owner's date line.
 */
export function RangeForm(props: {
  idPrefix: string;
  from: string;
  to: string;
  labels: { from: string; to: string; submit: string };
  busy: boolean;
  check: (from: string, to: string) => string | null;
  onSubmit: (from: string, to: string) => void;
  max?: string | undefined;
  children?: ReactNode;
}) {
  const [from, setFrom] = useState(props.from);
  const [to, setTo] = useState(props.to);
  const dates = useUnreadDates<"from" | "to">();
  const [errors, setErrors] = useState<{ from: string | null; to: string | null; range: string | null }>({
    from: null,
    to: null,
    range: null,
  });
  const fromId = `${props.idPrefix}-from`;
  const toId = `${props.idPrefix}-to`;
  const rangeId = `${props.idPrefix}-range-error`;

  function submit(e: FormEvent) {
    e.preventDefault();
    const bad = { from: dateError(dates.unread.from), to: dateError(dates.unread.to) };
    const range = bad.from || bad.to ? null : props.check(from, to);
    setErrors({ ...bad, range });
    if (bad.from || bad.to || range) {
      document.getElementById(bad.to && !bad.from ? toId : fromId)?.focus();
      return;
    }
    props.onSubmit(from, to);
  }

  const described = (own: string | undefined) =>
    [own, errors.range ? rangeId : null].filter(Boolean).join(" ") || undefined;

  return (
    <form className="range-form" onSubmit={submit} noValidate>
      <div className="range-form__fields">
        <FormField id={fromId} label={props.labels.from} error={errors.from}>
          {(a) => (
            <DateField
              {...a}
              {...dates.bind("from")}
              value={from}
              max={props.max}
              aria-invalid={a["aria-invalid"] ?? (errors.range ? true : undefined)}
              aria-describedby={described(a["aria-describedby"])}
              onChange={setFrom}
            />
          )}
        </FormField>
        <FormField id={toId} label={props.labels.to} error={errors.to}>
          {(a) => (
            <DateField
              {...a}
              {...dates.bind("to")}
              value={to}
              max={props.max}
              aria-invalid={a["aria-invalid"] ?? (errors.range ? true : undefined)}
              aria-describedby={described(a["aria-describedby"])}
              onChange={setTo}
            />
          )}
        </FormField>
        {props.children}
        <div className="range-form__go">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={props.busy}
            aria-busy={props.busy || undefined}
          >
            {props.labels.submit}
          </button>
        </div>
      </div>
      {errors.range && <FieldError id={rangeId}>{errors.range}</FieldError>}
    </form>
  );
}
