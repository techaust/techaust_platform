// What the proposal and estimate screens share (M4.5; POR-04, POR-05, POR-06, ADM-PROP-08, ADM-PROP-10): the words of an API
// error, the split of the list, dates in IST, saving a downloaded PDF, and the offer link's token. Nothing here adds up money: every
// amount arrives formatted (`total`, `PdfView`), worked out on the server by @techaust/core.
import { formatDate, parseIsoDate } from "@techaust/core/dates";
import { type Download, type OfferItem, type OfferKind, RequestError } from "../api.ts";
import { COPY, waitText } from "../copy.ts";
import { N, PENDING, WORDS } from "../copy-documents.ts";
import { OFFER_Y } from "../copy-y.ts";

/** "06 Oct 2026" from `YYYY-MM-DD` (the text itself if it isn't a date). */
export function dateText(iso: string | null): string {
  if (!iso) return "";
  const d = parseIsoDate(iso);
  return d ? formatDate(d) : iso;
}

/** "proposal" or "estimate", for sentences. */
export const kindWord = (kind: OfferKind) => WORDS.kind[kind].toLowerCase();

/** The card's heading: the document's own title, else "Proposal TH/PRP/2627/0003". */
export const titleOf = (o: Pick<OfferItem, "kind" | "title" | "numberDisplay">) =>
  o.title?.trim() || `${WORDS.kind[o.kind]} ${o.numberDisplay ?? ""}`.trim();

/** Open (a decision is awaited, or a new version is on its way) and decided, in the API's order (newest sent first). */
export function splitOffers(items: readonly OfferItem[]) {
  const awaiting: OfferItem[] = [];
  const decided: OfferItem[] = [];
  for (const o of items) {
    if (o.status === "sent" || o.status === "viewed" || o.status === "revised") awaiting.push(o);
    else decided.push(o);
  }
  return { awaiting, decided };
}

/**
 * The refusals that end the decision: the page reloads to show what is true now, and says why (07-N §7). `newer_version_pending`
 * (FX-3, A4 9): a newer version is frozen but not rendered yet, so this one can't be decided; the reload shows it as replaced.
 */
export const FINAL: ReadonlySet<string> = new Set([
  "already_accepted",
  "already_decided",
  "superseded",
  "newer_version_pending",
  "expired",
]);

/** The 07-N words for an API error (§7), the name rules, a refused link, the network and the server. */
export function errorText(e: unknown): string {
  if (!(e instanceof RequestError) || e.code === "network") return COPY.network;
  const known =
    (N.errors as Record<string, string>)[e.code] ?? (OFFER_Y.errors as Record<string, string>)[e.code];
  if (known) return known;
  switch (e.code) {
    case "name_too_short":
      return N.nameMissing;
    case "name_too_long":
      return PENDING.nameTooLong;
    case "name_invalid_characters":
      return PENDING.nameInvalid;
    case "note_required":
      return N.otherMissing;
    case "reason_invalid":
      return N.reasonMissing;
  }
  if (e.status === 429) return PENDING.linkRateLimited(waitText(e.retryAfterS));
  if (e.status === 404) return WORDS.notFound.body;
  return COPY.server;
}

/** Hands a downloaded PDF to the browser as a file, under the server's name. */
export function saveDownload(d: Download, fallbackName: string) {
  const url = URL.createObjectURL(d.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = d.fileName ?? fallbackName;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  // The click has started the download; the object URL can go once the browser has read it.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** `TH/PRP/2627/0003` v2 → `TH-PRP-2627-0003-v2.pdf` (only used when the server sends no name). */
export const pdfName = (numberDisplay: string | null, version: number, suffix = "") =>
  `${(numberDisplay ?? "document").replaceAll("/", "-")}-v${version}${suffix}.pdf`;

// ---- The offer link (POR-06) -------------------------------------------------------------------------------------------------
// The email's link is `<portal>/o#t=<token>` (`offerLinkUrl` in @techaust/core/offers): the fragment never reaches a server or a log.
// It is read once before the app renders, then removed from the address bar and the history entry, so it can't be bookmarked or
// copied from the address bar by mistake. Unlike a sign-in link it works many times, so it is kept for this tab only
// (sessionStorage): a reload still works, closing the tab forgets it. It is sent only in a request BODY, never in an address.

export const OFFER_LINK_PATH = "/o";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KEY = "ta.offer-link";

type Loc = { pathname: string; search: string; hash: string };
type Hist = { replaceState: (data: unknown, unused: string, url?: string) => void };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Reads `#t=` on the link's path and strips the fragment; a token of the wrong shape is no token. */
export function takeOfferToken(loc: Loc, hist: Hist, store: Store | null): string | null {
  if (loc.pathname !== OFFER_LINK_PATH) return null;
  const { hash, pathname, search } = loc;
  if (hash) hist.replaceState(null, "", pathname + search);
  const t = new URLSearchParams(hash.replace(/^#/, "")).get("t");
  if (t && TOKEN.test(t)) {
    try {
      store?.setItem(KEY, t);
    } catch {
      // Storage refused (private mode): the token still works in memory for this page.
    }
    return t;
  }
  try {
    const kept = store?.getItem(KEY) ?? null;
    return kept && TOKEN.test(kept) ? kept : null;
  } catch {
    return null;
  }
}

let offerToken: string | null = null;

/** main.tsx calls this once, before the router is created. */
export function captureOfferToken(loc: Loc = location, hist: Hist = history) {
  let store: Store | null = null;
  try {
    store = window.sessionStorage;
  } catch {
    store = null;
  }
  offerToken = takeOfferToken(loc, hist, store);
}

export const capturedOfferToken = () => offerToken;
