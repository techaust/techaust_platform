// Who is signed in. Read once from GET /me; any signed-in call answered 401 clears it (the session ended), and the
// app shows the sign-in screen with a short note. A /me that can't reach the server shows "couldn't reach the
// portal" rather than the sign-in form (the person may well still be signed in).
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type Me, onUnauthenticated, RequestError } from "./api.ts";
import { COPY } from "./copy.ts";

type SessionState = {
  /** undefined while the first /me is in flight; null when signed out; "unreachable" when /me failed otherwise. */
  me: Me | null | undefined | "unreachable";
  /** Why the person is looking at the sign-in screen, when it isn't the first visit. */
  note: string | null;
  signedOut: (note?: string) => void;
};

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<SessionState["me"]>(undefined);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(
      (r) => setMe(r),
      (e: unknown) => setMe(e instanceof RequestError && e.status === 401 ? null : "unreachable"),
    );
  }, []);

  const signedOut = useCallback((n?: string) => {
    setNote(n ?? null);
    setMe(null);
  }, []);

  useEffect(
    () =>
      onUnauthenticated(() => {
        setMe((was) => {
          if (was && was !== "unreachable") setNote(COPY.sessionEnded);
          return null;
        });
      }),
    [],
  );

  const value = useMemo(() => ({ me, note, signedOut }), [me, note, signedOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

/** The signed-in contact (only inside routes that render when signed in). */
export function useMe(): Me {
  const { me } = useSession();
  if (!me || me === "unreachable") throw new Error("useMe while signed out");
  return me;
}
