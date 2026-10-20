// Who is signed in. Read once from GET /auth/me; any signed-in call answered 401 clears it (the session ended),
// and the app shows the sign-in screen with a short note.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, onUnauthenticated, type User } from "./api.ts";

type SessionState = {
  /** undefined while the first /me is in flight; null when signed out. */
  user: User | null | undefined;
  /** Why the person is looking at the sign-in screen, when it isn't the first visit. */
  endedNote: string | null;
  signedIn: (u: User) => void;
  signedOut: (note?: string) => void;
};

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [endedNote, setEndedNote] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(
      (r) => setUser(r.user),
      () => setUser(null),
    );
  }, []);

  const signedOut = useCallback((note?: string) => {
    setEndedNote(note ?? null);
    setUser(null);
  }, []);
  const signedIn = useCallback((u: User) => {
    setEndedNote(null);
    setUser(u);
  }, []);

  useEffect(
    () =>
      onUnauthenticated(() => {
        setUser((was) => {
          if (was) setEndedNote("Your session has ended. Sign in again to carry on.");
          return null;
        });
      }),
    [],
  );

  const value = useMemo(
    () => ({ user, endedNote, signedIn, signedOut }),
    [user, endedNote, signedIn, signedOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

/** The signed-in member (only inside routes that render when signed in). */
export function useUser(): User {
  const { user } = useSession();
  if (!user) throw new Error("useUser while signed out");
  return user;
}
