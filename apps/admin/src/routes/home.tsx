// The signed-in landing card until the admin shell arrives (M3.1): who you are, your account, and (owners) staff.
import { can } from "@techaust/core/permissions";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api.ts";
import { ChevronRight, LogOut } from "../components/icons.tsx";
import { Card } from "../components/ui.tsx";
import { ROLE_LABELS } from "../lib/format.ts";
import { useSession, useUser } from "../session.tsx";

export function Home() {
  const user = useUser();
  const { signedOut } = useSession();
  const [busy, setBusy] = useState(false);

  function signOut() {
    setBusy(true);
    api.logout().then(
      () => signedOut("You've signed out."),
      () => signedOut("You've signed out."),
    );
  }

  return (
    <Card title={user.name} focusTitle>
      <div className="whoami">
        <p className="whoami__meta">
          <span>{user.email}</span>
          <span className="pill">{ROLE_LABELS[user.role]}</span>
        </p>
      </div>
      <nav aria-label="Admin">
        <ul className="nav-list">
          <li>
            <Link to="/account" className="nav-list__link">
              <span>
                <span className="nav-list__title">Your account</span>
                <span className="nav-list__desc">Where you're signed in, and your recovery codes</span>
              </span>
              <ChevronRight />
            </Link>
          </li>
          {can(user.role, "users.read") && (
            <li>
              <Link to="/users" className="nav-list__link">
                <span>
                  <span className="nav-list__title">Staff and invites</span>
                  <span className="nav-list__desc">Invite people, change roles, reset two-step sign-in</span>
                </span>
                <ChevronRight />
              </Link>
            </li>
          )}
        </ul>
      </nav>
      <p className="hint">The rest of the admin arrives in later milestones.</p>
      <button type="button" className="btn btn--secondary btn--block" onClick={signOut} disabled={busy}>
        <LogOut size={20} />
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </Card>
  );
}
