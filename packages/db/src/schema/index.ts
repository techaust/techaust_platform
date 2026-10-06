// The D1 schema (docs/05 §5). Tables for payments, email and operations arrive with their milestones
// (M2.4 email, M6 ledger), as backward-compatible migrations.
export * from "./catalogue.ts";
export * from "./common.ts";
export * from "./compliance.ts";
export * from "./crm.ts";
export * from "./documents.ts";
export * from "./identity.ts";
export * from "./settings.ts";
