// The signed-in portal (M4.5; POR-02 to POR-05): the shell around five sections, home, the proposals-and-estimates list and one
// document. Everything a screen shows comes from the API with the session's organisation (POR-03); another organisation's document
// is the same "Page not found" as one that doesn't exist. Signed out, every address shows the sign-in form.
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import { api, type OfferItem, offersApi, RequestError } from "../api.ts";
import { type NavKey, PortalShell } from "../components/shell/portal-shell.tsx";
import { LoadingCard, Notice } from "../components/ui.tsx";
import { COPY } from "../copy.ts";
import { splitOffers } from "../lib/offers.ts";
import {
  DocumentsScreen,
  HomeScreen,
  MoreButton,
  NotFoundScreen,
  ScreenSkeleton,
  SoonScreen,
} from "../screens/home.tsx";
import { useMe, useSession } from "../session.tsx";
import { Unreachable } from "./not-found.tsx";
import { OfferScreen, type OfferSource } from "./offer.tsx";
import { SignIn } from "./sign-in.tsx";

export const HREF: Record<NavKey, string> = {
  home: "/",
  documents: "/proposals",
  invoices: "/invoices",
  projects: "/projects",
  profile: "/profile",
};
const hrefOf = (k: NavKey) => HREF[k];
export const offerHref = (id: string) => `/proposals/${encodeURIComponent(id)}`;

function currentOf(pathname: string): NavKey | null {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/proposals")) return "documents";
  if (pathname.startsWith("/invoices")) return "invoices";
  if (pathname.startsWith("/projects")) return "projects";
  if (pathname.startsWith("/profile")) return "profile";
  return null;
}

/** The frame: signed out, the sign-in form at any address; signed in, the shell and the section. */
export function PortalLayout() {
  const { me } = useSession();
  if (me === undefined) return <LoadingCard />;
  if (me === "unreachable") return <Unreachable />;
  if (!me) return <SignIn />;
  return <SignedIn />;
}

function SignedIn() {
  const me = useMe();
  const { signedOut } = useSession();
  const { pathname } = useLocation();
  const account = {
    org: me.organisation.displayName,
    contact: me.contact,
    onSignOut: async () => {
      try {
        await api.logout();
        signedOut(COPY.signedOut);
      } catch (e) {
        // Sign-out answers 204 whatever the cookie, so only a network or server failure lands here: still signed in.
        throw new Error(
          e instanceof RequestError && e.code !== "network" ? COPY.server : COPY.home.signOutFailed,
        );
      }
    },
    onSignOutAll: async () => {
      try {
        await api.revokeAll();
        signedOut(COPY.signedOutEverywhere);
      } catch (e) {
        // A 401 means the session had already ended: the session provider has moved to the sign-in screen.
        if (e instanceof RequestError && e.status === 401) return;
        throw new Error(e instanceof RequestError && e.code !== "network" ? COPY.server : COPY.network);
      }
    },
  };
  return (
    <PortalShell current={currentOf(pathname)} hrefOf={hrefOf} account={account}>
      <Outlet />
    </PortalShell>
  );
}

/** The organisation's offers, page by page (50 a page, newest sent first). */
function useOffers() {
  const [items, setItems] = useState<OfferItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const page = useCallback(async (after?: string) => {
    setBusy(true);
    try {
      const r = await offersApi.list(after);
      setItems((was) => (after && was ? [...was, ...r.offers] : r.offers));
      setNext(r.next);
      setError(null);
    } catch (e) {
      if (!(e instanceof RequestError && e.status === 401)) setError(e);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    page();
  }, [page]);
  return { items, next, error, busy, more: () => next && page(next), retry: () => page() };
}

function LoadProblem(props: { error: unknown; onRetry: () => void; children?: ReactNode }) {
  const text =
    props.error instanceof RequestError && props.error.code !== "network" ? COPY.server : COPY.network;
  return (
    <div className="screen">
      {props.children}
      <Notice tone="error">{text}</Notice>
      <button type="button" className="btn btn--secondary" onClick={props.onRetry}>
        {COPY.reload}
      </button>
    </div>
  );
}

export function HomeRoute() {
  const me = useMe();
  const o = useOffers();
  if (o.error && !o.items) return <LoadProblem error={o.error} onRetry={o.retry} />;
  if (!o.items) return <ScreenSkeleton label={COPY.loading} />;
  const { awaiting, decided } = splitOffers(o.items);
  return (
    <HomeScreen
      org={me.organisation.displayName}
      contactName={me.contact.name}
      awaiting={awaiting}
      hasDecided={decided.length > 0 || o.next !== null}
      hrefOf={(d) => offerHref(d.id)}
      listHref={HREF.documents}
    />
  );
}

export function ProposalsRoute() {
  const o = useOffers();
  if (o.error && !o.items) return <LoadProblem error={o.error} onRetry={o.retry} />;
  if (!o.items) return <ScreenSkeleton label={COPY.loading} />;
  const { awaiting, decided } = splitOffers(o.items);
  return (
    <DocumentsScreen
      awaiting={awaiting}
      decided={decided}
      hrefOf={(d) => offerHref(d.id)}
      more={o.next ? <MoreButton onMore={() => o.more()} busy={o.busy} /> : null}
    />
  );
}

export function ProposalRoute() {
  const me = useMe();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const replaced = (location.state as { replaced?: boolean } | null)?.replaced === true;
  const source = useMemo<OfferSource>(
    () => ({
      load: () => offersApi.get(id),
      accept: (docId, name) => offersApi.accept(docId, name),
      decline: (docId, reason, note) => offersApi.decline(docId, reason, note),
      pdf: (docId) => offersApi.pdf(docId),
      certificate: (docId) => offersApi.certificate(docId),
    }),
    [id],
  );
  // An older version's address shows the latest instead, with the "newer version" notice (07-N §2).
  const onSuperseded = useCallback(
    (latestId: string) => {
      navigate(offerHref(latestId), { replace: true, state: { replaced: true } });
      return true;
    },
    [navigate],
  );
  return (
    <OfferScreen
      source={source}
      loadKey={id}
      backHref={HREF.documents}
      homeHref={HREF.home}
      me={me.contact}
      replaced={replaced}
      onSuperseded={onSuperseded}
    />
  );
}

export function SoonRoute({ section }: { section: "invoices" | "projects" | "profile" }) {
  return <SoonScreen section={section} />;
}

export function MissingRoute() {
  return <NotFoundScreen homeHref={HREF.home} />;
}
