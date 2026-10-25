// The CSV export of time (M3.5, ADM-TIME-02): a date range (the week on screen by default, at most 366 days, the API's limit) and the
// filters on screen; the browser reads GET /time 50 entries at a time and builds the file (lib/time.ts `timeCsv`: 07-M columns, and
// every cell that starts with = + - or @ is defused so a spreadsheet never runs it as a formula). Nothing is built on the server.
import { useRef, useState } from "react";
import { api, type TimeEntry } from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { Download } from "../../components/icons.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { careErrorText } from "../../lib/care.ts";
import { exportRangeOk, TIME_PENDING, timeCsv } from "../../lib/time.ts";

export function ExportButton(props: {
  from: string;
  to: string;
  filters: { userId?: string | undefined; projectId?: string; carePlanId?: string };
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(props.from);
  const [to, setTo] = useState(props.to);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);

  function start() {
    setFrom(props.from);
    setTo(props.to);
    setRangeError(null);
    setFailure(null);
    setLoaded(null);
    setOpen(true);
  }

  async function download() {
    if (!exportRangeOk(from, to)) {
      setRangeError(TIME_PENDING.exportRange);
      document.getElementById("csv-from")?.focus();
      return;
    }
    setRangeError(null);
    setFailure(null);
    setBusy(true);
    cancelled.current = false;
    const all: TimeEntry[] = [];
    try {
      let after: string | undefined;
      do {
        const page = await api.timeEntries({ from, to, limit: "50", after, ...props.filters });
        if (cancelled.current) return;
        all.push(...page.entries);
        setLoaded(all.length);
        after = page.next ?? undefined;
      } while (after);
      const blob = new Blob([timeCsv(all)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `techaust-time-${from}-to-${to}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (e) {
      setFailure(careErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn--secondary" onClick={start}>
        <Download size={20} />
        Export CSV
      </button>
      <Modal open={open} title="Export time as CSV" onClose={() => setOpen(false)} busy={busy}>
        <div className="dialog__body">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="csv-from">From</label>
              <input
                id="csv-from"
                type="date"
                value={from}
                aria-invalid={rangeError ? true : undefined}
                aria-describedby={rangeError ? "csv-range-error" : undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="csv-to">To</label>
              <input id="csv-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          {rangeError && <FieldError id="csv-range-error">{rangeError}</FieldError>}
          <p className="hint" role="status">
            {loaded === null ? "" : `${loaded} ${loaded === 1 ? "entry" : "entries"} read`}
          </p>
          {failure && <Notice tone="error">{failure}</Notice>}
        </div>
        <div className="dialog__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              cancelled.current = true;
              setBusy(false);
              setOpen(false);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={download}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            <Download size={20} />
            {busy ? "Reading…" : "Download CSV"}
          </button>
        </div>
      </Modal>
    </>
  );
}
