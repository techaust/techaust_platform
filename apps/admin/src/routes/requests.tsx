// The requests inbox (M7.4 G.1; ADM-SET-09, ADM-CLI-05, POR-11; run file C.1–C.4): every request about personal data or portal access, from a client's
// contact, a lead or someone not yet in our records, whichever way it came. "Show" picks the open ones (oldest first), the overdue ones, those due within 5
// days or not acknowledged in 48 hours (by reply date, C.1), or the closed ones; "Kind" narrows to one kind. Both live in the URL, and so does the open
// request (`?id=`, the bells' link: `apps/jobs/src/retention.ts` CLOCK_BELLS_SQL), which opens in a dialog with its steps and its close
// (requests/detail.tsx). Owner and Staff log a request that came another way (requests/log.tsx). The reply clock (requests/clock.tsx) is this screen's one
// strong mark; everything else is the admin's quiet table.
import "../dp.css";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { errorText } from "../api.ts";
import { type Column, DataTable } from "../components/data-table.tsx";
import { EmptyState, PageHeader, StatusPill } from "../components/display.tsx";
import { Inbox, Plus } from "../components/icons.tsx";
import { LoadFailed, NoAccess, useLoad } from "../components/states.tsx";
import { useToast } from "../components/toast.tsx";
import { Notice } from "../components/ui.tsx";
import { allowed } from "../lib/access.ts";
import { REQUESTS_CHANGED, ZR_DETAIL, ZR_REQ } from "../lib/copy-zr.ts";
import { m74Api, REQUEST_KINDS, type RequestView } from "../lib/m74-api.ts";
import {
  channelText,
  dayText,
  isShow,
  kindText,
  queryOf,
  SHOW,
  type Show,
  stateLook,
  subjectOf,
} from "../lib/requests.ts";
import { useUser } from "../session.tsx";
import { ReplyClock } from "./requests/clock.tsx";
import { RequestDialog } from "./requests/detail.tsx";
import { LogRequestDialog } from "./requests/log.tsx";

export function Component() {
  const user = useUser();
  return allowed(user.role, "requests.read") ? <RequestsInbox /> : <NoAccess what={ZR_REQ.title} />;
}

