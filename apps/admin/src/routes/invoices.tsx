// Invoices (M5.1, ADM-INV-01, -02): every invoice-family document, newest first, keyset pages of GET /invoices (25 or 50). Filters live in the
// URL: type, status (Draft, Issued, Overdue, Void: Overdue is the server's, a balance past its due date) and client. A draft has no number yet
// ("Not issued yet"); an issued number is drawn solid, a voided one struck through. Sales never reaches this screen (the rail hides it and the
// API answers 403).
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { DataTable, FilterBar, Pager } from "../components/data-table.tsx";
import { EmptyState, PageHeader } from "../components/display.tsx";
import { Plus, Receipt, Search } from "../components/icons.tsx";
import { LoadFailed, useLoad } from "../components/states.tsx";
import { allowed } from "../lib/access.ts";
import {
  BADGE_LABELS,
  BADGES,
  type Badge,
  INV_COPY,
  INV_PLACEHOLDER,
  INVOICE_TYPES,
  splitSentences,
  typeLabel,
} from "../lib/invoices.ts";
import { type InvoiceType, invoicesApi } from "../lib/invoices-api.ts";
import { useUser } from "../session.tsx";
import { NewInvoiceDialog } from "./invoices/new.tsx";
import { InvoicesGate, invoiceColumns } from "./invoices/parts.tsx";
import { ClientFilter } from "./projects/client-filter.tsx";

export function Component() {
  return (
    <InvoicesGate>
      <InvoiceList />
    </InvoicesGate>
  );
}

/** 07-R's empty line: its first sentence as the title (no full stop, as every empty state), the rest beneath. */
const EMPTY = splitSentences(INV_COPY.empty);

const isBadge = (v: string | null): v is Badge => BADGES.includes(v as Badge);
const isType = (v: string | null): v is InvoiceType => INVOICE_TYPES.includes(v as InvoiceType);

function InvoiceList() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const typeP = params.get("type");
  const type = isType(typeP) ? typeP : null;
  const statusP = params.get("status");
  const status = isBadge(statusP) ? statusP : null;
  const client = params.get("client") ?? "";
  const size = params.get("size") === "50" ? 50 : 25;
  const after = params.get("after");
  const [trail, setTrail] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const canDraft = allowed(user.role, "invoices.draft");

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
    // the badge "Partly credited" is the stored status `partially_credited` (M5.3); every other badge is its status
    status: status === "partly_credited" ? ("partially_credited" as const) : (status ?? undefined),
    clientId: client || undefined,
    limit: size === 50 ? ("50" as const) : undefined,
    after: after ?? undefined,
  };
  const list = useLoad(() => invoicesApi.list(query), JSON.stringify(query));
  const rows = list.state === "ready" ? list.data.invoices : [];
  const loading = list.state === "loading";
  const filtered = !!type || !!status || !!client;
  const offset = trail.length * size;
  const clear = () => set({ status: null, client: null, type: null });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the trail belongs to one filter set
  useEffect(() => setTrail([]), [type, status, client, size]);

  const newButton = (
    <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
      <Plus />
      {INV_COPY.newInvoice}
    </button>
  );

  return (
    <>
      <PageHeader title={INV_COPY.title} lede={INV_COPY.intro} action={canDraft ? newButton : undefined} />
      <FilterBar
        className="filters--clients filters--docs filters--invoices"
        groups={[
          {
            key: "type",
            label: INV_COPY.filterType,
            selected: type ? [type] : [],
            options: INVOICE_TYPES.map((t) => ({ value: t, label: typeLabel(t) })),
          },
          {
            key: "status",
            label: INV_COPY.filterStatus,
            selected: status ? [status] : [],
            options: BADGES.map((b) => ({ value: b, label: BADGE_LABELS[b] })),
          },
        ]}
        onToggle={(group, value) => {
          if (group === "type") set({ type: type === value ? null : value });
          else set({ status: status === value ? null : value });
        }}
        extra={<ClientFilter clientId={client} onChange={(id) => set({ client: id })} idBase="inv-client" />}
        extraOn={client ? 1 : 0}
        onClear={clear}
        result={
          loading
            ? "Loading…"
            : list.state === "ready" && rows.length > 0
              ? `${rows.length === 1 ? "1 invoice" : `${rows.length} invoices`} on this page`
              : ""
        }
      />

      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <div className="clients-table docs-table inv-table">
          <DataTable
            caption={INV_COPY.title}
            columns={invoiceColumns(true)}
            rows={rows}
            rowKey={(r) => r.id}
            loading={loading}
            skeletonRows={5}
            empty={
              filtered ? (
                <EmptyState
                  icon={<Search />}
                  title={INV_PLACEHOLDER}
                  action={
                    <button type="button" className="btn btn--secondary" onClick={clear}>
                      Clear filters
                    </button>
                  }
                >
                  {null}
                </EmptyState>
              ) : (
                <EmptyState icon={<Receipt />} title={EMPTY[0]} action={canDraft ? newButton : undefined}>
                  <p>{EMPTY[1]}</p>
                </EmptyState>
              )
            }
          />
        </div>
      )}

      {list.state === "ready" && rows.length > 0 && (
        <Pager
          noun="invoices"
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
        <NewInvoiceDialog open={creating} clientId={client || undefined} onClose={() => setCreating(false)} />
      )}
    </>
  );
}
