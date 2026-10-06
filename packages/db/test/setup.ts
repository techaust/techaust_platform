import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Each test file gets a fresh, isolated D1; apply every migration first (idempotent).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
