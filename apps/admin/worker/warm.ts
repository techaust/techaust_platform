// Start-up warm-up of the admin Worker (M3.1, CPU tuning). Run from the module's top level, the first-use costs are paid while
// the isolate starts, not inside the first request the Free plan's 10 ms CPU limit applies to:
//  - the settings schemas, each parsed once on its defaults (the first Settings request builds nothing);
//  - the step-up path (`/auth/step-up` measured up to 9 ms on staging): the AES-GCM engine and key import, the three HOTPs, the
//    schemas of the account routes;
//  - the care-plan and time-log schemas (M3.5), each parsed once on a sample (a zod/mini schema compiles on its first parse).
// Pure of `env` (made-up keys and values), nothing stored or logged; errors are swallowed inside the helpers.
import { warmStepUp } from "@techaust/auth";
import { warmSettings } from "@techaust/core/settings";
import { warmCare } from "./care.ts";
import { warmTime } from "./time-logs.ts";

export const adminWarm: Promise<number> = (async () =>
  warmSettings() + warmCare() + warmTime() + (await warmStepUp()))();
