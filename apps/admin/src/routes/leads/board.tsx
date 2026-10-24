// The leads board (M3.2, ADM-LEAD-02; docs/06 §5.3 Kanban): the five stages in pipeline order with their counts, the
// newest activity first in each (GET /leads/board, 25 a stage, "Show more" continues with GET /leads?stage=…).
// A card moves two ways, and both do the same thing:
// - drag it with a mouse or pen to another stage (pointer events; the card stays in place, dimmed, while a copy follows
//   the pointer; Escape cancels; the board scrolls sideways near its edges)
// - its "Move to…" menu, for the keyboard and screen readers (and touch, where the board scrolls instead)
// A move shows at once and is saved in the background; if the save fails the card goes back and a toast says why.
// Moving to Lost first asks for the reason (the dialog saves the move). Every move is announced in a polite region.
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  api,
  type BoardColumn,
  errorText,
  type LeadItem,
  type LeadStage,
  type LostReason,
} from "../../api.ts";
import { Grip } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { allowed } from "../../lib/access.ts";
import { STAGE_LABELS, STAGES } from "../../lib/leads.ts";
import { useUser } from "../../session.tsx";
import { LostDialog, MoveMenu, NextAction } from "./parts.tsx";

type Drag = {
  id: string;
  from: LeadStage;
  pointer: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Where the pointer grabbed the card, so the copy doesn't jump. */
  offX: number;
  offY: number;
  width: number;
  moving: boolean;
  over: LeadStage | null;
};

const EDGE = 48;
const START_AFTER = 6;

