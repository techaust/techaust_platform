// The signed deed of assignment on its accepted proposal or estimate's page (T11; POR-05; run file docs/runs/t11-deed.md, L4, L5; 08-C RB-38(a)): a second card
// in the summary column, under the document's own, once TecHaust has signed the deed: the deed number, "Signed with Aadhaar eSign on …", the transaction ID
// and the download. The server lists signed deeds only, so a draft, final or cancelled deed never shows; while the list loads, or if it can't be read, the
// card simply isn't there (the document page works without it). The mark at its top left is the brand's 45° cut. Words: 07-ZJ lines 3 to 7.
// Owner's decision (2026-11-01, review M4): finance contacts only, like invoices; the page passes no card to anyone else (the API answers them a 404 too).
import { useEffect, useState } from "react";
import { deedsApi, type SignedDeed } from "../../api.ts";
import { DEED_ZJ } from "../../copy-zj.ts";
import { localDateTime } from "../../lib/local-time.ts";
import { saveDownload } from "../../lib/offers.ts";
import { Alert, Download } from "../icons.tsx";

export function SignedDeedCard({ documentId }: { documentId: string }) {
  const [deed, setDeed] = useState<SignedDeed | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setDeed(null);
    deedsApi.list(documentId).then(
      (r) => {
        if (alive) setDeed(r.deeds.find((d) => d.sourceDocumentId === documentId) ?? null);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [documentId]);

  if (!deed) return null;

  async function download(d: SignedDeed) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      saveDownload(await deedsApi.pdf(d.id), `${d.number.replaceAll("/", "-")}-signed.pdf`);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="deedcard" aria-labelledby="deedcard-h">
      <h2 id="deedcard-h" className="deedcard__title">
        <span className="deedcard__mark" aria-hidden="true" />
        {DEED_ZJ.heading}
      </h2>
      <p className="deedcard__lead">{DEED_ZJ.lead}</p>
      <dl className="deedcard__facts">
        <div>
          <dt className="deedcard__label">{DEED_ZJ.number}</dt>
          <dd className="deedcard__value nowrap">{deed.number}</dd>
        </div>
        <div>
          <dt className="visually-hidden">{DEED_ZJ.heading}</dt>
          <dd className="deedcard__value deedcard__value--plain">
            {DEED_ZJ.signedOn(localDateTime(deed.esignAt))}
          </dd>
        </div>
        <div>
          <dt className="deedcard__label">{DEED_ZJ.txn}</dt>
          <dd className="deedcard__value deedcard__txn">{deed.esignTxn}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="btn btn--secondary btn--block"
        onClick={() => download(deed)}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        <Download size={20} />
        {DEED_ZJ.download}
      </button>
      {failed && (
        <div className="notice notice--error deedcard__alert" role="alert">
          <Alert size={20} />
          <div>{DEED_ZJ.failed}</div>
        </div>
      )}
    </section>
  );
}
