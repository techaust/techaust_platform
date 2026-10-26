// One proposal or estimate (M4.3): `/proposals/:id`, `/estimates/:id`, and `/documents/:id` (the address in the bell and in search, which
// moves to the type's own address once the document has loaded, so the rail shows the right section). A draft opens in the editor for a
// role that may change it; a sent version, or a draft for a reader, opens as the document.
import { Navigate, useLocation, useParams } from "react-router";
import { RequestError } from "../../api.ts";
import { PageHeader, Skeleton } from "../../components/display.tsx";
import { LoadFailed, NotFound, useLoad } from "../../components/states.tsx";
import { allowed } from "../../lib/access.ts";
import { DOC_COPY } from "../../lib/documents.ts";
import { type DocumentView, documentsApi } from "../../lib/documents-api.ts";
import { useUser } from "../../session.tsx";
import { DraftEditor } from "./editor.tsx";
import { DocsGate, docHref } from "./parts.tsx";
import { ReadView } from "./read.tsx";

// The view loaded at `/documents/:id`, handed to the type's own address so it is not read twice.
let handed: DocumentView | null = null;

export function Component() {
  const { id = "" } = useParams();
  return (
    <DocsGate>
      <DocumentScreen key={id} id={id} />
    </DocsGate>
  );
}

function DocumentScreen({ id }: { id: string }) {
  const user = useUser();
  const { pathname } = useLocation();
  const page = useLoad(() => {
    if (handed && handed.id === id) {
      const v = handed;
      handed = null;
      return Promise.resolve(v);
    }
    return documentsApi.get(id);
  }, id);
  if (page.state === "failed") {
    if (page.error instanceof RequestError && page.error.status === 404) return <NotFound />;
    return (
      <>
        <PageHeader title={DOC_COPY.listHeading} />
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      </>
    );
  }
  if (page.state === "loading") return <DocSkeleton />;
  const v = page.data;
  const want = docHref(v);
  if (pathname !== want) {
    handed = v;
    return <Navigate to={want} replace />;
  }
  if (!v.frozen && allowed(user.role, "proposals.draft"))
    return <DraftEditor key={v.updatedAt} view={v} reload={() => page.reload(true)} />;
  return <ReadView view={v} reload={() => page.reload(true)} />;
}

function DocSkeleton() {
  return (
    <>
      <PageHeader title={DOC_COPY.listHeading} />
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
