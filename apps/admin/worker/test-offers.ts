// Test support for the M4.5 admin routes in STAGE A, before they are in the route table or the app (stage B wires them): a small Hono app that
// resolves each route's table row from the list below, runs the REAL session guard on it (cookie, session, role: deny by default), and
// mounts the routers. Stage B deletes this and the tests call the real app.
import { answeringRow } from "@techaust/auth";
import { createMiddleware } from "hono/factory";
import { matchedRoutes } from "hono/route";
import { Hono } from "hono/tiny";
import type { AppEnv, RouteDef } from "./context.ts";
import { documentLinks } from "./document-links.ts";
import { documentStart } from "./document-start.ts";
import { guard } from "./guard.ts";
import { sendTo } from "./test-helpers.ts";

const row = (
  method: RouteDef["method"],
  path: string,
  access: RouteDef["access"],
  audit?: string,
): RouteDef => ({
  method,
  path: `/api/v1${path}`,
  access,
  ...(audit ? { audit } : {}),
});

export const STAGE_A_ROUTES: readonly RouteDef[] = [
  row("POST", "/documents/:id/start-project", "projects.write", "project.create"),
  row("POST", "/documents/:id/resend", "proposals.send", "document.resend"),
  row("POST", "/documents/:id/links/revoke", "proposals.send", "document.links_revoke"),
  row("GET", "/documents/:id/certificate", "proposals.read"),
];

const by = new Map(STAGE_A_ROUTES.map((r) => [`${r.method} ${r.path}`, r]));

export function stageAApp() {
  const app = new Hono<AppEnv>().basePath("/api");
  app.use(
    createMiddleware<AppEnv>(async (c, next) => {
      c.set("rid", "stage-a-test");
      c.set("ip", "203.0.113.7");
      c.set("ua", "stage-a-test");
      c.set("route", answeringRow(matchedRoutes(c), (p) => by.get(`${c.req.method} ${p}`)) ?? null);
      await next();
    }),
  );
  app.use(guard);
  app.route("/v1/documents", documentStart);
  app.route("/v1/documents", documentLinks);
  return app;
}

export const stageA = stageAApp();

/** A request into the stage A app, as the SPA would send it. */
export const callA = (
  path: string,
  init: { body?: unknown; cookie?: string; method?: string } = {},
  e?: Env,
) =>
  sendTo(
    stageA,
    `https://admin.example/api/v1${path}`,
    {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        Origin: "https://admin.example",
        ...(init.cookie ? { Cookie: init.cookie } : {}),
      },
      body: init.body === undefined ? null : JSON.stringify(init.body),
    },
    e,
  );
