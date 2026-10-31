// Start-up warm-up of the front Worker (M3.1, CPU tuning; split in M5.0): the step-up path (`/auth/step-up` measured up to 9 ms on staging):
// the AES-GCM engine and key import, the three HOTPs, the schemas of the account routes. Pure of `env` (made-up keys and values), nothing
// stored or logged; errors are swallowed inside the helper. The other warm-ups are in warm-api.ts and warm-finance.ts.
import { warmStepUp } from "@techaust/auth";

export const frontWarm: Promise<number> = warmStepUp();
