// CPU tuning 3: the first zod parse, the first HMAC and the first regexes of a sign-in request move into isolate start-up
// (shown in local workerd; confirmed on staging by the first `/magic`'s `cpuTimeMs`). Errors are swallowed inside.
// Imported by the Worker entry for its side effect; the promise is exported so a test proves the entry really runs it
// (kept out of the entry itself, where an extra named export could be read as an entrypoint).
import { warmPortalAuth } from "@techaust/auth";

export const portalWarm: Promise<number> = warmPortalAuth();
