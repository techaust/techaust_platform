// The default `OfferViewer` (M4.5). Stage A: the projection of the stored snapshot is the PDF package's `toPdfView(parseEnvelope(text))`, which
// the portal may import only through `@techaust/pdf/view` (never the package root: the fonts are forbidden in the portal bundle). That
// subpath and the portal's dependency on the package arrive with M4.4 phase 2, so until stage B this refuses loudly instead of guessing.
// Tests inject their own viewer through `createApp({ viewer })`.
import type { OfferViewer } from "./offer-core.ts";

export const defaultViewer: OfferViewer = () => {
  throw new Error("offer viewer is not wired (stage B: @techaust/pdf/view)");
};
