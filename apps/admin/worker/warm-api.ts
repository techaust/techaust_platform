// Start-up warm-up of the admin API Worker (M3.1, CPU tuning; split in M5.0). Run from the module's top level, the first-use costs are paid
// while the isolate starts, not inside the first request the Free plan's 10 ms CPU limit applies to:
//  - the settings schemas, each parsed once on its defaults (the first Settings request builds nothing);
//  - the catalogue schemas (M4.1): the entry, the edit, the snapshot and the template body;
//  - the proposal and estimate request schemas (M4.3): create, save, send, approval request, convert, list;
//  - the care-plan and time-log schemas (M3.5), each parsed once on a sample (a zod/mini schema compiles on its first parse).
// The step-up path is warmed in the front Worker (warm-front.ts); the invoice schemas and the approval decision in the finance Worker
// (warm-finance.ts, M6.1 stage A). Pure of `env`, nothing stored or logged.
import { warmCatalogue } from "@techaust/core/catalogue";
import { warmSettings } from "@techaust/core/settings";
import { warmCare } from "./care.ts";
import { warmDocuments } from "./document-warm.ts";
import { warmTime } from "./time-logs.ts";

export const apiWarm: number = warmSettings() + warmCatalogue() + warmCare() + warmDocuments() + warmTime();
