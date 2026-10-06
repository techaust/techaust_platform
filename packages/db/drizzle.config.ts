import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only (docs/05 §5.5): it writes reviewed SQL into migrations/, which wrangler applies.
// `drizzle-kit push` is banned.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./migrations",
});
