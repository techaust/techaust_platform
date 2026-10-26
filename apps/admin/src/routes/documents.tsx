// Proposals and estimates (M4.3, ADM-PROP-01, -06, ADM-EST-01): one list for both types, reached from either rail item (Proposals opens it
// on proposals, Estimates on estimates; the type chip turns that off). Keyset pages of GET /documents, newest first, the latest version of
// each document only. Filters live in the URL: type, status and client. The search finds a document by the start of its number (the
// global search's own index, so it stays one D1 call). Each row shows the custom lines' count and value: the discount guard ignores them,
// and the owner reviews them (O-Q1).
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { api } from "../api.ts";
import { DataTable, FilterBar, Pager } from "../components/data-table.tsx";
import { EmptyState, PageHeader } from "../components/display.tsx";
import { FileText, Plus, Search } from "../components/icons.tsx";
import { LoadFailed, useLoad } from "../components/states.tsx";
import { allowed } from "../lib/access.ts";
import { DOC_COPY, DOC_PENDING, QUOTE_STATUSES, STATUS_LABELS, TYPE_LABELS } from "../lib/documents.ts";
import { documentsApi, type QuoteStatus, type QuoteType } from "../lib/documents-api.ts";
import { useUser } from "../session.tsx";
import { NewDocumentDialog } from "./documents/new.tsx";
import { DocsGate, documentColumns } from "./documents/parts.tsx";
import { ClientFilter, useDebounced } from "./projects/client-filter.tsx";

export function Component() {
  return (
    <DocsGate>
      <DocumentList />
    </DocsGate>
  );
}

const isStatus = (v: string | null): v is QuoteStatus => QUOTE_STATUSES.includes(v as QuoteStatus);

