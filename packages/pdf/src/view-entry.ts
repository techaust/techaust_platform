// The `@techaust/pdf/view` entry: what the portal Worker may import (M4.5). The projection of a stored envelope for the client, and nothing
// else: no fonts, no HTML templates, no hashing, no `@techaust/core` root import (scripts/worker-budget.mjs keeps the fonts out).
export { parseEnvelope } from "./parse-envelope.ts";
export type { Envelope, PdfView, ViewConfig } from "./types.ts";
export { DEFAULT_VIEW_CONFIG, toPdfView } from "./view.ts";
