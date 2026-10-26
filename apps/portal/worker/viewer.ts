// The default `OfferViewer` (M4.5): the client's view of a stored proposal or estimate is the PDF package's own projection,
// `toPdfView(parseEnvelope(text))`, so the page and the PDF cannot disagree. The portal imports only `@techaust/pdf/view` (never the package
// root: the fonts are forbidden in the portal bundle; scripts/worker-budget.mjs proves it). Tests may inject their own viewer through
// `createApp({ viewer })`.
//
// Only the view leaves the Worker: the stored copy also holds the catalogue rate and id, the staff id, the hidden sections and the lines'
// internal fields, and none of them is in `PdfView`. A stored copy that cannot be read throws, and the route answers 500 (a stored copy that
// fails its shape is a bug to see, not a page to show).
import { parseEnvelope, toPdfView } from "@techaust/pdf/view";
import type { OfferViewer } from "./offer-core.ts";

export const defaultViewer: OfferViewer = (snapshotText) => {
  const envelope = parseEnvelope(snapshotText);
  if (envelope === null) throw new Error("offer snapshot is not readable");
  return toPdfView(envelope, undefined, { longDates: true }); // four-digit years on screen (the PDF keeps the short form)
};
