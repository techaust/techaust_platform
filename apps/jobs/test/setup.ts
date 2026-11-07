import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterAll, afterEach, vi } from "vitest";
import { budgetHooks, invocation } from "../../../packages/testing/src/budget.ts";

// Each test file gets a fresh, isolated D1; apply every migration first (idempotent).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// M7.5 L18: the shared counting env. Every queue batch (`handleQueue`), cron run (`scheduled`) and request (`fetch`) the tests drive is one invocation;
// a batch over 45 statements or more than 45 D1 calls plus subrequests in one invocation fails the test, and the file's SQL gets the EXPLAIN sweep.
// The entry points are wrapped here (module mocks from a setup file apply to every test file), so no test changes how it calls them.
const kindOf = (body: unknown): string => {
  if (typeof body !== "object" || body === null) return "other";
  const k = Reflect.get(body, "kind") ?? Reflect.get(body, "template");
  return typeof k === "string" && /^[a-z0-9._-]{1,40}$/.test(k) ? k : "other";
};
const queueLabel = (batch: MessageBatch<unknown>) =>
  `queue ${batch.queue.replace(/^techaust-(local|staging)-/, "")} ${kindOf(batch.messages[0]?.body)}`;

vi.mock("../src/queue.ts", async (importOriginal) => {
  const m = await importOriginal<typeof import("../src/queue.ts")>();
  return {
    ...m,
    handleQueue: (batch: MessageBatch<unknown>, e: Env) =>
      invocation(queueLabel(batch), () => m.handleQueue(batch, e)),
  };
});
vi.mock("../src/index.ts", async (importOriginal) => {
  const m = await importOriginal<typeof import("../src/index.ts")>();
  const w = m.default;
  return {
    ...m,
    default: {
      ...w,
      fetch: (req: Request, e: Env, ctx: ExecutionContext) =>
        invocation(`${req.method} ${new URL(req.url).pathname}`, () => w.fetch(req, e, ctx)),
      scheduled: (c: ScheduledController, e: Env, ctx: ExecutionContext) =>
        invocation(`scheduled ${c.cron}`, () => w.scheduled(c, e, ctx)),
      queue: (batch: MessageBatch<unknown>, e: Env) => invocation(queueLabel(batch), () => w.queue(batch, e)),
    },
  };
});

budgetHooks({ env, afterEach, afterAll });
