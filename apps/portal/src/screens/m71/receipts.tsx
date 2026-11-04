// Receipts (M7.1; POR-07, L20; run file G.4): the organisation's receipts (M6.5: one for every confirmed payment, never a void one) and its issued credit
// notes, newest first, 50 a page, as a table from md up and a labelled card per row on phones: Number, Date, Amount, For, Download PDF. A receipt's PDF is
// M6.5's route, a credit note's the invoice family's; a credit note's invoice links to its page when the client may open it. Finance contacts only (the API
// answers the plain 404 otherwise; Researched 2026-10-28, 08-C RB-31). Words: copy-zp.ts C1, C11 (marked until approved), G1; 07-ZO's "Receipt".
import { PORTAL_RECEIPT_COPY } from "@techaust/core/copy-zo";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { invoicesApi, portalApi, type ReceiptItem, RequestError } from "../../api.ts";
import { RTable } from "../../components/document/rtable.tsx";
import { FileCheck } from "../../components/icons.tsx";
import { LoadProblemScreen } from "../../components/load-problem.tsx";
import { PageTitle } from "../../components/shell/portal-shell.tsx";
import { COPY } from "../../copy.ts";
import { INV } from "../../copy-invoices.ts";
import { ZP } from "../../copy-zp.ts";
import { formatMoneyOf, forText, plainProblem } from "../../lib/m71.ts";
import { dateText } from "../../lib/offers.ts";
import { useMe } from "../../session.tsx";
import { MoreButton, NotFoundScreen, ScreenSkeleton } from "../home.tsx";
import { invoiceHref } from "../invoices.tsx";
import { DownloadButton, type Downloads, EmptyLine, useDownloads } from "./shared.tsx";

const fileOf = (r: ReceiptItem) => `${(r.numberDisplay ?? "receipt").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;

/** `/receipts`. */
export function ReceiptsRoute() {
  const me = useMe();
  const [items, setItems] = useState<ReceiptItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [moreProblem, setMoreProblem] = useState<string | null>(null);
  const page = useCallback(async (after?: string) => {
    setBusy(true);
    setMoreProblem(null);
    try {
      const r = await portalApi.receipts(after);
      setItems((was) => (after && was ? [...was, ...r.items] : r.items));
      setNext(r.next);
      setError(null);
    } catch (e) {
      if (e instanceof RequestError && e.status === 401) return;
      if (after) setMoreProblem(plainProblem(e));
      else setError(e);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (me.canSeeFinance) page();
  }, [page, me.canSeeFinance]);
  if (!me.canSeeFinance) return <NotFoundScreen homeHref="/" />;
  if (error && !items)
    return <LoadProblemScreen title={ZP.navReceipts} error={error} onRetry={() => page()} />;
  if (!items) return <ScreenSkeleton label={COPY.loading} />;
  return (
    <ReceiptsScreen
      items={items}
      more={
        next ? (
          <>
            <MoreButton onMore={() => page(next)} busy={busy} />
            {moreProblem && (
              <p className="m71-more-problem" role="status">
                {moreProblem}
              </p>
            )}
          </>
        ) : null
      }
    />
  );
}

export function ReceiptsScreen(props: { items: ReceiptItem[]; more?: ReactNode }) {
  const downloads = useDownloads();
  return (
    <div className="screen inv-sheet">
      <header className="screen__head">
        <PageTitle text={ZP.navReceipts} className="screen__title">
          {ZP.navReceipts}
        </PageTitle>
      </header>
      {props.items.length === 0 ? (
        <EmptyLine icon={<FileCheck size={24} />}>{ZP.receiptsListEmpty}</EmptyLine>
      ) : (
        <ReceiptsTable items={props.items} downloads={downloads} />
      )}
      {props.more}
    </div>
  );
}

function ReceiptsTable(props: { items: ReceiptItem[]; downloads: Downloads }) {
  const { downloads } = props;
  return (
    <RTable
      caption={ZP.receiptsList}
      showCaption
      className="m71-receipts"
      rowKey={(r) => r.id}
      rows={props.items}
      columns={[
        {
          key: "number",
          label: ZP.colNumber,
          lead: true,
          cell: (r) => (
            <span className="m71-receipts__num">
              <span className="docno">{r.numberDisplay ?? "–"}</span>
              <span className="m71-receipts__kind">
                {r.kind === "receipt" ? PORTAL_RECEIPT_COPY.receiptLink : INV.types.credit_note}
              </span>
            </span>
          ),
        },
        {
          key: "date",
          label: ZP.colDate,
          cell: (r) => <span className="nowrap">{dateText(r.issueDate)}</span>,
        },
        {
          key: "amount",
          label: ZP.colAmount,
          num: true,
          cell: (r) => <span className="nowrap">{formatMoneyOf(r.amountMinor, r.currency)}</span>,
        },
        {
          key: "for",
          label: ZP.colFor,
          cell: (r) =>
            r.kind === "credit_note" && r.for.invoiceId && r.for.numbers[0] ? (
              <Link to={invoiceHref(r.for.invoiceId)} className="docno">
                {r.for.numbers[0]}
              </Link>
            ) : (
              <span className="m71-receipts__for">{forText(r.for)}</span>
            ),
        },
        {
          key: "pdf",
          label: <span className="visually-hidden">{ZP.downloadPdf}</span>,
          cell: (r) => (
            <DownloadButton
              id={r.id}
              label={ZP.downloadPdf}
              what={r.numberDisplay ?? ""}
              downloads={downloads}
              onPress={() =>
                downloads.run(
                  r.id,
                  () => (r.kind === "receipt" ? invoicesApi.receiptPdf(r.id) : invoicesApi.pdf(r.id)),
                  fileOf(r),
                  COPY.server,
                )
              }
            />
          ),
        },
      ]}
    />
  );
}
