// The signed-in page until the portal shell arrives (M4.5) [POR-02, POR-03]: whose portal this is, who is signed in,
// and the two ways out. Everything shown comes from GET /me, which reads only the session's own contact and
// organisation. "Sign out of all devices" ends this contact's sessions for THIS organisation (the API scopes it to
// the contact at this client), so the confirm text names the organisation.
import { useState } from "react";
import { api, RequestError } from "../api.ts";
import { ConfirmDialog } from "../components/dialog.tsx";
import { LogOut } from "../components/icons.tsx";
import { Card, Notice } from "../components/ui.tsx";
import { COPY } from "../copy.ts";
import { useMe, useSession } from "../session.tsx";

export function Home() {
  const me = useMe();
  const { signedOut } = useSession();
  const org = me.organisation.displayName;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await api.logout();
      signedOut(COPY.signedOut);
    } catch (e) {
      // Sign-out answers 204 whatever the cookie, so only a network or server failure lands here: still signed in.
      setError(e instanceof RequestError && e.code !== "network" ? COPY.server : COPY.home.signOutFailed);
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    try {
      await api.revokeAll();
      signedOut(COPY.signedOutEverywhere);
    } catch (e) {
      // A 401 means the session had already ended: the session provider has moved to the sign-in screen.
      if (e instanceof RequestError && e.status === 401) return;
      throw new Error(e instanceof RequestError && e.code !== "network" ? COPY.server : COPY.network);
    }
  }

  return (
    <Card title={org} focusTitle>
      <div className="whoami">
        <p className="whoami__as">
          {COPY.home.signedInAs} <strong>{me.contact.name}</strong>
        </p>
        <p className="whoami__email">{me.contact.email}</p>
      </div>

      <section className="section" aria-labelledby="later-title">
        <h2 id="later-title">{COPY.home.laterTitle}</h2>
        <p className="muted">{COPY.home.later(org)}</p>
      </section>

      <section className="section section--last" aria-labelledby="session-title">
        <h2 id="session-title">{COPY.home.sessionTitle}</h2>
        {error && <Notice tone="error">{error}</Notice>}
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={signOut}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          <LogOut size={20} />
          {busy ? COPY.home.signingOut : COPY.home.signOut}
        </button>
        <div className="all-devices">
          <button
            type="button"
            className="btn btn--text"
            onClick={() => setConfirming(true)}
            disabled={busy}
            aria-describedby="all-devices-hint"
          >
            {COPY.home.allDevices}
          </button>
          <p className="hint" id="all-devices-hint">
            {COPY.home.allDevicesHint(org)}
          </p>
        </div>
      </section>

      <ConfirmDialog
        open={confirming}
        title={COPY.home.confirmTitle}
        confirmLabel={COPY.home.confirm}
        busyLabel={COPY.home.signingOut}
        onConfirm={signOutEverywhere}
        onClose={() => setConfirming(false)}
      >
        <p>{COPY.home.confirmBody(org)}</p>
      </ConfirmDialog>
    </Card>
  );
}
