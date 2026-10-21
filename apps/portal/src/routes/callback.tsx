// `/auth/callback`: the page a sign-in link opens [POR-01, POR-02, LD3]. The token was taken from `#t=` and the
// fragment stripped before the app rendered (lib/link.ts). Nothing is sent until "Continue to the portal" is pressed;
// then exactly one POST. A missing token and a refused link (401) read the same, with a way to request a new one.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight } from "../components/icons.tsx";
import { Card, Notice, Reference } from "../components/ui.tsx";
import { COPY, waitText } from "../copy.ts";
import { type ContinueResult, capturedToken, createContinue, forgetToken } from "../lib/link.ts";

type View = "ready" | "busy" | Exclude<ContinueResult, { kind: "signed_in" }>;

export function Callback() {
  const navigate = useNavigate();
  const token = useMemo(() => capturedToken(), []);
  const press = useMemo(() => createContinue(token), [token]);
  const [view, setView] = useState<View>(token ? "ready" : { kind: "invalid" });
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pressed = useRef(false);
  const kind = typeof view === "object" ? view.kind : view;

  // After a press, the button is gone on these two outcomes: the heading takes focus, so the outcome is read next.
  useEffect(() => {
    if (pressed.current && (kind === "invalid" || kind === "rate_limited")) titleRef.current?.focus();
  }, [kind]);

  async function onContinue() {
    pressed.current = true;
    setView("busy");
    const r = await press();
    if (r.kind === "signed_in") {
      forgetToken();
      navigate("/", { replace: true });
      return;
    }
    setView(r);
  }

  if (typeof view === "object" && view.kind === "invalid") {
    return (
      <Card title={COPY.callback.invalidTitle} titleRef={titleRef} focusTitle={!token}>
        <p>{COPY.callback.invalidBody}</p>
        <Link to="/" className="btn btn--primary btn--block">
          {COPY.callback.requestNew}
        </Link>
      </Card>
    );
  }

  if (typeof view === "object" && view.kind === "rate_limited") {
    return (
      <Card title={COPY.callback.title} titleRef={titleRef}>
        <Notice tone="error">{COPY.callback.rateLimited(waitText(view.retryAfterS))}</Notice>
        <Link to="/" className="btn btn--secondary btn--block">
          {COPY.callback.requestNew}
        </Link>
      </Card>
    );
  }

  const busy = view === "busy";
  return (
    <Card title={COPY.callback.title} lede={COPY.callback.lede} titleRef={titleRef} focusTitle>
      {typeof view === "object" && view.kind === "network" && (
        <Notice tone="error">{COPY.callback.network}</Notice>
      )}
      {typeof view === "object" && view.kind === "error" && (
        <Notice tone="error" more={view.requestId ? <Reference id={view.requestId} /> : undefined}>
          {COPY.server}
        </Notice>
      )}
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={onContinue}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {busy ? (
          COPY.callback.busy
        ) : (
          <>
            {COPY.callback.submit}
            <ArrowRight size={20} />
          </>
        )}
      </button>
      <p className="hint hint--foot">{COPY.callback.why}</p>
    </Card>
  );
}
