// One invoice (M5.1): `/invoices/:id`, the address in the bells and the lists. A draft opens in the editor for a role that drafts invoices (the
// owner, Staff); an issued or voided invoice, or a draft for a reader (the accountant), opens as the invoice.
import { useParams } from "react-router";
import { RequestError } from "../../api.ts";
import { PageHeader, Skeleton } from "../../components/display.tsx";
import { LoadFailed, NotFound, useLoad } from "../../components/states.tsx";
import { allowed } from "../../lib/access.ts";
import { INV_COPY } from "../../lib/invoices.ts";
import { invoicesApi } from "../../lib/invoices-api.ts";
import { useUser } from "../../session.tsx";
import { InvoiceEditor } from "./editor.tsx";
import { NoteDraft } from "./note-draft.tsx";
import { isNoteView } from "./notes-parts.tsx";
import { InvoicesGate } from "./parts.tsx";
import { InvoiceRead } from "./read.tsx";

export function Component() {
  const { id = "" } = useParams();
  return (
    <InvoicesGate>
      <InvoiceScreen key={id} id={id} />
    </InvoicesGate>
  );
}

function InvoiceScreen({ id }: { id: string }) {
  const user = useUser();
  const page = useLoad(() => invoicesApi.get(id), id);
  if (page.state === "failed") {
    if (page.error instanceof RequestError && page.error.status === 404) return <NotFound />;
    return (
      <>
        <PageHeader title={INV_COPY.title} />
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      </>
    );
  }
  if (page.state === "loading") return <InvoiceSkeleton />;
  const v = page.data;
  // M5.3: a credit or debit note's lines come from its invoice, so its draft has its own page (never the line editor).
  if (!v.frozen && isNoteView(v) && allowed(user.role, "invoices.draft") && !v.client.anonymised)
    return <NoteDraft key={v.updatedAt} view={v} role={user.role} reload={() => page.reload(true)} />;
  if (!v.frozen && allowed(user.role, "invoices.draft") && !v.client.anonymised)
    return <InvoiceEditor key={v.updatedAt} view={v} reload={() => page.reload(true)} />;
  return <InvoiceRead view={v} role={user.role} reload={() => page.reload(true)} />;
}

function InvoiceSkeleton() {
  return (
    <>
      <PageHeader title={INV_COPY.title} />
      <p className="visually-hidden" role="status">
        Loading…
      </p>
      <div className="client-strip client-strip--skeleton" aria-hidden="true">
        <Skeleton width="60%" />
      </div>
      <div className="doc-page" aria-hidden="true">
        <div className="doc-page__send">
          <div className="lead-panel stack-sm">
            <Skeleton width="40%" />
            <Skeleton width="80%" />
            <Skeleton width="70%" />
          </div>
        </div>
        <div className="doc-page__main">
          <div className="lead-panel stack-sm">
            <Skeleton width="30%" />
            <Skeleton width="90%" />
          </div>
          <div className="lead-panel stack-sm">
            <Skeleton width="25%" />
            <Skeleton width="90%" />
            <Skeleton width="90%" />
            <Skeleton width="80%" />
          </div>
        </div>
      </div>
    </>
  );
}