export function Board() {
  const user = useUser();
  const toast = useToast();
  const canMove = allowed(user.role, "leads.write");
  const board = useLoad(() => api.leadsBoard(), "");
  const [cols, setCols] = useState<BoardColumn[] | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [lost, setLost] = useState<{ lead: LeadItem; from: LeadStage } | null>(null);
  const [said, setSaid] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [more, setMore] = useState<LeadStage | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (board.state === "ready") setCols(board.data.stages);
  }, [board.state, board.data]);

  // After a move, focus goes to the moved card's own "Move to…" button (the one used is gone with its old place).
  useEffect(() => {
    if (!focusId) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-lead="${CSS.escape(focusId)}"] .move-btn`);
    el?.focus();
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

  if (board.state === "failed") return <LoadFailed error={board.error} onRetry={() => board.reload()} />;
  const columns = cols ?? (board.state === "ready" ? board.data.stages : null);

  /** Put a lead in another column (or back), keeping the counts right. */
  function place(lead: LeadItem, from: LeadStage, to: LeadStage, reason: LostReason | null) {
    setCols((cs) =>
      (cs ?? []).map((c) => {
        if (c.stage === from && c.stage === to)
          return { ...c, leads: c.leads.map((l) => (l.id === lead.id ? { ...l, lostReason: reason } : l)) };
        if (c.stage === from)
          return { ...c, count: c.count - 1, leads: c.leads.filter((l) => l.id !== lead.id) };
        if (c.stage === to)
          return {
            ...c,
            count: c.count + 1,
            leads: [{ ...lead, stage: to, lostReason: reason, lastActivityAt: Date.now() }, ...c.leads],
          };
        return c;
      }),
    );
  }

  function move(lead: LeadItem, to: LeadStage, keyboard: boolean) {
    if (to === lead.stage) return;
    if (to === "lost") {
      setLost({ lead, from: lead.stage });
      return;
    }
    const from = lead.stage;
    place(lead, from, to, null);
    setSaid(`Moved ${lead.name} to ${STAGE_LABELS[to]}.`);
    if (keyboard) setFocusId(lead.id);
    api.setLeadStage(lead.id, to).catch((e) => {
      place({ ...lead, stage: to }, to, from, lead.lostReason);
      setSaid(`${lead.name} is back in ${STAGE_LABELS[from]}: the move wasn't saved.`);
      toast("error", `Couldn't move ${lead.name}. ${errorText(e)}`);
    });
  }

  async function showMore(c: BoardColumn) {
    if (!c.next) return;
    setMore(c.stage);
    try {
      const r = await api.leads({ stage: c.stage, sort: "activity", after: c.next });
      setCols((cs) =>
        (cs ?? []).map((x) =>
          x.stage === c.stage
            ? {
                ...x,
                leads: [...x.leads, ...r.leads.filter((l) => !x.leads.some((y) => y.id === l.id))],
                next: r.next,
              }
            : x,
        ),
      );
    } catch (e) {
      toast("error", `Couldn't load more leads. ${errorText(e)}`);
    } finally {
      setMore(null);
    }
  }

  // ---- dragging (mouse and pen) ----
  function down(e: ReactPointerEvent<HTMLLIElement>, lead: LeadItem) {
    if (!canMove || e.button !== 0 || e.pointerType === "touch") return;
    if ((e.target as Element).closest("button, input, select, textarea")) return;
    const r = e.currentTarget.getBoundingClientRect();
    setDrag({
      id: lead.id,
      from: lead.stage,
      pointer: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      offX: e.clientX - r.left,
      offY: e.clientY - r.top,
      width: r.width,
      moving: false,
      over: null,
    });
  }

  function laneAt(x: number, y: number): LeadStage | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-stage]");
    const s = el?.dataset.stage;
    return s && (STAGES as readonly string[]).includes(s) ? (s as LeadStage) : null;
  }

  function moveTo(e: ReactPointerEvent<HTMLLIElement>) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const far = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > START_AFTER;
    if (!drag.moving && !far) return;
    if (!drag.moving) e.currentTarget.setPointerCapture(e.pointerId);
    const s = scroller.current;
    if (s) {
      const r = s.getBoundingClientRect();
      if (e.clientX < r.left + EDGE) s.scrollLeft -= 16;
      else if (e.clientX > r.right - EDGE) s.scrollLeft += 16;
    }
    setDrag({ ...drag, moving: true, x: e.clientX, y: e.clientY, over: laneAt(e.clientX, e.clientY) });
  }

  function up(e: ReactPointerEvent<HTMLLIElement>, lead: LeadItem) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    setDrag(null);
    if (!d.moving) return;
    suppressClick.current = true;
    const to = laneAt(e.clientX, e.clientY);
    if (to && to !== d.from) move(lead, to, false);
  }

  const dragged = drag?.moving ? columns?.flatMap((c) => c.leads).find((l) => l.id === drag.id) : undefined;

  return (
    <section
      className="board"
      aria-labelledby="board-title"
      aria-busy={board.state === "loading" || undefined}
    >
      <h2 id="board-title" className="visually-hidden">
        Board
      </h2>
      <p className="visually-hidden" role="status">
        {board.state === "loading" ? "Loading the board" : said}
      </p>
      <div className="board__scroll" ref={scroller} data-dragging={drag?.moving || undefined}>
        <ol className="board__lanes">
          {STAGES.map((stage) => {
            const c = columns?.find((x) => x.stage === stage);
            const over = drag?.moving && drag.over === stage && drag.from !== stage;
            return (
              <li
                key={stage}
                className="lane"
                data-stage={stage}
                data-over={over || undefined}
                aria-labelledby={`lane-${stage}`}
              >
                <div className="lane__head">
                  <h3 id={`lane-${stage}`} className="lane__name">
                    {STAGE_LABELS[stage]}
                  </h3>
                  <span className="lane__count">
                    {c ? c.count : "–"}
                    <span className="visually-hidden">{c?.count === 1 ? " lead" : " leads"}</span>
                  </span>
                </div>
                {!c ? (
                  <ul className="lane__cards" aria-hidden="true">
                    {[0, 1].map((i) => (
                      <li key={i} className="lead-card lead-card--skeleton">
                        <span className="skeleton" style={{ width: "70%" }} />
                        <span className="skeleton" style={{ width: "45%" }} />
                      </li>
                    ))}
                  </ul>
                ) : c.leads.length === 0 ? (
                  <p className="lane__empty">No leads</p>
                ) : (
                  <ul className="lane__cards">
                    {c.leads.map((l) => (
                      <li
                        key={l.id}
                        className="lead-card"
                        data-lead={l.id}
                        data-lifted={(drag?.moving && drag.id === l.id) || undefined}
                        onPointerDown={(e) => down(e, l)}
                        onPointerMove={moveTo}
                        onPointerUp={(e) => up(e, l)}
                        onPointerCancel={() => setDrag(null)}
                        onDragStart={(e) => e.preventDefault()}
                        onClickCapture={(e) => {
                          if (suppressClick.current) {
                            suppressClick.current = false;
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                      >
                        <CardBody lead={l} />
                        {canMove && (
                          <div className="lead-card__foot">
                            <span className="lead-card__grip" aria-hidden="true">
                              <Grip size={16} />
                            </span>
                            <MoveMenu lead={l} compact onMove={(to) => move(l, to, true)} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {c?.next && (
                  <button
                    type="button"
                    className="btn btn--text lane__more"
                    onClick={() => showMore(c)}
                    disabled={more === stage}
                    aria-busy={more === stage || undefined}
                  >
                    {more === stage ? "Loading…" : `Show more in ${STAGE_LABELS[stage]}`}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {dragged && drag && (
        <div
          className="lead-card lead-card--ghost"
          aria-hidden="true"
          style={{
            width: drag.width,
            transform: `translate(${drag.x - drag.offX}px, ${drag.y - drag.offY}px)`,
          }}
        >
          <CardBody lead={dragged} ghost />
        </div>
      )}

      <LostDialog
        lead={lost?.lead ?? null}
        onClose={() => setLost(null)}
        onMoved={(reason) => {
          if (!lost) return;
          place(lost.lead, lost.from, "lost", reason);
          setSaid(`Moved ${lost.lead.name} to Lost.`);
          setFocusId(lost.lead.id);
          setLost(null);
        }}
      />
    </section>
  );
}

function CardBody({ lead, ghost }: { lead: LeadItem; ghost?: boolean }) {
  return (
    <>
      <div className="lead-card__who">
        {ghost ? (
          <span className="lead-card__name">{lead.name}</span>
        ) : (
          <Link className="lead-card__name" to={`/leads/${lead.id}`} draggable={false}>
            {lead.name}
          </Link>
        )}
        {lead.company && <span className="lead-card__company">{lead.company}</span>}
      </div>
      <p className="lead-card__service">{lead.serviceName ?? "General enquiry"}</p>
      <dl className="lead-card__facts">
        <div>
          <dt className="visually-hidden">Reference</dt>
          <dd className="docno">{lead.ref}</dd>
        </div>
        <div>
          <dt className="visually-hidden">Owner</dt>
          <dd>{lead.ownerName ?? <span className="muted">Unassigned</span>}</dd>
        </div>
        {lead.nextActionAt !== null && (
          <div className="lead-card__next">
            <dt className="visually-hidden">Next action</dt>
            <dd>
              <NextAction lead={lead} />
            </dd>
          </div>
        )}
      </dl>
    </>
  );
}
