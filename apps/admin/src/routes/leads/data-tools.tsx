// A lead's data tools (M7.4 G.4; ADM-CLI-05, FRM-05; C.8): "Data tools" in the lead's header opens Export their data (Owner, step-up: the summary, then
// every part page by page, assembled into one JSON file in the browser, as the contact export does), Withdraw marketing consent (Owner and Staff:
// `leads.write`; only while consent is held and not withdrawn), Log a request (Owner and Staff, the lead chosen already) and Erase this lead (Owner,
// step-up: every unconverted lead with the same address goes in one batch, with a reason; a converted lead points to its contact's erase). Every refusal
// is worded from its code. Researched 2026-10-29, DPDP s.8(7), s.12(3) (08-C RB-37) for the erasure; the consent receipt: Researched 2026-10-28, DPDP
// Act s.6, s.6(10) (08-C RB-28).
import "../../dp.css";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { errorText, type LeadDetail, RequestError, stepUpActive } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { VerifyNote } from "../../components/form.tsx";
import { Download, MoreHorizontal } from "../../components/icons.tsx";
import { MenuButton } from "../../components/popover.tsx";
import { useToast } from "../../components/toast.tsx";
import { CodeField, FieldError, Notice, useFieldError } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import { ERASE_REASON_LABELS, ERASE_REASONS } from "../../lib/clients.ts";
import { REQUESTS_CHANGED, ZR_LEAD } from "../../lib/copy-zr.ts";
import { sentence } from "../../lib/format.ts";
import { type LeadExportPart, m74Api } from "../../lib/m74-api.ts";
import { isWrongCode, withCode } from "../../lib/step-up.ts";
import { useUser } from "../../session.tsx";
import { DATA_TOOLS_VERIFY } from "../clients/data-tools.tsx";
import { LogRequestDialog } from "../requests/log.tsx";

const CODE_MISSING = "Enter the 6-digit code from your authenticator app.";

/** Whether the lead's consent can be withdrawn (a consent record, not withdrawn already: core `withdrawalOf`; the server says `nothing_to_withdraw` otherwise). */
export const canWithdrawConsent = (l: Pick<LeadDetail, "consent">): boolean =>
  l.consent !== null &&
  typeof l.consent.at === "number" &&
  typeof l.consent.noticeVersion === "string" &&
  Array.isArray(l.consent.purposes) &&
  (l.consent.withdrawnAt ?? null) === null;

export function LeadDataTools(props: { lead: LeadDetail; converted: boolean; onChanged: () => void }) {
  const user = useUser();
  const l = props.lead;
  const canExport = allowed(user.role, "leads.dataExport");
  const canErase = allowed(user.role, "leads.dataErase");
  const canWithdraw = allowed(user.role, "leads.write") && canWithdrawConsent(l);
  // L22: a converted lead is never a request's subject (its contact is)
  const canLog = allowed(user.role, "requests.log") && !props.converted;
  const [open, setOpen] = useState<"export" | "erase" | "withdraw" | "log" | null>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const items = [
    ...(canExport ? [{ label: ZR_LEAD.export, onSelect: () => setOpen("export") }] : []),
    ...(canWithdraw ? [{ label: ZR_LEAD.withdraw, onSelect: () => setOpen("withdraw") }] : []),
    ...(canLog ? [{ label: ZR_LEAD.log, onSelect: () => setOpen("log") }] : []),
    ...(canErase && !props.converted
      ? [{ label: ZR_LEAD.erase, onSelect: () => setOpen("erase"), tone: "danger" as const }]
      : []),
  ];
  if (items.length === 0) return null;
  return (
    <>
      <MenuButton
        label={`${ZR_LEAD.menu}${ZR_LEAD.menuFor(l.name)}`}
        text={ZR_LEAD.menu}
        hiddenText={ZR_LEAD.menuFor(l.name)}
        icon={<MoreHorizontal size={16} />}
        items={items}
      />
      {open === "export" && <LeadExportDialog lead={l} onClose={() => setOpen(null)} />}
      {open === "erase" && (
        <LeadEraseDialog
          lead={l}
          onClose={() => setOpen(null)}
          onDone={(refs) => {
            setOpen(null);
            toast("success", ZR_LEAD.erased(refs));
            navigate("/leads");
          }}
        />
      )}
      {open === "withdraw" && (
        <ConfirmDialog
          open
          title={ZR_LEAD.withdrawTitle(l.name)}
          confirmLabel={ZR_LEAD.withdrawConfirm}
          onClose={() => setOpen(null)}
          onConfirm={async () => {
            try {
              await m74Api.leadWithdrawConsent(l.id);
            } catch (e) {
              if (e instanceof RequestError && e.code === "nothing_to_withdraw")
                throw new RequestError(409, e.code, ZR_LEAD.nothingToWithdraw);
              throw e;
            }
            toast("success", ZR_LEAD.withdrawn);
            props.onChanged();
            return undefined;
          }}
        >
          <p>{ZR_LEAD.withdrawBody}</p>
        </ConfirmDialog>
      )}
      {open === "log" && (
        <LogRequestDialog
          preset={{ type: "lead", id: l.id, title: `${l.ref} ${l.name}`, sub: l.email }}
          onClose={() => setOpen(null)}
          onLogged={(r) => {
            setOpen(null);
            window.dispatchEvent(new Event(REQUESTS_CHANGED));
            navigate(`/requests?id=${encodeURIComponent(r.id)}`);
          }}
        />
      )}
    </>
  );
}

