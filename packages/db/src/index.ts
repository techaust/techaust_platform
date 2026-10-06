// @techaust/db: Drizzle schema, SQL migrations (incl. triggers) and seed data for D1 (docs/05 §5).
// Repositories arrive with the features that use them.
export * from "./client.ts";
export * as schema from "./schema/index.ts";
export { SEED_VERSION, seedSql, seedStatements } from "./seed/index.ts";