function DocumentList() {
  const user = useUser();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const fromPath: QuoteType = pathname.startsWith("/estimates") ? "estimate" : "proposal";
  const type: QuoteType | null = params.get("type") === "all" ? null : fromPath;
  const statusP = params.get("status");
  const status = isStatus(statusP) ? statusP : null;
  const client = params.get("client") ?? "";
  const size = params.get("size") === "50" ? 50 : 25;
  const after = params.get("after");
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim().length >= 2 ? q.trim() : "");
  const [trail, setTrail] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const canDraft = allowed(user.role, "proposals.draft");

  const set = (changes: Record<string, string | null>, keepCursor = false) => {
    if (!keepCursor) setTrail([]);
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === "") n.delete(k);
          else n.set(k, v);
        }
        if (!keepCursor) n.delete("after");
        return n;
      },
      { replace: true },
    );
  };

  const query = {
    type: type ?? undefined,
    status: status ?? undefined,
    clientId: client || undefined,
    limit: size === 50 ? ("50" as const) : undefined,
    after: after ?? undefined,
  };
  const list = useLoad(() => documentsApi.list(query), JSON.stringify(query));
  const found = useLoad(() => (term ? api.search(term) : Promise.resolve(null)), term);
  const rows = list.state === "ready" ? list.data.documents : [];
  const loading = list.state === "loading";
  const filtered = !!status || !!client;
  const offset = trail.length * size;
  const clear = () => {
    setQ("");
    set({ status: null, client: null, type: null });
  };
  // A new filter starts from the first page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the trail belongs to one filter set
  useEffect(() => setTrail([]), [type, status, client, size]);

  const hits =
    found.state === "ready" ? (found.data?.groups.find((g) => g.type === "document")?.items ?? []) : [];

  return (
    <>
      <PageHeader
        title={DOC_COPY.listHeading}
        action={
          canDraft ? (
            <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
              <Plus />
              {DOC_COPY.createTitle}
            </button>
          ) : undefined
        }
      />
      <FilterBar
        className="filters--clients filters--docs"
        searchLabel={DOC_PENDING.searchNumber}
        query={q}
        onQuery={setQ}
        groups={[
          {
            key: "type",
            label: DOC_COPY.type,
            selected: type ? [type] : [],
            options: (["proposal", "estimate"] as const).map((t) => ({ value: t, label: TYPE_LABELS[t] })),
          },
          {
            key: "status",
            label: "Status",
            selected: status ? [status] : [],
            options: QUOTE_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
          },
        ]}
        onToggle={(group, value) => {
          if (group === "type") {
            if (type === value) set({ type: "all" });
            else {
              const n = new URLSearchParams(params);
              n.delete("type");
              n.delete("after");
              navigate({
                pathname: value === "estimate" ? "/estimates" : "/proposals",
                search: n.toString(),
              });
            }
          } else set({ status: status === value ? null : value });
        }}
        extra={<ClientFilter clientId={client} onChange={(id) => set({ client: id })} idBase="docs-client" />}
        extraOn={client ? 1 : 0}
        onClear={clear}
        result={
          term
            ? found.state === "loading"
              ? "Loading…"
              : `${hits.length === 1 ? "1 match" : `${hits.length} matches`}`
            : loading
              ? "Loading…"
              : list.state === "ready"
                ? `${rows.length === 1 ? "1 document" : `${rows.length} documents`} on this page`
                : ""
        }
      />

      {term ? (
        <NumberResults state={found.state} error={found.error} hits={hits} retry={() => found.reload()} />
      ) : list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="clients-table docs-table">
          <DataTable
            caption={DOC_COPY.listHeading}
            columns={documentColumns(true, rows)}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            skeletonRows={5}
            empty={
              <EmptyState
                icon={filtered ? <Search /> : <FileText />}
                title={filtered ? DOC_PENDING.listNoMatchTitle : DOC_COPY.listEmptyTitle}
                action={
                  filtered ? (
                    <button type="button" className="btn btn--secondary" onClick={clear}>
                      Clear filters
                    </button>
                  ) : canDraft ? (
                    <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
                      <Plus />
                      {DOC_COPY.createTitle}
                    </button>
                  ) : undefined
                }
              >
                <p>{filtered ? DOC_COPY.listNoMatch : DOC_COPY.listEmptyBody}</p>
              </EmptyState>
            }
          />
        </div>
      )}

      {!term && list.state === "ready" && rows.length > 0 && (
        <Pager
          noun="documents"
          from={offset + 1}
          to={offset + rows.length}
          hasPrev={trail.length > 0}
          hasNext={list.data.next !== null}
          onPrev={() => {
            const back = trail.slice(0, -1);
            const cursor = back.at(-1) ?? null;
            setTrail(back);
            set({ after: cursor }, true);
          }}
          onNext={() => {
            const next = list.data.next;
            if (!next) return;
            setTrail((t) => [...t, next]);
            set({ after: next }, true);
          }}
          pageSize={size}
          onPageSize={(n) => set({ size: n === 50 ? "50" : null })}
        />
      )}

      {canDraft && (
        <NewDocumentDialog
          open={creating}
          type={type ?? fromPath}
          clientId={client || undefined}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

/** The search by number: the documents whose number starts with what was typed (latest version of each). */
function NumberResults(props: {
  state: "loading" | "ready" | "failed";
  error: unknown;
  hits: { id: string; title: string; subtitle: string; link: string }[];
  retry: () => void;
}) {
  if (props.state === "failed") return <LoadFailed error={props.error} onRetry={props.retry} />;
  if (props.state === "loading")
    return (
      <p className="hint" role="status">
        Loading…
      </p>
    );
  if (props.hits.length === 0)
    return (
      <EmptyState icon={<Search />} title={DOC_PENDING.searchNoMatch}>
        <p>{DOC_COPY.listNoMatch}</p>
      </EmptyState>
    );
  return (
    <ul className="lead-panel doc-hits">
      {props.hits.map((h) => (
        <li key={h.id} className="doc-hits__row">
          <Link to={h.link} className="doc-hits__link">
            {h.title}
          </Link>
          <span className="doc-hits__sub">{h.subtitle}</span>
        </li>
      ))}
    </ul>
  );
}