type ExportState =
  | { step: "ready" }
  | { step: "running"; part: string; index: number; total: number; rows: number }
  | { step: "done"; url: string; name: string; rows: number }
  | { step: "cancelled" }
  | { step: "failed"; error: string };

function LeadExportDialog(props: { lead: LeadDetail; onClose: () => void }) {
  const l = props.lead;
  const id = useId();
  const [state, setState] = useState<ExportState>({ step: "ready" });
  const [code, setCode] = useState("");
  const [codeError, setCodeError, codeErrorKey] = useFieldError();
  const cancelled = useRef(false);
  const needsCode = !stepUpActive();
  const running = state.step === "running";
  const url = state.step === "done" ? state.url : null;
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  async function run() {
    if (needsCode && state.step === "ready" && code.length !== 6) {
      setCodeError(CODE_MISSING);
      document.getElementById(`${id}-code`)?.focus();
      return;
    }
    setCodeError(null);
    cancelled.current = false;
    try {
      const summary = await withCode(needsCode ? code : undefined, () => m74Api.leadExportSummary(l.id));
      const total = summary.manifest.length + 1;
      const parts: Partial<Record<LeadExportPart, Record<string, unknown>[]>> = {};
      let rows = 1;
      for (const [i, part] of summary.manifest.entries()) {
        let after: string | undefined;
        const items: Record<string, unknown>[] = [];
        do {
          if (cancelled.current) {
            setState({ step: "cancelled" });
            return;
          }
          setState({ step: "running", part, index: i + 2, total, rows });
          const page = await m74Api.leadExportPart(l.id, part, after);
          items.push(...page.items);
          rows += page.items.length;
          after = page.next ?? undefined;
        } while (after);
        parts[part] = items;
      }
      const now = Date.now();
      const file = JSON.stringify(
        {
          exportedAt: new Date(now).toISOString(),
          lead: summary.lead,
          keyedFormMonths: summary.keyedFormMonths,
          ...parts,
        },
        null,
        2,
      );
      const blobUrl = URL.createObjectURL(new Blob([file], { type: "application/json" }));
      const name = `techaust-data-export-${l.ref}-${toIsoDate(istDate(now))}.json`;
      setState({ step: "done", url: blobUrl, name, rows });
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = name;
      a.hidden = true;
      document.body.append(a);
      a.click();
      a.remove();
    } catch (e) {
      if (isWrongCode(e)) {
        setCode("");
        setCodeError(e.message);
        setState({ step: "ready" });
        document.getElementById(`${id}-code`)?.focus();
      } else setState({ step: "failed", error: errorText(e) });
    }
  }

  return (
    <Modal
      open
      title={ZR_LEAD.exportTitle(l.name)}
      onClose={() => {
        if (running) cancelled.current = true;
        props.onClose();
      }}
      busy={running}
    >
      <div className="dialog__body data-tool">
        <p>{ZR_LEAD.exportExplainer}</p>
        <VerifyNote>{DATA_TOOLS_VERIFY}</VerifyNote>
        {state.step === "ready" && needsCode && (
          <CodeField
            id={`${id}-code`}
            label="Authenticator code"
            hint="A fresh code from your authenticator app confirms it's you."
            value={code}
            onChange={setCode}
            error={codeError}
            errorKey={codeErrorKey}
          />
        )}
        {state.step === "running" && (
          <div className="export-progress">
            <progress
              className="export-progress__bar"
              max={state.total}
              value={state.index - 1}
              aria-labelledby={`${id}-progress`}
            />
            <p className="export-progress__text" id={`${id}-progress`} role="status">
              {`Part ${state.index} of ${state.total}: ${ZR_LEAD.exportParts[state.part] ?? state.part}. ${state.rows === 1 ? "1 record" : `${state.rows} records`} so far.`}
            </p>
          </div>
        )}
        {state.step === "cancelled" && <Notice tone="info">Export cancelled. Nothing was downloaded.</Notice>}
        {state.step === "failed" && (
          <Notice tone="error">{`The export stopped. ${sentence(state.error)}`}</Notice>
        )}
        {state.step === "done" && (
          <Notice tone="success">
            <p>{`Downloaded ${state.name}, with ${state.rows === 1 ? "1 record" : `${state.rows} records`}.`}</p>
            <a className="btn btn--text" href={state.url} download={state.name}>
              <Download size={16} />
              Download again
            </a>
          </Notice>
        )}
      </div>
      <div className="dialog__actions">
        {running ? (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              cancelled.current = true;
            }}
          >
            Cancel export
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--secondary" onClick={props.onClose}>
              {state.step === "done" ? "Close" : "Cancel"}
            </button>
            {state.step !== "done" && (
              <button type="button" className="btn btn--primary" onClick={() => void run()}>
                <Download />
                {state.step === "ready" ? "Export data" : "Try again"}
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function LeadEraseDialog(props: { lead: LeadDetail; onClose: () => void; onDone: (refs: string[]) => void }) {
  const l = props.lead;
  const id = useId();
  const [reason, setReason] = useState<string | null>(null);
  const [reasonMissing, setReasonMissing] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError, codeErrorKey] = useFieldError();
  const [failure, setFailure] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  const needsCode = !stepUpActive();

  async function confirm() {
    if (!reason) {
      setReasonMissing(true);
      document.getElementById(`${id}-reason-0`)?.focus();
      return;
    }
    if (needsCode && code.length !== 6) {
      setCodeError(CODE_MISSING);
      document.getElementById(`${id}-code`)?.focus();
      return;
    }
    setCodeError(null);
    setBusy(true);
    setFailure(null);
    try {
      const r = await withCode(needsCode ? code : undefined, () => m74Api.leadErase(l.id, reason));
      props.onDone(r.erased);
    } catch (e) {
      setBusy(false);
      if (isWrongCode(e)) {
        setCode("");
        setCodeError(e.message);
        document.getElementById(`${id}-code`)?.focus();
        return;
      }
      if (
        e instanceof RequestError &&
        (e.code === "legal_hold" || e.code === "lead_converted" || e.code === "too_many_leads")
      )
        setBlocked(true);
      setFailure(eraseRefusal(e));
      refusal.show();
    }
  }

  return (
    <Modal open title={ZR_LEAD.eraseTitle(l.name)} onClose={props.onClose} busy={busy} tone="danger">
      <div className="dialog__body data-tool">
        <p className="data-tool__confirm">{ZR_LEAD.eraseBody(l.name, l.email)}</p>
        <VerifyNote>{DATA_TOOLS_VERIFY}</VerifyNote>
        <fieldset
          className="radios"
          aria-describedby={reasonMissing ? `${id}-reason-error` : undefined}
          aria-invalid={reasonMissing || undefined}
        >
          <legend>Reason</legend>
          {ERASE_REASONS.map((r, i) => (
            <label key={r} className="radio">
              <input
                id={`${id}-reason-${i}`}
                type="radio"
                name={`${id}-reason`}
                checked={reason === r}
                onChange={() => {
                  setReason(r);
                  setReasonMissing(false);
                }}
              />
              {ERASE_REASON_LABELS[r]}
            </label>
          ))}
        </fieldset>
        {reasonMissing && <FieldError id={`${id}-reason-error`}>Choose a reason.</FieldError>}
        {needsCode && (
          <CodeField
            id={`${id}-code`}
            label="Authenticator code"
            hint="A fresh code from your authenticator app confirms it's you."
            value={code}
            onChange={setCode}
            error={codeError}
            errorKey={codeErrorKey}
          />
        )}
      </div>
      {failure && (
        <Notice tone="error" ref={refusal.ref}>
          {failure}
        </Notice>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => void confirm()}
          disabled={busy || blocked}
          aria-busy={busy || undefined}
        >
          {busy ? "Working…" : ZR_LEAD.eraseConfirm}
        </button>
      </div>
    </Modal>
  );
}

/** A lead erase refused, by its code. */
export function eraseRefusal(e: unknown): string {
  if (e instanceof RequestError) {
    if (e.code === "legal_hold") return ZR_LEAD.refused.legal_hold;
    if (e.code === "lead_converted") return ZR_LEAD.refused.lead_converted;
    if (e.code === "too_many_leads") return ZR_LEAD.refused.too_many_leads([]);
    if (e.code === "stale_version") return ZR_LEAD.refused.stale_version;
  }
  return errorText(e);
}
