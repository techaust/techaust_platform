// CPU tuning 3: the first zod parse, the first HMAC and the first regexes of a sign-in request move into isolate start-up
// (shown in local workerd; confirmed on staging by the first `/magic`'s `cpuTimeMs`). Errors are swallowed inside.
// Imported by the Worker entry for its side effect; the promise is exported so a test proves the entry really runs it
// (kept out of the entry itself, where an extra named export could be read as an entrypoint).
//
// M4.5: the offer routes' body schemas and the typed-name check are sampled too, so the first accept does not pay for their first parse.
import { warmPortalAuth } from "@techaust/auth";
import { checkDecline, normaliseTypedName } from "@techaust/core/offers";
import {
  acceptRequest,
  declineRequest,
  linkAcceptRequest,
  linkDeclineRequest,
  linkDocRequest,
  linkRequest,
} from "./offer-schemas.ts";

/** One sample parse of each offer body, and one typed name and one decline reason. Never throws. */
export function warmOffers(): void {
  try {
    acceptRequest.safeParse({ typedName: "Warm Up", agree: true });
    declineRequest.safeParse({ reason: "price" });
    linkRequest.safeParse({ token: "warm-up" });
    linkDocRequest.safeParse({ token: "warm-up", documentId: "warm-up" });
    linkAcceptRequest.safeParse({
      token: "warm-up",
      documentId: "warm-up",
      typedName: "Warm Up",
      agree: true,
    });
    linkDeclineRequest.safeParse({ token: "warm-up", documentId: "warm-up", reason: "other", note: "warm" });
    normaliseTypedName("Warm Up");
    checkDecline("other", "warm");
  } catch {
    // a failed warm-up never blocks start-up
  }
}

warmOffers();
export const portalWarm: Promise<number> = warmPortalAuth();
