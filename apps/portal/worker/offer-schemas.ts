// Request bodies of the offer routes (M4.5). Strict objects (zod/mini): a field that is not listed is a 400, so `contactId`, `email`, `ip`,
// `pdfSha256`, `clientId`, `acceptedAt` and `status` cannot be sent at all. `agree` must be the literal `true`. The token fields only bound
// the size: a token of the wrong shape is a FAILED CHECK (counted like a wrong one), never a 400 that tells a guesser anything.
// Built at module top level and sampled in warm.ts, so the first request does not pay for them.
import * as z from "zod/mini";

const tokenField = z.string().check(z.maxLength(256));
const idField = z.string().check(z.minLength(1), z.maxLength(64));
/** Raw typed text: the real limits (2 to 120 characters, no control characters) are `normaliseTypedName`'s, so each has its own code. */
const typedName = z.string().check(z.maxLength(1000));
const reason = z.string().check(z.maxLength(40));
const note = z.optional(z.string().check(z.maxLength(2000)));

export const acceptRequest = z.strictObject({ typedName, agree: z.literal(true) });
export const declineRequest = z.strictObject({ reason, note });
export const linkRequest = z.strictObject({ token: tokenField });
export const linkDocRequest = z.strictObject({ token: tokenField, documentId: idField });
export const linkAcceptRequest = z.strictObject({
  token: tokenField,
  documentId: idField,
  typedName,
  agree: z.literal(true),
});
export const linkDeclineRequest = z.strictObject({ token: tokenField, documentId: idField, reason, note });

/** The list's query string: `limit` (1 to 50) and the cursor from the previous page. */
export const LIST_QUERY = { limit: /^\d{1,2}$/, after: /^\d{1,15}:[A-Za-z0-9-]{1,64}$/ } as const;
