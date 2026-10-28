// A proposal or estimate opened from its email link, without signing in (POR-06; owner decision 2026-10-25: the link may accept and
// decline). Only that document is shown, with an offer to sign in for the rest; no sections, no account. The token was taken from the
// address before the app rendered (lib/offers.ts) and goes in each request's body. A bad, revoked, expired or ended link (the API answers
// one 404 for all of them) says the link no longer works, with the way to sign in: the pattern of the invoice link (07-U §3), with its own
// line for offers (07-X §5.1, sweep finding 7). Researched 2026-10-28 (08-C RB-19; owner: link acceptance for any value): whoever holds the
// link acts as its contact.
import { useMemo } from "react";
import { Link } from "react-router";
import { offerLinkApi } from "../api.ts";
import { LogIn } from "../components/icons.tsx";
import { PageTitle, TokenShell } from "../components/shell/portal-shell.tsx";
import { N, OFFER_LINK, WORDS } from "../copy-documents.ts";
import { capturedOfferToken } from "../lib/offers.ts";
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
          missing={<OfferLinkEnded />}
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
        <OfferLinkEnded />
      )}
    </TokenShell>
  );
}

/** The link has ended (expired, revoked, the contact's access off, or never valid): what to do instead, as the invoice link says it. */
function OfferLinkEnded() {
  return (
    <div className="screen screen--narrow">
      <header className="screen__head">
        <PageTitle text={WORDS.nav.documents} className="screen__title">
          {WORDS.nav.documents}
        </PageTitle>
      </header>
      <p>{OFFER_LINK.ended}</p>
      <Link to="/" className="btn btn--secondary">
        <LogIn size={20} />
        {N.signIn}
      </Link>
    </div>
  );
}
