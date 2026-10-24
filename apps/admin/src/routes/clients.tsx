// Clients (M3.3, ADM-CLI-01): keyset pages of GET /clients, newest first, with search (the start of a code or a name)
// and the GST status and currency filters, all in the URL; cards below md (DataTable). Every role that reads clients
// sees the tax identity; nothing on this list is a money setting.
import { formatDate, istDate } from "@techaust/core/dates";
import { countryName } from "@techaust/core/form-labels";
import { Link, useSearchParams } from "react-router";
import { api, type ClientsQuery, type ClientView, type Currency, type GstStatus } from "../api.ts";
import { type Column, DataTable, FilterBar, Pager } from "../components/data-table.tsx";
import { EmptyState, PageHeader } from "../components/display.tsx";
import { Building, Plus, Search } from "../components/icons.tsx";
import { LoadFailed, useLoad } from "../components/states.tsx";
import { allowed } from "../lib/access.ts";
import { GST_STATUS_LABELS, GST_STATUSES, stateText, TYPE_LABELS } from "../lib/clients.ts";
import { useUser } from "../session.tsx";
import { ClientsGate } from "./clients/parts.tsx";

/** The section's own description (the rail's "coming soon" text from M3.1, now true). */
const LEDE = "Clients and their contacts, who can use the client portal, and each client's statement.";

export function Component() {
  return (
    <ClientsGate>
      <Clients />
    </ClientsGate>
  );
}

const isGst = (v: string | null): v is GstStatus => GST_STATUSES.includes(v as GstStatus);
const isCurrency = (v: string | null): v is Currency => v === "INR" || v === "USD";

function Clients() {
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
  const q = params.get("q") ?? "";
  const gstP = params.get("gst");
  const gst = isGst(gstP) ? gstP : null;
  const curP = params.get("currency");
  const currency = isCurrency(curP) ? curP : null;
  const size = params.get("size") === "50" ? 50 : 25;
  const pageNo = Math.max(1, Number(params.get("page")) || 1);
  const searching = q.trim().length >= 2;
  const filtered = searching || !!gst || !!currency;
  const canWrite = allowed(user.role, "clients.write");

  const query: ClientsQuery = {
    limit: size === 50 ? "50" : undefined,
    q: searching ? q.trim() : undefined,
    gstStatus: gst ?? undefined,
    currency: currency ?? undefined,
    after: params.get("after") ?? undefined,
    before: params.get("before") ?? undefined,
  };
  const list = useLoad(() => api.clients(query), JSON.stringify(query));
  const rows = list.state === "ready" ? list.data.clients : [];
  const loading = list.state === "loading";
  const offset = (pageNo - 1) * size;
  const clear = () => set({ q: null, gst: null, currency: null });

  const columns: Column<ClientView>[] = [
    { key: "name", header: "Client", card: "title", width: "34%", cell: (r) => <ClientName client={r} /> },
    { key: "type", header: "Type", cell: (r) => TYPE_LABELS[r.type] },
    { key: "gst", header: "GST status", cell: (r) => GST_STATUS_LABELS[r.gstStatus] },
    {
      key: "tax",
      header: "GSTIN or place",
      cell: (r) =>
        r.gstin ? (
          <span className="docno">{r.gstin}</span>
        ) : r.stateCode ? (
          stateText(r.stateCode)
        ) : (
          countryName(r.country)
        ),
    },
    { key: "currency", header: "Currency", cell: (r) => <span className="docno">{r.currency}</span> },
    {
      key: "created",
      header: "Added",
      cell: (r) => (
        <time dateTime={new Date(r.createdAt).toISOString()}>{formatDate(istDate(r.createdAt))}</time>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Clients"
        lede={LEDE}
        action={
          canWrite ? (
            <Link to="/clients/new" className="btn btn--primary">
              <Plus />
              New client
            </Link>
          ) : undefined
        }
      />
      <FilterBar
        className="filters--clients"
        searchLabel="Search by the start of a client code or name"
        query={q}
        onQuery={(v) => set({ q: v })}
        groups={[
          {
            key: "gst",
            label: "GST status",
            selected: gst ? [gst] : [],
            options: GST_STATUSES.map((s) => ({ value: s, label: GST_STATUS_LABELS[s] })),
          },
          {
            key: "currency",
            label: "Currency",
            selected: currency ? [currency] : [],
            options: [
              { value: "INR", label: "INR" },
              { value: "USD", label: "USD" },
            ],
          },
        ]}
        onToggle={(group, value) => {
          const cur = { gst, currency }[group as "gst" | "currency"];
          set({ [group]: cur === value ? null : value });
        }}
        onClear={clear}
        result={
          loading
            ? "Loading…"
            : list.state === "ready"
              ? `${rows.length === 1 ? "1 client" : `${rows.length} clients`} on this page${q.trim().length === 1 ? ". Search starts at 2 characters" : ""}`
              : ""
        }
      />

      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="clients-table">
          <DataTable
            caption="Clients"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            skeletonRows={6}
            empty={
              <EmptyState
                icon={filtered ? <Search /> : <Building />}
                title={filtered ? "No clients match these filters" : "No clients yet"}
                action={
                  filtered ? (
                    <button type="button" className="btn btn--secondary" onClick={clear}>
                      Clear filters
                    </button>
                  ) : canWrite ? (
                    <Link to="/clients/new" className="btn btn--primary">
                      <Plus />
                      New client
                    </Link>
                  ) : undefined
                }
              >
                <p>
                  {filtered
                    ? "Try fewer filters, or search for the start of a client code or name."
                    : "A lead converted to a client appears here, and so does a client added by hand."}
                </p>
              </EmptyState>
            }
          />
        </div>
      )}

      {list.state === "ready" && rows.length > 0 && (
        <Pager
          noun="clients"
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

/** The display name (a link), the legal name when it differs, and the code. */
export function ClientName({ client }: { client: ClientView }) {
  return (
    <span className="person client-name">
      <Link className="person__name client-name__link" to={`/clients/${client.id}`}>
        {client.displayName}
      </Link>
      {client.legalName !== client.displayName && <span className="person__email">{client.legalName}</span>}
      <span className="client-name__code">
        <span className="visually-hidden">Code </span>
        <span className="docno">{client.code}</span>
      </span>
    </span>
  );
}
