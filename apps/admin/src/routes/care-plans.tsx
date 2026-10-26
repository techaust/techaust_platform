// Care plans (M3.5, ADM-CARE-01, ADM-CARE-03): keyset pages of GET /care-plans, newest first, with the status and client filters in
// the URL, and each plan's hours this billing period as words and a calm bar; cards below md (DataTable). Owner and staff add
// plans; Sales and the accountant read.
import { Link, useSearchParams } from "react-router";
import { api, type CarePlanRow, type CarePlansQuery, type CareStatus } from "../api.ts";
import { type Column, DataTable, FilterBar, Pager } from "../components/data-table.tsx";
import { EmptyState, PageHeader } from "../components/display.tsx";
import { LifeBuoy, Plus, Search } from "../components/icons.tsx";
import { LoadFailed, useLoad } from "../components/states.tsx";
import { allowed } from "../lib/access.ts";
import { CARE_COPY, CARE_PENDING, CARE_STATUS_LABELS, CARE_STATUSES, moneyText } from "../lib/care.ts";
import { useUser } from "../session.tsx";
import { CareGate, CarePill, FlagPill, HoursBar, PlanName, tierOf, tierText } from "./care/parts.tsx";
import { ClientFilter } from "./projects/client-filter.tsx";
import { Day } from "./projects/parts.tsx";

export function Component() {
  return (
    <CareGate>
      <CarePlans />
    </CareGate>
  );
}

const isStatus = (v: string | null): v is CareStatus => CARE_STATUSES.includes(v as CareStatus);

/** The columns of a list of plans (this screen and the client page's tab). */
export function planColumns(withClient: boolean): Column<CarePlanRow>[] {
  return [
    {
      key: "plan",
      header: withClient ? "Client" : "Plan",
      card: "title",
      width: withClient ? "24%" : "20%",
      cell: (r) => (
        <PlanName
          id={r.id}
          title={withClient ? r.clientName : tierText(tierOf(r))}
          code={withClient ? r.clientCode : undefined}
          sub={withClient ? tierText(tierOf(r)) : undefined}
        />
      ),
    },
    { key: "status", header: "Status", cell: (r) => <CarePill status={r.status} /> },
    {
      key: "hours",
      header: "Hours this period",
      width: "30%",
      cell: (r) =>
        r.usage ? (
          <span className="plan-hours">
            <HoursBar usage={r.usage} />
            <FlagPill flag={r.usage.flag} />
          </span>
        ) : (
          <span className="muted">{CARE_COPY.notStarted}</span>
        ),
    },
    {
      key: "price",
      header: "Price per month",
      align: "end",
      cell: (r) =>
        r.terms.current ? (
          <span className="tnum">{moneyText(r.terms.current.priceMinor, r.currency)}</span>
        ) : (
          <span className="muted">Not set</span>
        ),
    },
    { key: "start", header: "Start date", cell: (r) => <Day iso={r.startDate} /> },
    {
      key: "billing",
      header: "Billing day",
      align: "end",
      cell: (r) => <span className="tnum">{r.billingDay}</span>,
    },
  ];
}

function CarePlans() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const set = (changes: Record<string, string | null>, keepCursor = false) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === "") n.delete(k);
          else n.set(k, v);
        }
        if (!keepCursor) {
          n.delete("after");
          n.delete("before");
          n.delete("page");
        }
        return n;
      },
      { replace: true },
    );
  const statusP = params.get("status");
  const status = isStatus(statusP) ? statusP : null;
  const client = params.get("client") ?? "";
  const size = params.get("size") === "50" ? 50 : 25;
  const pageNo = Math.max(1, Number(params.get("page")) || 1);
  const filtered = !!status || !!client;
  const canWrite = allowed(user.role, "carePlans.write");

  const query: CarePlansQuery = {
    limit: size === 50 ? "50" : undefined,
    status: status ?? undefined,
    clientId: client || undefined,
    after: params.get("after") ?? undefined,
    before: params.get("before") ?? undefined,
  };
  const list = useLoad(() => api.carePlans(query), JSON.stringify(query));
  const rows = list.state === "ready" ? list.data.carePlans : [];
  const loading = list.state === "loading";
  const offset = (pageNo - 1) * size;
  const clear = () => set({ status: null, client: null });
  const newHref = client ? `/care-plans/new?client=${encodeURIComponent(client)}` : "/care-plans/new";

  return (
    <>
      <PageHeader
        title="Care plans"
        action={
          canWrite ? (
            <Link to={newHref} className="btn btn--primary">
              <Plus />
              New care plan
            </Link>
          ) : undefined
        }
      />
      <FilterBar
        className="filters--clients filters--care"
        groups={[
          {
            key: "status",
            label: "Status",
            selected: status ? [status] : [],
            options: CARE_STATUSES.map((s) => ({ value: s, label: CARE_STATUS_LABELS[s] })),
          },
        ]}
        onToggle={(_, value) => set({ status: status === value ? null : value })}
        extra={
          <ClientFilter
            clientId={client}
            onChange={(id) => set({ client: id })}
            idBase="care-client"
            clearLabel={CARE_PENDING.clientFilterClear}
          />
        }
        extraOn={client ? 1 : 0}
        onClear={clear}
        result={
          loading
            ? "Loading…"
            : list.state === "ready"
              ? rows.length === 0
                ? ""
                : `${rows.length === 1 ? "1 care plan" : `${rows.length} care plans`} on this page`
              : ""
        }
      />

      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="clients-table care-table">
          <DataTable
            caption="Care plans"
            columns={planColumns(true)}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            skeletonRows={5}
            empty={
              <EmptyState
                icon={filtered ? <Search /> : <LifeBuoy />}
                title={filtered ? "No care plans match these filters" : CARE_COPY.listEmptyTitle}
                action={
                  filtered ? (
                    <button type="button" className="btn btn--secondary" onClick={clear}>
                      Clear filters
                    </button>
                  ) : canWrite ? (
                    <Link to="/care-plans/new" className="btn btn--primary">
                      <Plus />
                      New care plan
                    </Link>
                  ) : undefined
                }
              >
                <p>{filtered ? CARE_COPY.listNoMatch : CARE_COPY.listEmptyBody}</p>
              </EmptyState>
            }
          />
        </div>
      )}

      {list.state === "ready" && rows.length > 0 && (
        <Pager
          noun="care plans"
          from={offset + 1}
          to={offset + rows.length}
          hasPrev={list.data.prev !== null}
          hasNext={list.data.next !== null}
          onPrev={() =>
            pageNo <= 2
              ? set({})
              : set({ before: list.data.prev, after: null, page: String(pageNo - 1) }, true)
          }
          onNext={() => set({ after: list.data.next, before: null, page: String(pageNo + 1) }, true)}
          pageSize={size}
          onPageSize={(n) => set({ size: n === 50 ? "50" : null })}
        />
      )}
    </>
  );
}
