// The Milestones tab (M3.4, ADM-PRJ-02): the project's milestones as one ruled ledger, in order, each with its amount or
// percentage of the budget, its due date and status, and a foot where the lines meet the budget (the server's total; the 07-K
// warning when they differ). Owner and staff add, edit and delete in a dialog, move a milestone between Pending and Ready to bill,
// and reorder two ways that do the same thing (the M3.2 board's rule):
// - drag a row by its handle (mouse, pen or touch; Escape cancels; a line shows where it lands)
// - its actions menu: Move up, Move down, Move to the top, Move to the bottom (keyboard and screen readers)
// A new order shows at once and is saved as one request; if it fails the old order comes back and the error is said in place.
// Invoiced and Paid are shown, never offered: invoicing sets them (M5).
import { type FormEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { api, type MilestoneView, type ProjectPage, RequestError } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { Modal } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { AlertTriangle, Grip, Plus, Receipt } from "../../components/icons.tsx";
import { MenuButton, type MenuItem } from "../../components/popover.tsx";
import { StaleNotice } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { allowed } from "../../lib/access.ts";
import {
  COPY,
  type MilestoneErrors,
  type MilestoneForm,
  milestoneDeletable,
  milestoneDeleteConfirm,
  milestoneFormOf,
  milestoneInput,
  milestoneOpen,
  milestonePatch,
  moneyText,
  moveItem,
  PENDING,
  percentText,
  projectErrorText,
  TOASTS,
  totalsWarning,
} from "../../lib/projects.ts";
import { useUser } from "../../session.tsx";
import { Day, MilestonePill, MoneyIn } from "./parts.tsx";
import type { Reload } from "./project.tsx";

type Drag = { id: string; pointer: number; startY: number; moving: boolean; to: number };
const START_AFTER = 6;

export function Milestones({ data, reload }: { data: ProjectPage; reload: Reload }) {
  const user = useUser();
  const toast = useToast();
  const canWrite = allowed(user.role, "projects.write");
  const { project } = data;
  const [order, setOrder] = useState<MilestoneView[]>(data.milestones);
  const [seen, setSeen] = useState(data.milestones);
  if (seen !== data.milestones) {
    setSeen(data.milestones);
    setOrder(data.milestones);
  }
  const [editing, setEditing] = useState<MilestoneView | "new" | null>(null);
  const [deleting, setDeleting] = useState<MilestoneView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const warning = totalsWarning(data.milestoneTotals, project.budgetMinor, project.currency);

  // After a keyboard move, focus goes back to the moved row's own actions button.
  useEffect(() => {
    if (!focusId) return;
    list.current?.querySelector<HTMLElement>(`[data-ms="${CSS.escape(focusId)}"] .menu > button`)?.focus();
    setFocusId(null);
  }, [focusId]);

  // Escape cancels a drag.
  useEffect(() => {
    if (!drag?.moving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDrag(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drag?.moving]);

  async function saveOrder(next: MilestoneView[], moved: MilestoneView, keyboard: boolean) {
    const before = order;
    setOrder(next);
    setFailure(null);
    if (keyboard) setFocusId(moved.id);
    try {
      await api.reorderMilestones(
        project.id,
        next.map((m) => m.id),
      );
      setSaid(TOASTS.milestonesReordered);
      toast("success", TOASTS.milestonesReordered);
      reload();
    } catch (e) {
      setOrder(before);
      const text = projectErrorText(e);
      setFailure(text);
      toast("error", text);
    }
  }

  function moveTo(m: MilestoneView, to: number, keyboard: boolean) {
    const from = order.findIndex((x) => x.id === m.id);
    if (from < 0 || to === from) return;
    saveOrder(moveItem(order, from, to), m, keyboard);
  }

  async function setStatus(m: MilestoneView, to: "pending" | "ready_to_bill") {
    setFailure(null);
    try {
      await api.setMilestoneStatus(m.id, to);
      toast("success", TOASTS.milestoneSaved);
      reload();
    } catch (e) {
      const text = projectErrorText(e);
      setFailure(text);
      toast("error", text);
    }
  }

  // ---- dragging by the handle ----
  function down(e: ReactPointerEvent<HTMLSpanElement>, m: MilestoneView) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: m.id, pointer: e.pointerId, startY: e.clientY, moving: false, to: order.indexOf(m) });
  }

  /** The index the dragged row would take: before the first row whose middle is below the pointer. */
  function slotAt(y: number): number {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-ms]") ?? [])];
    const from = order.findIndex((x) => x.id === drag?.id);
    let slot = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]?.getBoundingClientRect();
      if (r && y < r.top + r.height / 2) {
        slot = i;
        break;
      }
    }
    // Leaving the row where it is: dropping just after itself is no move.
    return slot > from ? slot - 1 : slot;
  }

  function dragMove(e: ReactPointerEvent<HTMLSpanElement>) {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!drag.moving && Math.abs(e.clientY - drag.startY) < START_AFTER) return;
    setDrag({ ...drag, moving: true, to: slotAt(e.clientY) });
  }

  function up(e: ReactPointerEvent<HTMLSpanElement>, m: MilestoneView) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    setDrag(null);
    if (d.moving) moveTo(m, d.to, false);
  }

  const dragFrom = drag?.moving ? order.findIndex((x) => x.id === drag.id) : -1;
  /** Where the drop line shows: above row `i` (or after the last row). */
  const lineAt = drag?.moving && drag.to !== dragFrom ? (drag.to > dragFrom ? drag.to + 1 : drag.to) : -1;

  function itemsFor(m: MilestoneView, i: number): MenuItem[] {
    const items: MenuItem[] = [];
    if (milestoneOpen(m)) items.push({ label: "Edit", onSelect: () => setEditing(m) });
    if (m.status === "pending" && m.documentId === null)
      items.push({ label: "Mark as ready to bill", onSelect: () => setStatus(m, "ready_to_bill") });
    if (m.status === "ready_to_bill" && m.documentId === null)
      items.push({ label: "Mark as pending", onSelect: () => setStatus(m, "pending") });
    if (i > 0) {
      items.push({ label: "Move up", onSelect: () => moveTo(m, i - 1, true) });
      if (i > 1) items.push({ label: "Move to the top", onSelect: () => moveTo(m, 0, true) });
    }
    if (i < order.length - 1) {
      items.push({ label: "Move down", onSelect: () => moveTo(m, i + 1, true) });
      if (i < order.length - 2)
        items.push({ label: "Move to the bottom", onSelect: () => moveTo(m, order.length - 1, true) });
    }
    if (milestoneDeletable(m))
      items.push({ label: "Delete", tone: "danger", onSelect: () => setDeleting(m) });
    return items;
  }

  return (
    <section className="lead-panel ledger-panel" aria-labelledby="ms-h" data-write={canWrite || undefined}>
      <div className="lead-panel__head">
        <h2 id="ms-h" className="lead-panel__title">
          Milestones
        </h2>
        {canWrite && (
          <button type="button" className="btn btn--secondary" onClick={() => setEditing("new")}>
            <Plus size={20} />
            Add milestone
          </button>
        )}
      </div>
      <p className="visually-hidden" role="status">
        {said}
      </p>
      {failure && <Notice tone="error">{failure}</Notice>}
      {order.length === 0 ? (
        <p className="muted ledger-empty">{PENDING.milestonesEmpty}</p>
      ) : (
        <>
          <div className="ledger__head" aria-hidden="true">
            {canWrite && <span />}
            <span />
            <span>Milestone</span>
            <span>Due</span>
            <span className="num">Amount</span>
            <span>Status</span>
            {canWrite && <span />}
          </div>
          <ol className="ledger" ref={list} data-dragging={drag?.moving || undefined}>
            {order.map((m, i) => (
              <li
                key={m.id}
                className="ledger__row"
                data-ms={m.id}
                data-lifted={(drag?.moving && drag.id === m.id) || undefined}
                data-line={lineAt === i || undefined}
                data-line-after={(lineAt === order.length && i === order.length - 1) || undefined}
              >
                {canWrite && (
                  // The handle is for a pointer only; the actions menu moves the row by keyboard.
                  <span
                    className="ledger__grip"
                    aria-hidden="true"
                    onPointerDown={(e) => down(e, m)}
                    onPointerMove={dragMove}
                    onPointerUp={(e) => up(e, m)}
                    onPointerCancel={() => setDrag(null)}
                  >
                    <Grip size={16} />
                  </span>
                )}
                <span className="ledger__pos tnum" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="ledger__title">
                  <span className="visually-hidden">{`${i + 1}. `}</span>
                  {m.title}
                  {m.status === "ready_to_bill" && (
                    <span className="ledger__invoice">
                      <button
                        type="button"
                        className="btn btn--text"
                        aria-disabled="true"
                        aria-describedby={`ms-inv-${m.id}`}
                        onClick={(e) => e.preventDefault()}
                      >
                        <Receipt size={16} />
                        Create invoice
                      </button>
                      <span id={`ms-inv-${m.id}`} className="hint">
                        {COPY.createInvoice}
                      </span>
                    </span>
                  )}
                </div>
                <span className="ledger__cell ledger__due">
                  <span className="ledger__label">Due</span>
                  <Day iso={m.dueDate} none="No due date" />
                </span>
                <span className="ledger__cell ledger__amount">
                  <span className="ledger__label">Amount</span>
                  <span className="tnum">
                    {m.pctBp !== null ? (
                      <>
                        <span>{percentText(m.pctBp)}</span>
                        <span className="ledger__resolved">
                          {m.resolvedMinor !== null
                            ? moneyText(m.resolvedMinor, project.currency)
                            : "No budget"}
                        </span>
                      </>
                    ) : m.amountMinor !== null ? (
                      moneyText(m.amountMinor, project.currency)
                    ) : null}
                  </span>
                </span>
                <span className="ledger__cell ledger__status">
                  <span className="ledger__label">Status</span>
                  <MilestonePill status={m.status} />
                </span>
                {canWrite && (
                  <span className="ledger__actions">
                    <MenuButton label={`Actions for ${m.title}`} items={itemsFor(m, i)} />
                  </span>
                )}
              </li>
            ))}
          </ol>
          <dl className="ledger__foot ledger-sum">
            <div>
              <dt>Total</dt>
              <dd className="tnum">{moneyText(data.milestoneTotals.totalMinor, project.currency)}</dd>
            </div>
            <div>
              <dt>Budget</dt>
              <dd className="tnum">
                {project.budgetMinor === null ? (
                  <span className="muted">Not set</span>
                ) : (
                  moneyText(project.budgetMinor, project.currency)
                )}
              </dd>
            </div>
          </dl>
          {warning && (
            <p className="field-warning ledger-warning" role="status">
              <AlertTriangle size={16} />
              {warning}
            </p>
          )}
        </>
      )}

      {canWrite && (
        <MilestoneDialog
          data={data}
          milestone={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
          onStaleReload={() => {
            setEditing(null);
            reload("stale");
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete the milestone"
        tone="danger"
        confirmLabel="Delete milestone"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return undefined;
          try {
            await api.deleteMilestone(deleting.id);
          } catch (e) {
            throw new RequestError(0, e instanceof RequestError ? e.code : "network", projectErrorText(e));
          }
          toast("success", PENDING.milestoneDeleted);
          reload();
          return undefined;
        }}
      >
        <p>{deleting ? milestoneDeleteConfirm(deleting.title) : ""}</p>
      </ConfirmDialog>
    </section>
  );
}

function MilestoneDialog(props: {
  data: ProjectPage;
  milestone: MilestoneView | "new" | null;
  onClose: () => void;
  onSaved: () => void;
  onStaleReload: () => void;
}) {
  const toast = useToast();
  const { project } = props.data;
  const m = props.milestone === "new" ? null : props.milestone;
  const [f, setF] = useState<MilestoneForm>(() => milestoneFormOf(m, project.currency));
  const [errors, setErrors] = useState<MilestoneErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<MilestoneView | "new" | null>(null);
  if (props.milestone !== shown) {
    setShown(props.milestone);
    setF(milestoneFormOf(m, project.currency));
    setErrors({});
    setFailure(null);
    setStale(false);
  }
  const set = (patch: Partial<MilestoneForm>) => setF((x) => ({ ...x, ...patch }));

  async function save(e: FormEvent) {
    e.preventDefault();
    const r = milestoneInput(f, project.currency);
    if (!r.ok) {
      setErrors(r.errors);
      const first = Object.keys(r.errors)[0];
      if (first) document.getElementById(`ms-${first}`)?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    setFailure(null);
    try {
      if (m) {
        const patch = milestonePatch(m, r.body);
        if (Object.keys(patch).length) {
          await api.updateMilestone(m.id, { ...patch, expectedUpdatedAt: m.updatedAt });
          toast("success", TOASTS.milestoneSaved);
        }
      } else {
        await api.addMilestone(project.id, r.body);
        toast("success", TOASTS.milestoneAdded);
      }
      props.onSaved();
    } catch (err) {
      if (err instanceof RequestError && err.code === "stale_version") setStale(true);
      else setFailure(projectErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={props.milestone !== null}
      title={m ? "Edit milestone" : "Add milestone"}
      onClose={props.onClose}
      busy={busy}
    >
      <form onSubmit={save} noValidate className="milestone-form">
        <div className="dialog__body">
          {stale && <StaleNotice title={PENDING.staleMilestone} onReload={props.onStaleReload} />}
          {failure && <Notice tone="error">{failure}</Notice>}
          <FormField id="ms-title" label="Title" error={errors.title}>
            {(a) => (
              <input
                {...a}
                autoComplete="off"
                maxLength={200}
                value={f.title}
                onChange={(e) => set({ title: e.target.value })}
              />
            )}
          </FormField>
          <fieldset className="radios">
            <legend>Amount</legend>
            <div className="segmented">
              {(
                [
                  ["amount", "Fixed amount"],
                  ["pct", "Percentage of the budget"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="segmented__opt">
                  <input
                    type="radio"
                    name="ms-kind"
                    value={k}
                    checked={f.kind === k}
                    onChange={() => set({ kind: k })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {f.kind === "amount" ? (
            <FormField id="ms-amount" label="Fixed amount" error={errors.amount}>
              {(a) => (
                <MoneyIn
                  a11y={a}
                  currency={project.currency}
                  value={f.amount}
                  onChange={(v) => set({ amount: v })}
                />
              )}
            </FormField>
          ) : (
            <FormField
              id="ms-pct"
              label="Percentage of the budget"
              error={errors.pct}
              hint={
                project.budgetMinor === null
                  ? undefined
                  : `Budget: ${moneyText(project.budgetMinor, project.currency)}`
              }
            >
              {(a) => (
                <div className="number-unit">
                  <input
                    {...a}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={f.pct}
                    onChange={(e) => set({ pct: e.target.value })}
                  />
                  <span className="number-unit__unit" aria-hidden="true">
                    %
                  </span>
                </div>
              )}
            </FormField>
          )}
          <FormField id="ms-due" label="Due date" optional>
            {(a) => (
              <input
                {...a}
                type="date"
                value={f.dueDate}
                onChange={(e) => set({ dueDate: e.target.value })}
              />
            )}
          </FormField>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || stale}
            aria-busy={busy || undefined}
          >
            {busy ? "Saving…" : m ? "Save milestone" : "Add milestone"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