function RequestsInbox() {
  const user = useUser();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const asked = params.get("show");
  const show: Show = isShow(asked) ? asked : "open";
  const kind = params.get("kind") ?? "";
  const openId = params.get("id");
  const key = `${show}|${kind}`;
  const list = useLoad(() => m74Api.requests(queryOf(show, kind)), key);
  const [more, setMore] = useState<{ key: string; items: RequestView[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [logging, setLogging] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The clock reads today's place: refreshed with every load, never ticking on its own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new answer is a new "now"
  useEffect(() => setNow(Date.now()), [list.data]);
  const extra = more?.key === key ? more : null;
  const rows = [...(list.data?.items ?? []), ...(extra?.items ?? [])];
  const next = extra ? extra.next : (list.data?.next ?? null);
  const canLog = allowed(user.role, "requests.log");

  // The request the URL names: from the rows shown; one not among them (another "Show", a closed one) is said once, never guessed at.
  // A request already open stays open when a step takes it out of the list shown (acknowledged under "Not acknowledged"): its last copy is kept.
  const found = openId ? (rows.find((r) => r.id === openId) ?? null) : null;
  const [kept, setKept] = useState<RequestView | null>(null);
  if (found && found !== kept) setKept(found);
  const selected = found ?? (kept && kept.id === openId ? kept : null);
  const missing = openId !== null && list.state === "ready" && selected === null;

  const setParam = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v === null || v === "") n.delete(k);
        else n.set(k, v);
        return n;
      },
      { replace: k !== "id" },
    );

  function changed() {
    setMore(null);
    list.reload(true);
    window.dispatchEvent(new Event(REQUESTS_CHANGED));
  }

  async function showMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const r = await m74Api.requests(queryOf(show, kind, next));
      setMore((m) => {
        const was = m?.key === key ? m.items : [];
        return {
          key,
          items: [...was, ...r.items.filter((x) => !was.some((y) => y.id === x.id))],
          next: r.next,
        };
      });
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const href = (id: string) => {
    const p = new URLSearchParams(params);
    p.set("id", id);
    return `/requests?${p.toString()}`;
  };

  const columns: Column<RequestView>[] = [
    {
      key: "request",
      header: ZR_REQ.colRequest,
      card: "title",
      width: "28%",
      cell: (r) => (
        <Link to={href(r.id)} className="dp-row-open">
          {kindText(r.kind)}
        </Link>
      ),
    },
    {
      key: "from",
      header: ZR_REQ.colFrom,
      cell: (r) => {
        const s = subjectOf(r);
        return (
          <span className="dp-cell">
            <span className="break">{s.name}</span>
            {s.meta && <span className="dp-cell__meta break">{s.meta}</span>}
          </span>
        );
      },
    },
    {
      key: "received",
      header: ZR_REQ.colReceived,
      cell: (r) => (
        <span className="dp-cell">
          <span className="when--keep">{dayText(r.receivedAt ?? r.createdAt)}</span>
          <span className="dp-cell__meta">{channelText(r.channel)}</span>
        </span>
      ),
    },
    {
      key: "due",
      header: show === "closed" ? ZR_REQ.colStatus : ZR_REQ.colReplyBy,
      cell: (r) =>
        r.status === "open" ? (
          <ReplyClock r={r} now={now} />
        ) : (
          <span className="dp-cell">
            <ClosedPill r={r} />
            {r.closedAt !== null && <span className="dp-cell__meta">{dayText(r.closedAt)}</span>}
          </span>
        ),
    },
    ...(show === "closed"
      ? []
      : [
          {
            key: "status",
            header: ZR_REQ.colStatus,
            cell: (r: RequestView) => {
              const look = stateLook(r);
              return (
                <StatusPill tone={look.tone} icon={look.icon}>
                  {look.text}
                </StatusPill>
              );
            },
          } satisfies Column<RequestView>,
        ]),
  ];

  return (
    <>
      <PageHeader
        title={ZR_REQ.title}
        lede={ZR_REQ.lede}
        action={
          canLog ? (
            <button type="button" className="btn btn--primary" onClick={() => setLogging(true)}>
              <Plus />
              {ZR_REQ.logButton}
            </button>
          ) : undefined
        }
      />
      <section className="filters dp-filters" aria-label="Filters">
        <fieldset className="dp-show">
          <legend className="dp-show__legend">{ZR_REQ.showLabel}</legend>
          <div className="dp-show__row">
            {SHOW.map((s) => (
              <label key={s} className="dp-show__opt">
                <input
                  type="radio"
                  name="dp-show"
                  checked={show === s}
                  onChange={() => {
                    setMore(null);
                    setParam("show", s === "open" ? null : s);
                  }}
                />
                {ZR_REQ.show[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field dp-kind">
          <label htmlFor="dp-kind">{ZR_REQ.kindLabel}</label>
          <select
            id="dp-kind"
            value={kind}
            onChange={(e) => {
              setMore(null);
              setParam("kind", e.target.value);
            }}
          >
            <option value="">{ZR_REQ.allKinds}</option>
            {REQUEST_KINDS.map((k) => (
              <option key={k} value={k}>
                {ZR_REQ.kind[k]}
              </option>
            ))}
          </select>
        </div>
      </section>
      {missing && <Notice tone="info">{ZR_DETAIL.notInList}</Notice>}
      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <DataTable
          caption={ZR_REQ.title}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={list.state === "loading"}
          skeletonRows={4}
          cardSub={(r) => subjectOf(r).name}
          empty={
            <EmptyState icon={<Inbox />} title={(ZR_REQ.empty[show] ?? "").replace(/\.$/, "")}>
              <p>{ZR_REQ.emptyHint}</p>
            </EmptyState>
          }
        />
      )}
      {next && (
        <button
          type="button"
          className="btn btn--secondary dp-more"
          onClick={() => void showMore()}
          disabled={loadingMore}
          aria-busy={loadingMore || undefined}
        >
          {loadingMore ? "Loading…" : "Show more"}
        </button>
      )}
      {selected && (
        <RequestDialog
          request={selected}
          now={now}
          onClose={() => setParam("id", null)}
          onChanged={changed}
        />
      )}
      {logging && (
        <LogRequestDialog
          onClose={() => setLogging(false)}
          onLogged={(r) => {
            setLogging(false);
            changed();
            // the new request opens, so its steps are next to hand (it is open, so the Open list holds it)
            setParams(() => new URLSearchParams({ id: r.id }));
          }}
        />
      )}
    </>
  );
}

function ClosedPill({ r }: { r: RequestView }) {
  const look = stateLook(r);
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {look.text}
    </StatusPill>
  );
}
