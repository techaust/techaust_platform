// The signed-in portal (M4.5; POR-02 to POR-05): the shell around five sections, home, the proposals-and-estimates list and one
// document. Everything a screen shows comes from the API with the session's organisation (POR-03); another organisation's document
// is the same "Page not found" as one that doesn't exist. Signed out, every address shows the sign-in form.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import { api, type OfferItem, offersApi, RequestError } from "../api.ts";
import { SignedDeedCard } from "../components/document/signed-deed.tsx";
import { LoadProblemScreen } from "../components/load-problem.tsx";
import { type NavKey, PortalShell } from "../components/shell/portal-shell.tsx";
import { LoadingCard } from "../components/ui.tsx";
import { COPY } from "../copy.ts";
import { WORDS } from "../copy-documents.ts";
import { splitOffers } from "../lib/offers.ts";
import {
  DocumentsScreen,
  HomeScreen,
  MoreButton,
  NotFoundScreen,
  ScreenSkeleton,
  SoonScreen,
} from "../screens/home.tsx";
import { InvoicesTile } from "../screens/invoices.tsx";
import { useMe, useSession } from "../session.tsx";
import { useInvoices } from "./invoices.tsx";
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

/** 07-ZA item 12 (owner 2026-10-30): a contact who can't see finance gets no Invoices link (it only led to "Page not found"). */
const NO_FINANCE: readonly NavKey[] = ["invoices"];

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
    <PortalShell
      current={currentOf(pathname)}
      hrefOf={hrefOf}
      hidden={me.canSeeFinance ? undefined : NO_FINANCE}
      account={account}
    >
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

export function HomeRoute() {
  const me = useMe();
  const o = useOffers();
  // M5.4: the invoices tile, for a contact who can see finance (the API answers 404 otherwise)
  const inv = useInvoices(me.canSeeFinance);
  if (o.error && !o.items)
    return <LoadProblemScreen title={me.organisation.displayName} error={o.error} onRetry={o.retry} />;
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
      invoicesTile={
        me.canSeeFinance ? (
          <InvoicesTile items={inv.items} problem={inv.items ? null : inv.problem} />
        ) : undefined
      }
    />
  );
}

export function ProposalsRoute() {
  const o = useOffers();
  if (o.error && !o.items)
    return <LoadProblemScreen title={WORDS.nav.documents} error={o.error} onRetry={o.retry} />;
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
      asideExtra={signedDeedOf}
    />
  );
}

/** T11: the signed deed under an accepted version's summary (signed in only: the emailed link never shows it). */
const signedDeedOf = (documentId: string, accepted: boolean) =>
  accepted ? <SignedDeedCard key={documentId} documentId={documentId} /> : null;

export function SoonRoute({ section }: { section: "projects" | "profile" }) {
  return <SoonScreen section={section} />;
}

export function MissingRoute() {
  return <NotFoundScreen homeHref={HREF.home} />;
}
