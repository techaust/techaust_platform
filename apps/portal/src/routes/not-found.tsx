// An address the portal doesn't have, and a screen that failed to load or crashed (e.g. its code changed with a new
// release): a calm way out, no stack trace.
import { Link } from "react-router";
import { Card } from "../components/ui.tsx";
import { COPY } from "../copy.ts";

export function NotFound() {
  return (
    <Card title={COPY.notFound.title} focusTitle>
      <p>{COPY.notFound.body}</p>
      <Link to="/" className="btn btn--secondary btn--block">
        {COPY.notFound.home}
      </Link>
    </Card>
  );
}

export function Failed() {
  return (
    <Card title={COPY.failed.title}>
      <p>{COPY.failed.body}</p>
      <button type="button" className="btn btn--primary btn--block" onClick={() => location.reload()}>
        {COPY.reload}
      </button>
    </Card>
  );
}

/** GET /me couldn't reach the server (or the server failed): not the sign-in form, the person may be signed in. */
export function Unreachable() {
  return (
    <Card title={COPY.unreachableTitle}>
      <p>{COPY.unreachableBody}</p>
      <button type="button" className="btn btn--primary btn--block" onClick={() => location.reload()}>
        {COPY.reload}
      </button>
    </Card>
  );
}
