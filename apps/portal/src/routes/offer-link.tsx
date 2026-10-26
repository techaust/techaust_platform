// A proposal or estimate opened from its email link, without signing in (POR-06; owner decision 2026-10-25: the link may accept and
// decline). Only that document is shown, with an offer to sign in for the rest; no sections, no account. The token was taken from the
// address before the app rendered (lib/offers.ts) and goes in each request's body. A bad, revoked or ended link is the plain
// "Page not found" (the API answers one 404 for all of them). VERIFY WITH CA/LEGAL: whoever holds the link acts as its contact.
import { useMemo } from "react";
import { Link } from "react-router";
import { offerLinkApi } from "../api.ts";
import { LogIn } from "../components/icons.tsx";
import { TokenShell } from "../components/shell/portal-shell.tsx";
import { N } from "../copy-documents.ts";
import { capturedOfferToken } from "../lib/offers.ts";
import { NotFoundScreen } from "../screens/home.tsx";
import { OfferScreen, type OfferSource } from "./offer.tsx";

export function OfferLinkRoute() {
  const token = capturedOfferToken();
  const source = useMemo<OfferSource | null>(
    () =>
      token
        ? {
            load: () => offerLinkApi.open(token),
            accept: (docId, name) => offerLinkApi.accept(token, docId, name),
            decline: (docId, reason, note) => offerLinkApi.decline(token, docId, reason, note),
            pdf: (docId) => offerLinkApi.pdf(token, docId),
            certificate: (docId) => offerLinkApi.certificate(token, docId),
          }
        : null,
    [token],
  );
  return (
    <TokenShell>
      {source ? (
        <OfferScreen
          source={source}
          loadKey="link"
          backHref={null}
          homeHref="/"
          me={null}
          replaced={false}
          // A link always opens the newest version of its offer: a version sent while the page was open reloads in place.
          onSuperseded={() => false}
          notices={
            <div className="notice notice--info notice--action" role="note">
              <LogIn size={20} />
              <div>
                <p>{N.token}</p>
                <Link to="/" className="btn btn--secondary">
                  {N.signIn}
                </Link>
              </div>
            </div>
          }
        />
      ) : (
        <NotFoundScreen homeHref="/" />
      )}
    </TokenShell>
  );
}
