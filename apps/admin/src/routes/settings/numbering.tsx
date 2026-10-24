// Numbering (ADM-SET-04): one row per document series with the next number as it will print. Each series is edited in
// its own dialog: the format ({FY} and {N}, at most 16 characters of A-Z, 0-9, "/" and "-") and the padding, and the next
// number, which can only go up. A series that has issued a number this financial year keeps its format until 1 April
// (the API answers 409 `series_in_use`; the dialog says why before anyone tries). The accountant reads the table only.
import {
  financialYear,
  formatDocumentNumber,
  maxNumber,
  type NumberingFormat,
  SERIES,
  type Series,
  validateFormat,
} from "@techaust/core";
import { type FormEvent, useState } from "react";
import { api, errorText, RequestError, type SeriesState, type SettingsDoc } from "../../api.ts";
import { DataTable } from "../../components/data-table.tsx";
import { Modal } from "../../components/dialog.tsx";
import { StatusPill } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { Lock } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { intIn } from "../../lib/settings-form.ts";
import { FormSkeleton, StaleNotice } from "./kit.tsx";

const ALL = Object.keys(SERIES) as Series[];

/** "2627" → FY 2026-27. */
const fyFromToken = (token: string) => financialYear(2000 + Number(token.slice(0, 2)));

/** The number as it prints, or null when the format can't make one (shown as a dash). */
function sample(format: NumberingFormat, fyToken: string, n: number): string | null {
  try {
    return formatDocumentNumber(format, fyFromToken(fyToken), n);
  } catch {
    return null;
  }
}

export function NumberingSettings({ readOnly }: { readOnly: boolean }) {
  const loaded = useLoad(() => api.settingsGroup("numbering"), "");
  const [editing, setEditing] = useState<Series | null>(null);
  const toast = useToast();
  if (loaded.state === "loading") return <FormSkeleton />;
  if (loaded.state === "failed") return <LoadFailed error={loaded.error} onRetry={() => loaded.reload()} />;
  const doc = loaded.data;
  const fy = doc.meta.fy ?? "";
  const state = (s: Series): SeriesState =>
    doc.meta.series?.find((x) => x.series === s) ?? { series: s, nextNo: 1, used: false };

  return (
    <>
      <p className="hint">
        A number has at most 16 characters: capital letters, digits, “/” and “-”. Numbers restart each 1
        April, never go down, and a format is fixed once its first number of the year is used. Financial year{" "}
        {fy ? fyFromToken(fy).label : ""}.
      </p>
      {readOnly && <Notice tone="info">You can read these settings. Only the owner can change them.</Notice>}
      <DataTable
        caption="Number formats by document type"
        rows={ALL}
        rowKey={(s) => s}
        columns={[
          { key: "doc", header: "Document", card: "title", cell: (s) => SERIES[s].label },
          {
            key: "next",
            header: "Next number",
            cell: (s) => <span className="docno">{sample(doc.value[s], fy, state(s).nextNo) ?? "—"}</span>,
          },
          {
            key: "status",
            header: "Status",
            cell: (s) =>
              state(s).used ? (
                <StatusPill tone="info" icon="send">
                  In use, format fixed
                </StatusPill>
              ) : (
                <StatusPill tone="neutral" icon="pencil">
                  Not used this year
                </StatusPill>
              ),
          },
        ]}
        actions={
          readOnly
            ? undefined
            : (s) => (
                <button
                  type="button"
                  className="btn btn--text"
                  onClick={() => setEditing(s)}
                  aria-label={`Edit ${SERIES[s].label} numbering`}
                >
                  Edit
                </button>
              )
        }
      />
      {editing && (
        <SeriesDialog
          key={editing}
          series={editing}
          doc={doc}
          state={state(editing)}
          onClose={() => setEditing(null)}
          onSaved={(changed) => {
            setEditing(null);
            toast(
              "success",
              changed
                ? `${SERIES[editing].label} numbering saved. New documents use it from now on.`
                : "No change.",
            );
            loaded.reload(true);
          }}
          onReload={() => {
            setEditing(null);
            loaded.reload();
          }}
        />
      )}
    </>
  );
}

