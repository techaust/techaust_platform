// The Services tab (M4.1, ADM-CAT-01, -02; ADM-G-03): keyset pages of GET /catalogue in code order, with search on the start
// of a code or a name and the category, status and website filters, all in the URL; cards below md (DataTable).
import { Link, useSearchParams } from "react-router";
import {
  type CatalogueCategory,
  type CatalogueListItem,
  type CatalogueQuery,
  catalogueApi,
} from "../../api.ts";
import { type Column, DataTable, FilterBar, Pager } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { Package, Plus, Search } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  COPY,
  PENDING,
  STATUS_LABELS,
  UNIT_LABELS,
} from "../../lib/catalogue.ts";
import { ItemPills, Prices, useCanWrite } from "./parts.tsx";

const isCategory = (v: string | null): v is CatalogueCategory => CATEGORIES.includes(v as CatalogueCategory);
const flag = (v: string | null) => (v === "1" || v === "0" ? v : null);

export function ServicesTab() {
  const canWrite = useCanWrite();
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
  const catP = params.get("category");
  const category = isCategory(catP) ? catP : null;
  const active = flag(params.get("active"));
  const onSite = flag(params.get("onSite"));
  const size = params.get("size") === "50" ? 50 : 25;
  const pageNo = Math.max(1, Number(params.get("page")) || 1);
  const query: CatalogueQuery = {
    limit: size === 50 ? "50" : undefined,
    q: q.trim() || undefined,
    category: category ?? undefined,
    active: active ?? undefined,
    onSite: onSite ?? undefined,
    after: params.get("after") ?? undefined,
    before: params.get("before") ?? undefined,
  };
  const filtered = !!query.q || !!category || !!active || !!onSite;
  const list = useLoad(() => catalogueApi.list(query), JSON.stringify(query));
  const rows = list.state === "ready" ? list.data.items : [];
  const loading = list.state === "loading";
  const offset = (pageNo - 1) * size;
  const clear = () => set({ q: null, category: null, active: null, onSite: null });

  const columns: Column<CatalogueListItem>[] = [
    { key: "name", header: "Service", card: "title", width: "38%", cell: (r) => <ServiceName item={r} /> },
    { key: "category", header: "Category", cell: (r) => CATEGORY_LABELS[r.category] },
    { key: "unit", header: "Unit", cell: (r) => UNIT_LABELS[r.unit] },
    {
      key: "price",
      header: "From",
      align: "end",
      cell: (r) => <Prices inr={r.priceInrMinor} usd={r.priceUsdMinor} />,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <span className="pill-row">
          <ItemPills item={r} />
          {r.showOnSite && <span className="muted pill-row__text">{STATUS_LABELS.onSite}</span>}
        </span>
      ),
    },
  ];

  return (
    <>
      <FilterBar
        className="filters--catalogue"
        searchLabel="Search by the start of a service code or name"
        query={q}
        onQuery={(v) => set({ q: v })}
        groups={[
          {
            key: "category",
            label: "Category",
            selected: category ? [category] : [],
            options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
          },
          {
            key: "active",
            label: "Status",
            selected: active ? [active] : [],
            options: [
              { value: "1", label: STATUS_LABELS.active },
              { value: "0", label: STATUS_LABELS.retired },
            ],
          },
          {
            key: "onSite",
            label: "Website",
            selected: onSite ? [onSite] : [],
            options: [
              { value: "1", label: STATUS_LABELS.onSite },
              { value: "0", label: STATUS_LABELS.offSite },
            ],
          },
        ]}
        onToggle={(group, value) => {
          const cur = { category, active, onSite }[group as "category" | "active" | "onSite"];
          set({ [group]: cur === value ? null : value });
        }}
        onClear={clear}
        result={
          loading
            ? "Loading…"
            : list.state === "ready"
              ? rows.length === 0
                ? ""
                : `${rows.length === 1 ? "1 service" : `${rows.length} services`} on this page`
              : ""
        }
      />

      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="catalogue-table">
          <DataTable
            caption="Services"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            skeletonRows={8}
            empty={
              <EmptyState
                icon={filtered ? <Search /> : <Package />}
                title={filtered ? PENDING.noMatchTitle : PENDING.emptyTitle}
                action={
                  filtered ? (
                    <button type="button" className="btn btn--secondary" onClick={clear}>
                      Clear filters
                    </button>
                  ) : canWrite ? (
                    <Link to="/catalogue/new" className="btn btn--primary">
                      <Plus />
                      New service
                    </Link>
                  ) : undefined
                }
              >
                <p>{filtered ? COPY.nothingMatches : PENDING.emptyBody}</p>
              </EmptyState>
            }
          />
        </div>
      )}

      {list.state === "ready" && rows.length > 0 && (
        <Pager
          noun="services"
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

/** The code, the name (a link) and the short description, clipped to two lines. */
function ServiceName({ item }: { item: CatalogueListItem }) {
  return (
    <span className="svc-name">
      <span className="svc-name__top">
        <span className="docno svc-name__code">{item.code}</span>
        <Link className="svc-name__link" to={`/catalogue/${item.id}`}>
          {item.name}
        </Link>
      </span>
      <span className="svc-name__short">{item.short}</span>
    </span>
  );
}