function SeriesDialog(props: {
  series: Series;
  doc: SettingsDoc<"numbering">;
  state: SeriesState;
  onClose: () => void;
  onSaved: (changed: boolean) => void;
  onReload: () => void;
}) {
  const { series, doc, state } = props;
  const current = doc.value[series];
  const [template, setTemplate] = useState(current.template);
  const [padding, setPadding] = useState(String(current.padding));
  const [next, setNext] = useState(String(state.nextNo));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const fy = doc.meta.fy ?? "";
  const format: NumberingFormat = { template: template.trim(), padding: Number(padding) };
  const check = validateFormat(format);
  const n = intIn(next, 1);
  const preview = check.ok && n !== null ? sample(format, fy, Math.min(n, maxNumber(format))) : null;

  async function save(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!check.ok) found["num-template"] = `${check.error}.`;
    if (n === null) found["num-next"] = "Enter a whole number, 1 or more.";
    else if (n < state.nextNo) found["num-next"] = `The next number can only go up: ${state.nextNo} or more.`;
    else if (check.ok && n > maxNumber(format))
      found["num-next"] =
        `That number doesn't fit ${format.padding} digits. Raise the padding or pick a smaller number.`;
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length || n === null) {
      document.getElementById(Object.keys(found)[0] ?? "")?.focus();
      return;
    }
    setBusy(true);
    try {
      const value = { ...doc.value, [series]: format };
      const r = await api.saveSettingsGroup(
        "numbering",
        doc.version,
        value,
        n !== state.nextNo ? { nextNumbers: { [series]: n } } : {},
      );
      props.onSaved(r.changed);
    } catch (err) {
      if (err instanceof RequestError && err.code === "stale_version") setStale(true);
      else if (err instanceof RequestError && err.fields.length)
        setFailure(err.fields.map((f) => f.message).join(". "));
      else setFailure(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`${SERIES[series].label} numbering`} onClose={props.onClose} busy={busy}>
      <form onSubmit={save} noValidate>
        <div className="dialog__body">
          {stale && <StaleNotice onReload={props.onReload} />}
          {failure && <Notice tone="error">{failure}</Notice>}
          {state.used ? (
            <p className="locked-note">
              <Lock size={16} />
              <span>
                This series has issued numbers this financial year, so its format stays as it is until 1
                April. You can still raise the next number.
              </span>
            </p>
          ) : null}
          <FormField
            id="num-template"
            label="Format"
            hint="{FY} is the financial year (2627) and {N} the number. Changes apply to new documents only."
            error={errors["num-template"]}
          >
            {(a) => (
              <input
                {...a}
                className="mono"
                value={template}
                readOnly={state.used}
                spellCheck={false}
                autoCapitalize="characters"
                autoComplete="off"
                onChange={(e) => setTemplate(e.target.value.toUpperCase())}
              />
            )}
          </FormField>
          <FormField id="num-padding" label="Digits in the number" hint="4 digits print 1 as 0001.">
            {(a) =>
              state.used ? (
                <input {...a} readOnly value={padding} />
              ) : (
                <select {...a} value={padding} onChange={(e) => setPadding(e.target.value)}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((d) => (
                    <option key={d} value={String(d)}>
                      {d}
                    </option>
                  ))}
                </select>
              )
            }
          </FormField>
          <FormField
            id="num-next"
            label="Next number"
            hint={`The next document gets this number. It can only go up (now ${state.nextNo}).`}
            error={errors["num-next"]}
          >
            {(a) => (
              <input
                {...a}
                inputMode="numeric"
                autoComplete="off"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            )}
          </FormField>
          <p className="num-preview" aria-live="polite">
            <span className="muted">Prints as </span>
            <span className="docno">{preview ?? "—"}</span>
          </p>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Saving…" : "Save numbering"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
