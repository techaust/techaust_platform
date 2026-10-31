// Deny by default [ADM-G-02], the guard [ADM-AUTH-01], audit and access logs [ADM-G-06, ADM-AUD-01, NFR-9], CSRF
// (docs/05 §7.1) and request IDs (LD7).
import { env } from "cloudflare:workers";
import { currentStep, ipKey, tokenHash, totpCode } from "@techaust/auth";
import { ACTIONS, decide, ROLES, SETTINGS_DEFAULTS, uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./guard.ts";
import app, { createApp } from "./test-app.ts";
import { mkLog, mkOpenProject, mkPlan, today } from "./test-care.ts";
import { entryBody, mkItem, putPaymentTerms, siteItems } from "./test-catalogue.ts";
import { insert, mkContact } from "./test-clients.ts";
import {
  accept,
  bodyOf,
  call,
  counting,
  countOf,
  enrol,
  extraSession,
  hash,
  invite,
  nextCode,
  ORIGIN,
  one,
  rows,
  sampleRequest,
  send,
  sendTo,
  sessionFor,
  tokenOfLink,
  userId,
} from "./test-helpers.ts";
import { mkProforma, putTax, todayIso } from "./test-invoice-types.ts";
import { issueBodyOf, issueInvoice, mkInvoice, mkInvoiceClient, putCompany } from "./test-invoices.ts";
import { issueCredit, mkIssuedInvoice, mkRegisteredClient, stampOf } from "./test-notes.ts";
import { paymentRow, putDoc, recordBody, recorded, tdsBody } from "./test-payments.ts";
import { mkFile, mkMilestone, mkNote, mkProject, PDF_BYTES, upload } from "./test-projects.ts";
import { discount, mkDraft, mkQuoteClient, mkService, mkTerms, sendBodyOf, sendDoc } from "./test-quotes.ts";
import { addDoc, mkReportClient } from "./test-reports.ts";

const newEmail = () => `rbac-${Math.random().toString(36).slice(2, 10)}@example.com`;
const PUBLIC = ROUTES.filter((r) => r.access === "public");
const GUARDED = ROUTES.filter((r) => r.access !== "public");

// ---------------------------------------------------------------------------------------------------------------
describe("every guarded route needs a session [ADM-AUTH-01]", () => {
  for (const route of GUARDED) {
    it(`${route.method} ${route.path}: no cookie, a junk cookie and a dead session are all 401`, async () => {
      const { path, init } = sampleRequest(route);
      const none = await call(path, init);
      expect(none.status).toBe(401);
      expect(await bodyOf(none)).toEqual({ error: { code: "unauthenticated", message: "Sign in" } });
      expect((await call(path, { ...init, cookie: "__Host-ta_admin=junk" })).status).toBe(401);
      const dead = await sessionFor("owner", { stepUp: true });
      await env.DB.prepare("UPDATE staff_sessions SET revoked_at = ? WHERE id = ?")
        .bind(Date.now(), dead.sessionId)
        .run();
      expect((await call(path, { ...init, cookie: dead.cookie })).status).toBe(401);
    });
  }

  it("the public routes are exactly the sign-in routes and the health check", () => {
    expect(PUBLIC.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      [
        "GET /api/v1/health",
        "POST /api/v1/auth/salt",
        "POST /api/v1/auth/login",
        "POST /api/v1/auth/totp",
        "POST /api/v1/auth/recovery",
        "POST /api/v1/auth/logout",
        "POST /api/v1/auth/invite/start",
        "POST /api/v1/auth/invite/finish",
        "POST /api/v1/auth/invite/totp",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("route coverage: deny by default [ADM-G-02]", () => {
  it("every registered route is in the route table, and every table row is a registered route", () => {
    // A route with validators registers once per handler, so compare the distinct method + path pairs.
    const registered = [
      ...new Set(app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`)),
    ].sort();
    const declared = ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(registered).toEqual(declared);
    expect(new Set(declared).size).toBe(declared.length); // no duplicates
  });

  it("every table row names a real action or 'public'", () => {
    for (const r of ROUTES)
      expect(r.access === "public" || (ACTIONS as string[]).includes(r.access), r.path).toBe(true);
  });

  for (const route of GUARDED) {
    for (const role of ROLES) {
      it(`${route.method} ${route.path} as ${role} follows decide(): ${route.access.toString()}`, async () => {
        const s = await sessionFor(role, { stepUp: true });
        const { path, init } = sampleRequest(route);
        const res = await call(path, { ...init, cookie: s.cookie });
        if (decide(role, route.access as never) === "deny") {
          expect(res.status).toBe(403);
          expect(await bodyOf(res)).toEqual({ error: { code: "forbidden", message: "You can't do that" } });
        } else {
          expect([401, 403]).not.toContain(res.status);
        }
      });
    }
  }

  it("a route that isn't in the table is 404 at runtime, even for the owner, and writes no access row", async () => {
    const extra = createApp(); // before its first request, so a route can still be added to it
    extra.get("/v1/_undeclared", (c) => c.json({ leaked: true }));
    const o = await sessionFor("owner", { stepUp: true });
    const before = await countOf("access_log");
    const res = await sendTo(
      extra,
      `${ORIGIN}/api/v1/_undeclared`,
      { headers: { Origin: ORIGIN, Cookie: o.cookie } },
      env,
    );
    expect(res.status).toBe(404);
    expect(await bodyOf(res)).toEqual({ error: { code: "not_found", message: "Not found" } });
    expect((await call("/no/such/route", { cookie: o.cookie })).status).toBe(404);
    expect(await countOf("access_log")).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("every successful mutation writes exactly one audit row [ADM-G-06, ADM-AUD-01]", () => {
  const IP = "203.0.113.55";
  const headers = (rid: string) => ({ "cf-ray": rid, "CF-Connecting-IP": IP, "User-Agent": "RbacTest/1.0" });
  const owner = () => sessionFor("owner", { stepUp: true });

  type Scenario = () => Promise<{
    res: Response;
    rid: string;
    actor: { id: string; role: string };
    /** When the route's audit action depends on the request (settings groups). */
    action?: string;
  }>;
  const run = async (
    s: { cookie: string; id: string; role: string },
    path: string,
    init: { method?: string; body?: unknown; raw?: Uint8Array },
    action?: string,
  ) => {
    const rid = `ray-${crypto.randomUUID()}`;
    const res = await call(path, { ...init, cookie: s.cookie, headers: headers(rid) });
    return { res, rid, actor: s, ...(action ? { action } : {}) };
  };
  const bell = async (userId: string) => {
    const id = uuidv7();
    await env.DB.prepare(
      "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link) VALUES (?1, ?2, 'lead.new', 'lead', ?1, 'New lead: A, B', '/leads/x')",
    )
      .bind(id, userId)
      .run();
    return id;
  };
  const scenarioLead = async () => {
    const id = uuidv7();
    const updatedAt = Date.now() - 1000;
    await env.DB.prepare(
      "INSERT INTO leads (id, ref, source, contact_name, contact_email, updated_at) VALUES (?1, ?2, 'manual', 'Test Person', 'scenario@example.com', ?3)",
    )
      .bind(id, `L-${id.slice(-5).toUpperCase()}`, updatedAt)
      .run();
    return { id, updatedAt };
  };
  /** A client with one primary contact, written straight to the database (M3.3). */
  const scenarioClient = async () => {
    const id = uuidv7();
    const contactId = uuidv7();
    const updatedAt = Date.now() - 1000;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency, updated_at) VALUES (?1, ?2, 'Scenario Co', 'Scenario', 'business', 'IN', 'unregistered', '19', 'INR', ?3)",
      ).bind(id, `CS-${id.slice(-6).toUpperCase()}`, updatedAt),
      env.DB.prepare(
        "INSERT INTO contacts (id, client_id, name, email, is_primary, updated_at) VALUES (?1, ?2, 'Scenario Person', ?3, 1, ?4)",
      ).bind(contactId, id, `scenario-${contactId.slice(-8)}@example.com`, updatedAt),
    ]);
    return { id, contactId, updatedAt };
  };
  // M3.4: projects, milestones, notes and files. Each fixture is written straight to the database with an old `updated_at`.
  const scenarioProject = async () => {
    const { id: clientId } = await scenarioClient();
    const p = await mkProject(clientId);
    return { clientId, projectId: p.id, updatedAt: p.updatedAt };
  };
  const projectScenarios: Record<string, Scenario> = {
    "POST /api/v1/projects": async () => {
      const s = await owner();
      const { id } = await scenarioClient();
      return run(s, "/projects", { body: { clientId: id, name: "Scenario project" } });
    },
    "PATCH /api/v1/projects/:id": async () => {
      const s = await owner();
      const p = await scenarioProject();
      return run(s, `/projects/${p.projectId}`, {
        method: "PATCH",
        body: { expectedUpdatedAt: p.updatedAt, name: "Renamed" },
      });
    },
    "POST /api/v1/projects/:id/status": async () => {
      const s = await owner();
      const p = await scenarioProject();
      return run(s, `/projects/${p.projectId}/status`, { body: { to: "active" } });
    },
    "POST /api/v1/projects/:id/milestones": async () => {
      const s = await owner();
      const p = await scenarioProject();
      return run(s, `/projects/${p.projectId}/milestones`, { body: { title: "First", amountMinor: 5000 } });
    },
    "POST /api/v1/projects/:id/milestones/order": async () => {
      const s = await owner();
      const p = await scenarioProject();
      const a = await mkMilestone(p.projectId, { position: 1 });
      const b = await mkMilestone(p.projectId, { position: 2 });
      return run(s, `/projects/${p.projectId}/milestones/order`, { body: { ids: [b.id, a.id] } });
    },
    "PATCH /api/v1/milestones/:id": async () => {
      const s = await owner();
      const p = await scenarioProject();
      const m = await mkMilestone(p.projectId);
      return run(s, `/milestones/${m.id}`, {
        method: "PATCH",
        body: { expectedUpdatedAt: m.updatedAt, title: "Retitled" },
      });
    },
    "POST /api/v1/milestones/:id/status": async () => {
      const s = await owner();
      const p = await scenarioProject();
      const m = await mkMilestone(p.projectId);
      return run(s, `/milestones/${m.id}/status`, { body: { to: "ready_to_bill" } });
    },
    "DELETE /api/v1/milestones/:id": async () => {
      const s = await owner();
      const p = await scenarioProject();
      const m = await mkMilestone(p.projectId);
      return run(s, `/milestones/${m.id}`, { method: "DELETE" });
    },
    "POST /api/v1/projects/:id/notes": async () => {
      const s = await owner();
      const p = await scenarioProject();
      return run(s, `/projects/${p.projectId}/notes`, { body: { bodyMd: "A note" } });
    },
    "POST /api/v1/clients/:id/notes": async () => {
      const s = await owner();
      const { id } = await scenarioClient();
      return run(s, `/clients/${id}/notes`, { body: { bodyMd: "A client note", visibility: "shared" } });
    },
    "PATCH /api/v1/notes/:id": async () => {
      const s = await owner();
      const { id: clientId } = await scenarioClient();
      const n = await mkNote(clientId);
      return run(s, `/notes/${n.id}`, {
        method: "PATCH",
        body: { expectedUpdatedAt: n.updatedAt, bodyMd: "Edited" },
      });
    },
    "DELETE /api/v1/notes/:id": async () => {
      const s = await owner();
      const { id: clientId } = await scenarioClient();
      const n = await mkNote(clientId);
      return run(s, `/notes/${n.id}`, { method: "DELETE" });
    },
    "POST /api/v1/projects/:id/files": async () => {
      const s = await owner();
      const p = await scenarioProject();
      const rid = `ray-${crypto.randomUUID()}`;
      const res = await upload(`/projects/${p.projectId}/files`, PDF_BYTES, {
        cookie: s.cookie,
        headers: headers(rid),
      });
      return { res, rid, actor: s };
    },
    "POST /api/v1/clients/:id/files": async () => {
      const s = await owner();
      const { id } = await scenarioClient();
      const rid = `ray-${crypto.randomUUID()}`;
      const res = await upload(`/clients/${id}/files`, PDF_BYTES, {
        cookie: s.cookie,
        headers: headers(rid),
      });
      return { res, rid, actor: s };
    },
    "PATCH /api/v1/files/:id": async () => {
      const s = await owner();
      const { id: clientId } = await scenarioClient();
      const f = await mkFile(clientId);
      return run(s, `/files/${f.id}`, { method: "PATCH", body: { shared: true } });
    },
    "DELETE /api/v1/files/:id": async () => {
      const s = await owner();
      const { id: clientId } = await scenarioClient();
      const f = await mkFile(clientId);
      return run(s, `/files/${f.id}`, { method: "DELETE" });
    },
  };
  // M3.5: care plans and time logs. Fixtures are written straight to the database with an old `updated_at`.
  const careTimeScenarios: Record<string, Scenario> = {
    "POST /api/v1/care-plans": async () => {
      const s = await owner();
      const { id } = await scenarioClient();
      return run(s, "/care-plans", {
        body: {
          clientId: id,
          tier: "growth",
          priceMinor: 2_499_900,
          includedMinutes: 600,
          rollover: "none",
          startDate: "2026-01-01",
          billingDay: 1,
        },
      });
    },
    "POST /api/v1/care-plans/:id/terms": async () => {
      const s = await owner();
      const plan = await mkPlan(s.id);
      return run(s, `/care-plans/${plan.id}/terms`, {
        body: { expectedUpdatedAt: plan.updatedAt, priceMinor: 3_000_000 },
      });
    },
    "POST /api/v1/care-plans/:id/status": async () => {
      const s = await owner();
      const plan = await mkPlan(s.id);
      return run(s, `/care-plans/${plan.id}/status`, {
        body: { to: "paused", expectedUpdatedAt: plan.updatedAt },
      });
    },
    "POST /api/v1/time": async () => {
      const s = await owner();
      const p = await mkOpenProject();
      return run(s, "/time", { body: { workDate: today(), minutes: 60, projectId: p.id, billable: true } });
    },
    "PATCH /api/v1/time/:id": async () => {
      const s = await owner();
      const p = await mkOpenProject();
      const e = await mkLog(s.id, today(), 60, { project: p.id });
      return run(s, `/time/${e.id}`, {
        method: "PATCH",
        body: { expectedUpdatedAt: e.updatedAt, minutes: 90 },
      });
    },
    "DELETE /api/v1/time/:id": async () => {
      const s = await owner();
      const p = await mkOpenProject();
      const e = await mkLog(s.id, today(), 60, { project: p.id });
      return run(s, `/time/${e.id}?expectedUpdatedAt=${e.updatedAt}`, { method: "DELETE" });
    },
  };
  const scenarios: Record<string, Scenario> = {
    ...projectScenarios,
    ...careTimeScenarios,
    "POST /api/v1/auth/step-up": async () => {
      const s = await sessionFor("owner");
      const rid = `ray-${crypto.randomUUID()}`;
      const { code } = await nextCode(s);
      return {
        res: await call("/auth/step-up", { body: { code }, cookie: s.cookie, headers: headers(rid) }),
        rid,
        actor: s,
      };
    },
    "DELETE /api/v1/auth/sessions/:id": async () => {
      const s = await owner();
      const other = await extraSession(s);
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/auth/sessions/${other.sessionId}`, {
          method: "DELETE",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/auth/sessions/revoke-all": async () => {
      const s = await owner();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call("/auth/sessions/revoke-all", {
          method: "POST",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/auth/recovery/regenerate": async () => {
      const s = await owner();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call("/auth/recovery/regenerate", {
          method: "POST",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/auth/logout": async () => {
      const s = await sessionFor("sales");
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call("/auth/logout", { method: "POST", cookie: s.cookie, headers: headers(rid) }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/users/invites": async () => {
      const s = await owner();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call("/users/invites", {
          body: { email: newEmail(), role: "staff" },
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/users/invites/:tokenHash/revoke": async () => {
      const s = await owner();
      const made = await call("/users/invites", {
        body: { email: newEmail(), role: "staff" },
        cookie: s.cookie,
      });
      const { link } = (await made.json()) as { link: string };
      const hash = await tokenHash(tokenOfLink(link));
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/users/invites/${hash}/revoke`, {
          method: "POST",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/leads/:id/convert": async () => {
      const s = await sessionFor("sales");
      const leadId = uuidv7();
      await env.DB.prepare(
        "INSERT INTO leads (id, ref, source, contact_name, contact_email) VALUES (?1, ?2, 'manual', 'Test Person', 'convert-scenario@example.com')",
      )
        .bind(leadId, `L-${leadId.slice(-5).toUpperCase()}`)
        .run();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/leads/${leadId}/convert`, {
          method: "POST",
          body: {
            type: "business",
            country: "IN",
            gstStatus: "unregistered",
            stateCode: "19",
            currency: "INR",
          },
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/clients": async () => {
      const s = await sessionFor("sales");
      return run(s, "/clients", {
        body: {
          legalName: "Scenario Traders",
          type: "business",
          country: "IN",
          gstStatus: "unregistered",
          stateCode: "19",
          currency: "INR",
        },
      });
    },
    "PATCH /api/v1/clients/:id": async () => {
      const s = await sessionFor("sales");
      const { id, updatedAt } = await scenarioClient();
      return run(s, `/clients/${id}`, {
        method: "PATCH",
        body: { expectedUpdatedAt: updatedAt, notes: "Prefers email" },
      });
    },
    "PATCH /api/v1/clients/:id/billing": async () => {
      const s = await sessionFor("staff");
      const { id, updatedAt } = await scenarioClient();
      return run(s, `/clients/${id}/billing`, {
        method: "PATCH",
        body: { expectedUpdatedAt: updatedAt, paymentTermsDays: 15 },
      });
    },
    "POST /api/v1/clients/:id/contacts": async () => {
      const s = await sessionFor("sales");
      const { id } = await scenarioClient();
      return run(s, `/clients/${id}/contacts`, {
        body: { name: "Second Person", email: `second-${crypto.randomUUID().slice(0, 8)}@example.com` },
      });
    },
    "PATCH /api/v1/contacts/:id": async () => {
      const s = await sessionFor("sales");
      const { contactId, updatedAt } = await scenarioClient();
      return run(s, `/contacts/${contactId}`, {
        method: "PATCH",
        body: { expectedUpdatedAt: updatedAt, title: "Finance lead" },
      });
    },
    "POST /api/v1/contacts/:id/export": async () => {
      const s = await owner();
      const { contactId } = await scenarioClient();
      return run(s, `/contacts/${contactId}/export`, { body: {} });
    },
    "POST /api/v1/contacts/:id/erase": async () => {
      const s = await owner();
      const { contactId } = await scenarioClient();
      return run(s, `/contacts/${contactId}/erase`, { body: { mode: "erase", reason: "requested" } });
    },
    "POST /api/v1/leads": async () => {
      const s = await sessionFor("staff");
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call("/leads", {
          body: { name: "Pat Person", email: `pat-${rid}@example.com` },
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "PATCH /api/v1/leads/:id": async () => {
      const s = await sessionFor("sales");
      const { id, updatedAt } = await scenarioLead();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/leads/${id}`, {
          method: "PATCH",
          body: { expectedUpdatedAt: updatedAt, nextActionNote: "Call on Monday" },
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/leads/:id/notes": async () => {
      const s = await sessionFor("staff");
      const { id } = await scenarioLead();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/leads/${id}/notes`, {
          body: { body: "Spoke to them" },
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/leads/:id/stage": async () => {
      const s = await sessionFor("sales");
      const { id } = await scenarioLead();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/leads/${id}/stage`, {
          body: { stage: "qualified" },
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/leads/:id/reply": async () => {
      const s = await sessionFor("owner");
      const { id } = await scenarioLead();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/leads/${id}/reply`, {
          body: { subject: "Re: your enquiry", body: "Thanks, we will be in touch." },
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/users/sessions/revoke-all": async () => {
      const s = await owner();
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call("/users/sessions/revoke-all", {
          method: "POST",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "PATCH /api/v1/users/:id": async () => {
      const s = await owner();
      const t = await sessionFor("staff");
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/users/${t.id}`, {
          method: "PATCH",
          body: { role: "sales" },
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/users/:id/deactivate": async () => {
      const s = await owner();
      const t = await sessionFor("staff");
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/users/${t.id}/deactivate`, {
          method: "POST",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/users/:id/reset-2fa": async () => {
      const s = await owner();
      const t = await sessionFor("staff");
      const rid = `ray-${crypto.randomUUID()}`;
      return {
        res: await call(`/users/${t.id}/reset-2fa`, {
          method: "POST",
          cookie: s.cookie,
          headers: headers(rid),
        }),
        rid,
        actor: s,
      };
    },
    "POST /api/v1/users/:id/reactivate": async () => {
      const s = await owner();
      const t = await sessionFor("staff");
      await env.DB.prepare("UPDATE staff_users SET status = 'deactivated' WHERE id = ?").bind(t.id).run();
      return run(s, `/users/${t.id}/reactivate`, { method: "POST" });
    },
    "PUT /api/v1/settings/groups/:group": async () => {
      const s = await owner();
      return run(
        s,
        "/settings/groups/flags",
        { method: "PUT", body: { version: 0, value: { ...SETTINGS_DEFAULTS.flags, weeklyDigest: false } } },
        "settings.flags.update",
      );
    },
    "PUT /api/v1/settings/gateways": async () => {
      const s = await owner();
      const live = { ...SETTINGS_DEFAULTS.gateways, razorpay: { mode: "live" } };
      await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, version) VALUES ('gateways', ?, 1)")
        .bind(JSON.stringify(live))
        .run();
      return run(s, "/settings/gateways", {
        method: "PUT",
        body: { version: 1, value: SETTINGS_DEFAULTS.gateways },
      });
    },
    "PUT /api/v1/settings/bank/:kind": async () => {
      const s = await owner();
      return run(s, "/settings/bank/INR", {
        method: "PUT",
        body: {
          accountName: "Sample Account (test)",
          accountNo: "000123456789",
          accountNoAgain: "000123456789",
          ifsc: "SMPL0000001",
          bankName: "Sample Bank",
        },
      });
    },
    "POST /api/v1/settings/terms/:block": async () => {
      const s = await owner();
      return run(s, "/settings/terms/standard_terms", {
        method: "POST",
        body: { body: "Sample terms text." },
      });
    },
    // Catalogue (M4.1): one scenario for each audited route.
    "POST /api/v1/catalogue": async () => {
      const s = await owner();
      return run(s, "/catalogue", { method: "POST", body: entryBody() });
    },
    "PATCH /api/v1/catalogue/:id": async () => {
      const s = await owner();
      const item = await mkItem();
      return run(s, `/catalogue/${item.id}`, {
        method: "PATCH",
        body: { expectedUpdatedAt: item.updatedAt, priceInrMinor: 123_400 },
      });
    },
    "POST /api/v1/catalogue/:id/active": async () => {
      const s = await owner();
      const item = await mkItem({ active: 0 });
      return run(s, `/catalogue/${item.id}/active`, { method: "POST", body: { active: true } });
    },
    "POST /api/v1/catalogue/publish": async () => {
      const s = await owner();
      await putPaymentTerms();
      // The services the website needs (publishing refuses a snapshot without them).
      await siteItems();
      return run(s, "/catalogue/publish", { method: "POST" });
    },
    "POST /api/v1/templates": async () => {
      const s = await owner();
      return run(s, "/templates", {
        method: "POST",
        body: {
          kind: "proposal",
          category: "run",
          body: { sections: [{ key: "scope", heading: "Scope", body: "{{service.short}}" }] },
        },
      });
    },
    "POST /api/v1/settings/email/test-send": async () => {
      const s = await owner();
      return run(s, "/settings/email/test-send", { method: "POST", body: { template: "lead.alert" } });
    },
    "GET /api/v1/audit/export": async () => {
      const s = await owner();
      return run(s, "/audit/export?limit=25", {});
    },
    "POST /api/v1/notifications/read-all": async () => {
      const s = await sessionFor("sales");
      await bell(s.id);
      return run(s, "/notifications/read-all", { method: "POST" });
    },
    // Proposals, estimates and approvals (M4.3): one scenario for each audited route.
    "POST /api/v1/documents": async () => {
      const s = await owner();
      const client = await mkQuoteClient();
      const item = await mkService();
      await mkTerms();
      return run(s, "/documents", {
        body: { type: "proposal", clientId: client.clientId, services: [{ catalogueItemId: item.id }] },
      });
    },
    "PATCH /api/v1/documents/:id": async () => {
      const s = await owner();
      await mkTerms();
      const made = await mkDraft(s);
      return run(s, `/documents/${made.id}`, {
        method: "PATCH",
        body: { expectedUpdatedAt: made.updatedAt, fields: { title: "Scenario title" } },
      });
    },
    "POST /api/v1/documents/:id/sections/fill-from-catalogue": async () => {
      const s = await owner();
      await mkTerms();
      // a template with a Deliverables section, a service with no text yet (the section is created hidden), then Catalogue gets the text
      await insert("templates", {
        id: uuidv7(),
        kind: "proposal",
        category: "build",
        version: 9_000,
        body: JSON.stringify({
          sections: [{ key: "deliverables", heading: "Deliverables", body: "{{service.deliverables}}" }],
        }),
      });
      const made = await mkDraft(s);
      await env.DB.prepare("UPDATE catalogue_items SET deliverables_md = 'Scenario text' WHERE id = ?")
        .bind(made.itemId)
        .run();
      const sec = await one<{ id: string }>(
        "SELECT id FROM document_sections WHERE document_id = ? AND kind = 'deliverables'",
        made.id,
      );
      return run(s, `/documents/${made.id}/sections/fill-from-catalogue`, {
        method: "POST",
        body: { sectionId: sec?.id, expectedUpdatedAt: made.updatedAt },
      });
    },
    "DELETE /api/v1/documents/:id": async () => {
      const s = await owner();
      await mkTerms();
      const made = await mkDraft(s);
      return run(s, `/documents/${made.id}?expectedUpdatedAt=${made.updatedAt}`, { method: "DELETE" });
    },
    "POST /api/v1/documents/:id/revise": async () => {
      const s = await owner();
      await mkTerms();
      const made = await mkDraft(s);
      expect((await sendDoc(s, made.id, made.updatedAt)).status).toBe(200);
      return run(s, `/documents/${made.id}/revise`, { method: "POST", body: {} });
    },
    "POST /api/v1/documents/:id/approval-request": async () => {
      const s = await sessionFor("sales");
      await mkTerms();
      const made = await mkDraft(s, { price: 20_000_000 });
      const v = await discount(s, made.id, "fixed", 5_000_000);
      return run(s, `/documents/${made.id}/approval-request`, {
        method: "POST",
        body: { expectedUpdatedAt: v.updatedAt },
      });
    },
    "POST /api/v1/documents/:id/send": async () => {
      const s = await owner();
      await mkTerms();
      const made = await mkDraft(s);
      return run(s, `/documents/${made.id}/send`, {
        method: "POST",
        body: await sendBodyOf(made.id, made.updatedAt),
      });
    },
    // The PDF (M4.4): a retry of a sent version, and the signature image (a small PNG header; the type is read from the bytes).
    "POST /api/v1/documents/:id/pdf/retry": async () => {
      const s = await owner();
      await mkTerms();
      const made = await mkDraft(s);
      expect((await sendDoc(s, made.id, made.updatedAt)).status).toBe(200);
      return run(s, `/documents/${made.id}/pdf/retry`, { method: "POST", body: {} });
    },
    "PUT /api/v1/settings/signature": async () => {
      const s = await owner();
      const png = new Uint8Array(33);
      png.set([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0,
        0, 64,
      ]);
      return run(s, "/settings/signature", { method: "PUT", raw: png });
    },
    "DELETE /api/v1/settings/signature": async () => {
      const s = await owner();
      const png = new Uint8Array(33);
      png.set([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0,
        0, 64,
      ]);
      expect((await call("/settings/signature", { method: "PUT", cookie: s.cookie, raw: png })).status).toBe(
        200,
      );
      return run(s, "/settings/signature", { method: "DELETE" });
    },
    "POST /api/v1/documents/:id/convert": async () => {
      const s = await owner();
      await mkTerms();
      const made = await mkDraft(s, { type: "estimate" });
      expect((await sendDoc(s, made.id, made.updatedAt)).status).toBe(200);
      await env.DB.prepare("UPDATE documents SET status = 'accepted' WHERE id = ?").bind(made.id).run();
      return run(s, `/documents/${made.id}/convert`, { method: "POST", body: { to: "invoice" } });
    },
    // Offers to the client (M4.5): send again, end every link, and start the project of an accepted proposal.
    "POST /api/v1/documents/:id/resend": async () => {
      const s = await owner();
      await mkTerms();
      const made = await mkDraft(s);
      expect((await sendDoc(s, made.id, made.updatedAt)).status).toBe(200);
      const other = await mkContact(made.clientId, { portal_access: 1 });
      return run(s, `/documents/${made.id}/resend`, { method: "POST", body: { contactIds: [other.id] } });
    },
    "POST /api/v1/documents/:id/links/revoke": async () => {
      const s = await owner();
      await mkTerms();
      const made = await mkDraft(s);
      expect((await sendDoc(s, made.id, made.updatedAt)).status).toBe(200);
      // A live link to end (a revoke that changes nothing writes no audit row): one for the recipient the send wrote.
      await env.DB.prepare(
        `INSERT INTO offer_links (token_hash, send_id, document_id, version_group_id, client_id, contact_id, email, purpose, expires_at)
         SELECT 'scenario-' || s.id, s.id, s.document_id, s.version_group_id, s.client_id, s.contact_id, s.email, 'offer', ?2
         FROM document_sends s WHERE s.document_id = ?1`,
      )
        .bind(made.id, Date.now() + 86_400_000)
        .run();
      return run(s, `/documents/${made.id}/links/revoke`, { method: "POST", body: {} });
    },
    "POST /api/v1/documents/:id/start-project": async () => {
      const s = await owner();
      await mkTerms();
      const made = await mkDraft(s);
      expect((await sendDoc(s, made.id, made.updatedAt)).status).toBe(200);
      await env.DB.prepare("UPDATE documents SET status = 'accepted' WHERE id = ?").bind(made.id).run();
      return run(s, `/documents/${made.id}/start-project`, { method: "POST", body: {} });
    },
    "POST /api/v1/approvals/:id/decide": async () => {
      const s = await owner();
      const sales = await sessionFor("sales");
      await mkTerms();
      const made = await mkDraft(sales, { price: 20_000_000 });
      const v = await discount(sales, made.id, "fixed", 5_000_000);
      const req = await call(`/documents/${made.id}/approval-request`, {
        cookie: sales.cookie,
        body: { expectedUpdatedAt: v.updatedAt },
      });
      const { id } = (await req.json()) as { id: string };
      return run(s, `/approvals/${id}/decide`, { method: "POST", body: { decision: "approve" } });
    },
    "POST /api/v1/notifications/:id/read": async () => {
      const s = await sessionFor("staff");
      const id = await bell(s.id);
      return run(s, `/notifications/${id}/read`, { method: "POST" });
    },
    // Invoices (M5.1): one scenario per audited invoice route.
    "POST /api/v1/invoices": async () => {
      const s = await owner();
      const c = await mkInvoiceClient();
      return run(s, "/invoices", { body: { clientId: c.clientId } });
    },
    "PATCH /api/v1/invoices/:id": async () => {
      const s = await owner();
      const made = await mkInvoice(s);
      return run(s, `/invoices/${made.id}`, {
        method: "PATCH",
        body: { expectedUpdatedAt: made.updatedAt, fields: { discount: { kind: "fixed", value: 100 } } },
      });
    },
    "DELETE /api/v1/invoices/:id": async () => {
      const s = await owner();
      const made = await mkInvoice(s);
      return run(s, `/invoices/${made.id}?expectedUpdatedAt=${made.updatedAt}`, { method: "DELETE" });
    },
    "POST /api/v1/invoices/:id/issue": async () => {
      const s = await owner();
      await putCompany();
      const made = await mkInvoice(s);
      return run(s, `/invoices/${made.id}/issue`, { method: "POST", body: await issueBodyOf(made.id) });
    },
    "POST /api/v1/invoices/:id/issue-request": async () => {
      const s = await sessionFor("staff");
      await putCompany();
      const made = await mkInvoice(s);
      return run(s, `/invoices/${made.id}/issue-request`, {
        method: "POST",
        body: { expectedUpdatedAt: made.updatedAt },
      });
    },
    "POST /api/v1/invoices/:id/void": async () => {
      const s = await owner();
      await putCompany();
      const made = await mkInvoice(s);
      expect((await issueInvoice(s, made.id)).status).toBe(200);
      const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", made.id);
      return run(s, `/invoices/${made.id}/void`, {
        method: "POST",
        body: { expectedUpdatedAt: row?.updated_at, reason: "Issued in error" },
      });
    },
    // ADM-INV-10 (added on purpose): withdrawing a proforma the client has opened.
    "POST /api/v1/invoices/:id/withdraw": async () => {
      const s = await owner();
      await putCompany();
      const pf = await mkProforma(s);
      expect((await issueInvoice(s, pf.id)).status).toBe(200);
      await env.DB.prepare("UPDATE documents SET viewed_at = ?2 WHERE id = ?1").bind(pf.id, Date.now()).run();
      const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", pf.id);
      return run(s, `/invoices/${pf.id}/withdraw`, {
        method: "POST",
        body: { expectedUpdatedAt: row?.updated_at, reason: "Sent in error" },
      });
    },
    // M5.2 (added on purpose): the two new audited routes.
    "POST /api/v1/invoices/:id/service-completed": async () => {
      const s = await owner();
      await putCompany();
      const made = await mkInvoice(s);
      expect((await issueInvoice(s, made.id)).status).toBe(200);
      const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", made.id);
      return run(s, `/invoices/${made.id}/service-completed`, {
        method: "POST",
        body: { expectedUpdatedAt: row?.updated_at, date: todayIso() },
      });
    },
    "POST /api/v1/invoices/:id/advance-invoice": async () => {
      const s = await owner();
      await putCompany();
      const pf = await mkProforma(s);
      expect((await issueInvoice(s, pf.id)).status).toBe(200);
      const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", pf.id);
      return run(s, `/invoices/${pf.id}/advance-invoice`, {
        method: "POST",
        body: {
          expectedProformaUpdatedAt: row?.updated_at,
          amountMinor: 59_000,
          receivedOn: todayIso(),
          reference: "RBAC-UTR-1",
        },
      });
    },
    // M5.3 (added on purpose): the two note drafts and the IMS answer.
    "POST /api/v1/invoices/:id/credit-note": async () => {
      const s = await owner();
      await putCompany();
      const inv = await mkIssuedInvoice(s, { prices: [100_000] });
      return run(s, `/invoices/${inv.id}/credit-note`, {
        method: "POST",
        body: {
          expectedParentUpdatedAt: (await stampOf(inv.id)).updated_at,
          mode: "full",
          reasonCode: "price_correction",
        },
      });
    },
    "POST /api/v1/invoices/:id/debit-note": async () => {
      const s = await owner();
      await putCompany();
      const inv = await mkIssuedInvoice(s, { prices: [100_000] });
      return run(s, `/invoices/${inv.id}/debit-note`, {
        method: "POST",
        body: {
          expectedParentUpdatedAt: (await stampOf(inv.id)).updated_at,
          lines: [{ line: 0, taxableMinor: 1_000 }],
          reasonCode: "price_correction",
        },
      });
    },
    "POST /api/v1/invoices/:id/ims-status": async () => {
      const s = await owner();
      await putCompany();
      const inv = await mkIssuedInvoice(s, { prices: [100_000], client: mkRegisteredClient });
      const cn = await issueCredit(s, inv.id, { mode: "full" });
      const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", cn.id);
      return run(s, `/invoices/${cn.id}/ims-status`, {
        method: "POST",
        body: { expectedUpdatedAt: row?.updated_at, status: "accepted" },
      });
    },
    "POST /api/v1/invoices/:id/pdf/retry": async () => {
      const s = await owner();
      await putCompany();
      const made = await mkInvoice(s);
      expect((await issueInvoice(s, made.id)).status).toBe(200);
      return run(s, `/invoices/${made.id}/pdf/retry`, { method: "POST", body: {} });
    },
    // M5.4 (added on purpose): the send, the revoke of its links and the pause and resume of its reminders.
    "POST /api/v1/invoices/:id/send": async () => {
      const s = await owner();
      await putCompany();
      const made = await mkInvoice(s);
      expect((await issueInvoice(s, made.id)).status).toBe(200);
      const to = await mkContact(made.clientId, { portal_access: 1, can_see_finance: 1 });
      return run(s, `/invoices/${made.id}/send`, { method: "POST", body: { contactIds: [to.id] } });
    },
    "POST /api/v1/invoices/:id/links/revoke": async () => {
      const s = await owner();
      await putCompany();
      const made = await mkInvoice(s);
      expect((await issueInvoice(s, made.id)).status).toBe(200);
      return run(s, `/invoices/${made.id}/links/revoke`, { method: "POST", body: {} });
    },
    "POST /api/v1/invoices/:id/reminders/pause": async () => {
      const s = await owner();
      await putCompany();
      const made = await mkInvoice(s);
      expect((await issueInvoice(s, made.id)).status).toBe(200);
      const to = await mkContact(made.clientId, { portal_access: 1, can_see_finance: 1 });
      expect(
        (await call(`/invoices/${made.id}/send`, { cookie: s.cookie, body: { contactIds: [to.id] } })).status,
      ).toBe(200);
      return run(s, `/invoices/${made.id}/reminders/pause`, { method: "POST", body: {} });
    },
    "POST /api/v1/invoices/:id/reminders/resume": async () => {
      const s = await owner();
      await putCompany();
      const made = await mkInvoice(s);
      expect((await issueInvoice(s, made.id)).status).toBe(200);
      const to = await mkContact(made.clientId, { portal_access: 1, can_see_finance: 1 });
      expect(
        (await call(`/invoices/${made.id}/send`, { cookie: s.cookie, body: { contactIds: [to.id] } })).status,
      ).toBe(200);
      return run(s, `/invoices/${made.id}/reminders/resume`, { method: "POST", body: {} });
    },
    // M5.5b (added on purpose): a register page (one audit row per page) and a request for a statement PDF.
    "GET /api/v1/reports/registers": async () => {
      const s = await owner();
      await putCompany();
      await putTax();
      return run(s, "/reports/registers?from=2026-10-01&to=2026-10-31", {});
    },
    "POST /api/v1/clients/:id/statement/pdf": async () => {
      const s = await owner();
      await putCompany();
      const clientId = await mkReportClient();
      await addDoc({ clientId, issueDate: "2026-10-05" });
      return run(s, `/clients/${clientId}/statement/pdf`, { body: { from: "2026-10-01", to: "2026-10-31" } });
    },
    // M6.1 (added on purpose): the payment routes.
    "POST /api/v1/payments": async () => {
      const s = await owner();
      const clientId = await mkReportClient();
      const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
      return run(s, "/payments", {
        body: recordBody(clientId, 50_000, [{ documentId: inv.id, amountMinor: 50_000 }]),
      });
    },
    "POST /api/v1/payments/:id/verify": async () => {
      const s = await owner();
      const staff = await sessionFor("staff");
      const clientId = await mkReportClient();
      const made = await recorded(staff, recordBody(clientId, 10_000));
      const row = await paymentRow(made.id);
      return run(s, `/payments/${made.id}/verify`, {
        body: { decision: "confirm", expectedRecordedAt: row.recorded_at },
      });
    },
    "POST /api/v1/payments/:id/withdraw": async () => {
      const s = await owner();
      const clientId = await mkReportClient();
      const made = await recorded(s, recordBody(clientId, 10_000));
      return run(s, `/payments/${made.id}/withdraw`, { body: { reason: "Entered twice" } });
    },
    "PUT /api/v1/payments/:id/proof": async () => {
      const s = await owner();
      const clientId = await mkReportClient();
      const made = await recorded(s, recordBody(clientId, 10_000));
      const rid = `ray-${crypto.randomUUID()}`;
      const res = await putDoc(`/payments/${made.id}/proof`, PDF_BYTES, {
        cookie: s.cookie,
        headers: { ...headers(rid), "X-Proof-Kind": "Bank%20advice" },
      });
      return { res, rid, actor: s };
    },
    "POST /api/v1/payments/:id/tds-certificate": async () => {
      const s = await owner();
      const clientId = await mkReportClient();
      const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
      const made = await recorded(s, tdsBody(clientId, inv.id, 10_000));
      return run(s, `/payments/${made.id}/tds-certificate`, {
        body: { certificateNo: "RBAC16A", certificateOn: todayIso() },
      });
    },
    "POST /api/v1/clients/:id/credit/apply": async () => {
      const s = await owner();
      const clientId = await mkReportClient();
      const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
      await recorded(s, recordBody(clientId, 20_000));
      const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", inv.id);
      return run(s, `/clients/${clientId}/credit/apply`, {
        body: { documentId: inv.id, amountMinor: 20_000, expectedUpdatedAt: row?.updated_at },
      });
    },
    "POST /api/v1/invoices/:id/credit/release": async () => {
      const s = await owner();
      const clientId = await mkReportClient();
      const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
      await recorded(
        s,
        recordBody(clientId, inv.computed.totalMinor, [
          { documentId: inv.id, amountMinor: inv.computed.totalMinor },
        ]),
      );
      // a credit note of 10,000 after the payment: an excess of 10,000 on the invoice
      await env.DB.prepare(
        "UPDATE documents SET credited_minor = 10000, status = 'paid', balance_minor = 0, updated_at = updated_at + 1 WHERE id = ?",
      )
        .bind(inv.id)
        .run();
      const row = await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", inv.id);
      return run(s, `/invoices/${inv.id}/credit/release`, {
        body: { amountMinor: 10_000, expectedUpdatedAt: row?.updated_at },
      });
    },
    "POST /api/v1/invoices/:id/realisation-extensions": async () => {
      const s = await owner();
      const clientId = await mkReportClient("USD");
      const inv = await addDoc({ clientId, currency: "USD", issueDate: "2026-10-05" });
      return run(s, `/invoices/${inv.id}/realisation-extensions`, {
        body: { extendedTo: "2028-01-31", bankRef: "AD-BANK-1" },
      });
    },
    "PUT /api/v1/invoices/:id/realisation-extensions/:eid/letter": async () => {
      const s = await owner();
      const clientId = await mkReportClient("USD");
      const inv = await addDoc({ clientId, currency: "USD", issueDate: "2026-10-05" });
      const ext = await call(`/invoices/${inv.id}/realisation-extensions`, {
        cookie: s.cookie,
        body: { extendedTo: "2028-01-31", bankRef: "AD-BANK-2" },
      });
      const { id } = (await ext.json()) as { id: string };
      const rid = `ray-${crypto.randomUUID()}`;
      const res = await putDoc(`/invoices/${inv.id}/realisation-extensions/${id}/letter`, PDF_BYTES, {
        cookie: s.cookie,
        name: "letter.pdf",
        headers: headers(rid),
      });
      return { res, rid, actor: s };
    },
  };

  it("there is a scenario for every route that declares an audit action", () => {
    const audited = ROUTES.filter((r) => r.audit).map((r) => `${r.method} ${r.path}`);
    expect(Object.keys(scenarios).sort()).toEqual(audited.sort());
  });

  for (const route of ROUTES.filter((r) => r.audit)) {
    it(`${route.method} ${route.path} → one ${route.audit} row with actor, role, request_id, ip and user agent`, async () => {
      const scenario = scenarios[`${route.method} ${route.path}`] as Scenario;
      const { res, rid, actor, action } = await scenario();
      expect(res.status, await res.clone().text()).toBeLessThan(300);
      const audit = await rows<{
        action: string;
        actor_id: string;
        role: string;
        actor_type: string;
        ip: string;
        user_agent: string;
        request_id: string;
      }>(
        "SELECT action, actor_id, role, actor_type, ip, user_agent, request_id FROM audit_log WHERE request_id = ? AND action NOT LIKE 'alert.%'",
        rid,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]).toEqual({
        action: action ?? route.audit,
        actor_id: actor.id,
        role: actor.role,
        actor_type: "staff",
        ip: IP,
        user_agent: "RbacTest/1.0",
        request_id: rid,
      });
    });
  }

  it("a refused mutation writes no audit row", async () => {
    const s = await sessionFor("staff", { stepUp: true });
    const rid = "ray-refused";
    const res = await call("/users/invites", {
      body: { email: newEmail(), role: "staff" },
      cookie: s.cookie,
      headers: headers(rid),
    });
    expect(res.status).toBe(403);
    expect(await countOf("audit_log", "request_id = ?", rid)).toBe(0);
    const o = await owner();
    const nope = await call("/users/no-such-user/deactivate", {
      method: "POST",
      cookie: o.cookie,
      headers: headers("ray-404"),
    });
    expect(nope.status).toBe(404);
    expect(await countOf("audit_log", "request_id = 'ray-404'")).toBe(0);
  });

  it("each sign-in route writes exactly one auth.login row", async () => {
    const e = await enrol(newEmail(), "staff");
    const id = await userId(e.email);
    expect(await countOf("audit_log", "action = 'auth.login' AND actor_id = ?", id)).toBe(1); // invite/totp
    const login = await call("/auth/login", { body: { email: e.email, clientHash: e.clientHash } });
    const { challenge } = (await login.json()) as { challenge: string };
    const rid = "ray-recovery-login";
    const rec = await call("/auth/recovery", {
      body: { challenge, code: e.recoveryCodes[0] },
      headers: headers(rid),
    });
    expect(rec.status).toBe(200);
    const sameRequest = await rows(
      "SELECT action FROM audit_log WHERE request_id = ? AND action NOT LIKE 'alert.%'",
      rid,
    );
    expect(sameRequest).toEqual([{ action: "auth.login" }]);
    await env.DB.prepare("UPDATE staff_users SET totp_last_step = NULL WHERE id = ?").bind(id).run();
    const ridTotp = "ray-totp-login";
    const t = await call("/auth/totp", {
      body: { challenge, code: totpCode(e.secret, currentStep(Date.now())) },
      headers: headers(ridTotp),
    });
    expect(t.status).toBe(200);
    expect(
      await rows("SELECT action FROM audit_log WHERE request_id = ? AND action NOT LIKE 'alert.%'", ridTotp),
    ).toEqual([{ action: "auth.login" }]);
  });

  it("summaries hold no credential, and audit_log and access_log refuse UPDATE (audit also DELETE)", async () => {
    const all = await rows<{ summary: string | null }>(
      "SELECT summary FROM audit_log WHERE summary IS NOT NULL",
    );
    expect(all.length).toBeGreaterThan(5);
    for (const { summary } of all) {
      expect(() => JSON.parse(summary as string)).not.toThrow();
      expect(summary).not.toMatch(/token|secret|password|cookie|hmac|"code"/i);
    }
    const audit = await one<{ id: string }>("SELECT id FROM audit_log LIMIT 1");
    await expect(
      env.DB.prepare("UPDATE audit_log SET action = 'x' WHERE id = ?").bind(audit?.id).run(),
    ).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM audit_log WHERE id = ?").bind(audit?.id).run()).rejects.toThrow(
      /append-only/,
    );
    const access = await one<{ id: string }>("SELECT id FROM access_log LIMIT 1");
    await expect(
      env.DB.prepare("UPDATE access_log SET status = 1 WHERE id = ?").bind(access?.id).run(),
    ).rejects.toThrow(/append-only/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the access log [NFR-9, Q2]", () => {
  const rid = () => `ray-${crypto.randomUUID()}`;
  const accessOf = (id: string) =>
    rows<{
      method: string;
      route: string;
      status: number;
      actor_id: string | null;
      ip: string | null;
      user_agent: string | null;
      realm: string;
    }>(
      "SELECT method, route, status, actor_id, ip, user_agent, realm FROM access_log WHERE request_id = ?",
      id,
    );

  it("a read by a signed-in member is logged with the route pattern, status, actor and request id", async () => {
    const s = await sessionFor("accountant");
    const id = rid();
    const res = await call("/auth/me", {
      cookie: s.cookie,
      headers: { "cf-ray": id, "CF-Connecting-IP": "203.0.113.7", "User-Agent": "AccessTest/2.0" },
    });
    expect(res.status).toBe(200);
    expect(await accessOf(id)).toEqual([
      {
        method: "GET",
        route: "/api/v1/auth/me",
        status: 200,
        actor_id: s.id,
        ip: "203.0.113.7",
        user_agent: "AccessTest/2.0",
        realm: "admin",
      },
    ]);
  });

  it("the route is the PATTERN: ids in the path never reach the log", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const t = await sessionFor("staff");
    const id = rid();
    await call(`/users/${t.id}/deactivate`, { method: "POST", cookie: o.cookie, headers: { "cf-ray": id } });
    const [row] = await accessOf(id);
    expect(row?.route).toBe("/api/v1/users/:id/deactivate");
    const dump = JSON.stringify(await rows("SELECT route FROM access_log"));
    expect(dump).not.toContain(t.id);
    expect(dump).not.toContain(t.sessionId);
  });

  it("refusals are logged: no cookie (actor null, 401), no permission (actor set, 403), a bad request (400)", async () => {
    const a = rid();
    await call("/auth/me", { headers: { "cf-ray": a } });
    expect(await accessOf(a)).toMatchObject([{ status: 401, actor_id: null, route: "/api/v1/auth/me" }]);
    const s = await sessionFor("sales");
    const b = rid();
    await call("/users", { cookie: s.cookie, headers: { "cf-ray": b } });
    expect(await accessOf(b)).toMatchObject([{ status: 403, actor_id: s.id, route: "/api/v1/users" }]);
    const c = rid();
    await call("/auth/login", { body: { email: "bad" }, headers: { "cf-ray": c } });
    expect(await accessOf(c)).toMatchObject([{ status: 400, actor_id: null, route: "/api/v1/auth/login" }]);
  });

  it("sign-in attempts are logged with no actor until they succeed, and never with the email", async () => {
    const e = await enrol(newEmail(), "staff");
    const wrong = rid();
    await call("/auth/login", {
      body: { email: e.email, clientHash: hash() },
      headers: { "cf-ray": wrong },
    });
    expect(await accessOf(wrong)).toMatchObject([
      { status: 401, actor_id: null, route: "/api/v1/auth/login" },
    ]);
    const ok = rid();
    const login = await call("/auth/login", {
      body: { email: e.email, clientHash: e.clientHash },
      headers: { "cf-ray": ok },
    });
    const { challenge } = (await login.json()) as { challenge: string };
    expect(await accessOf(ok)).toMatchObject([{ status: 200, actor_id: null }]);
    const signed = rid();
    await env.DB.prepare("UPDATE staff_users SET totp_last_step = NULL WHERE id = ?")
      .bind(await userId(e.email))
      .run();
    await call("/auth/totp", {
      body: { challenge, code: totpCode(e.secret, currentStep(Date.now())) },
      headers: { "cf-ray": signed },
    });
    expect(await accessOf(signed)).toMatchObject([
      { status: 200, actor_id: await userId(e.email), route: "/api/v1/auth/totp" },
    ]);
    expect(JSON.stringify(await rows("SELECT * FROM access_log"))).not.toContain(e.email);
  });

  it("successful lookups (health, salt, invite start) and undeclared paths write no row [Q2]", async () => {
    const before = await countOf("access_log");
    await call("/health");
    expect((await call("/auth/salt", { body: { email: "someone@example.com" } })).status).toBe(200);
    const token = await invite(newEmail(), "staff");
    expect((await call("/auth/invite/start", { body: { token } })).status).toBe(200);
    await call("/does/not/exist");
    expect(await countOf("access_log")).toBe(before);
  });

  it("refusals on /salt and /invite/start ARE logged (owner's Q2: every refusal), health never", async () => {
    const a = rid();
    const salt = await call("/auth/salt", { body: { email: "not-an-email" }, headers: { "cf-ray": a } });
    expect(salt.status).toBe(400);
    expect(await accessOf(a)).toMatchObject([{ status: 400, actor_id: null, route: "/api/v1/auth/salt" }]);
    const b = rid();
    const start = await call("/auth/invite/start", {
      body: { token: "a".repeat(43) },
      headers: { "cf-ray": b },
    });
    expect(start.status).toBe(400); // an unknown invite
    expect(await accessOf(b)).toMatchObject([
      { status: 400, actor_id: null, route: "/api/v1/auth/invite/start" },
    ]);
    const c = rid();
    const bad = await call("/auth/invite/start", { body: { token: "short" }, headers: { "cf-ray": c } });
    expect(bad.status).toBe(400);
    expect(await accessOf(c)).toHaveLength(1);
    const before = await countOf("access_log");
    await call("/health");
    expect(await countOf("access_log")).toBe(before);
  });

  it("one row per request, also when a mutation succeeds (it rides in the mutation's batch)", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const id = rid();
    const res = await call("/auth/sessions/revoke-all", {
      method: "POST",
      cookie: o.cookie,
      headers: { "cf-ray": id },
    });
    expect(res.status).toBe(200);
    expect(await accessOf(id)).toHaveLength(1);
  });

  it("a blocked address writes no access row either (it must cost the database nothing)", async () => {
    const ip = "203.0.113.200";
    await env.DB.prepare(
      "INSERT INTO auth_attempts (key, window_start, failures, locked_until) VALUES (?, ?, 100, ?)",
    )
      .bind(await ipKey(env.SALT_PEPPER, ip), Date.now(), Date.now() + 60_000)
      .run();
    const id = rid();
    const res = await call("/auth/login", {
      body: { email: "a@example.com", clientHash: hash() },
      headers: { "cf-ray": id, "CF-Connecting-IP": ip },
    });
    expect(res.status).toBe(429);
    expect(await accessOf(id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("CSRF: JSON only, from our own origin (docs/05 §7.1) [ADM-G-02]", () => {
  const s = () => sessionFor("owner", { stepUp: true });
  const raw = (path: string, init: RequestInit) => send(`${ORIGIN}/api/v1${path}`, init, env);
  const json = { "Content-Type": "application/json" };

  it("a cross-origin JSON POST or DELETE is 403, and does nothing", async () => {
    const o = await s();
    const other = await extraSession(o);
    const post = await raw("/users/invites", {
      method: "POST",
      headers: { ...json, Origin: "https://evil.example", Cookie: o.cookie },
      body: JSON.stringify({ email: newEmail(), role: "staff" }),
    });
    expect(post.status).toBe(403);
    const del = await raw(`/auth/sessions/${other.sessionId}`, {
      method: "DELETE",
      headers: { Origin: "https://evil.example", Cookie: o.cookie },
    });
    expect(del.status).toBe(403);
    expect((await call("/auth/me", { cookie: other.cookie })).status).toBe(200); // the session survived
    expect(await bodyOf(post)).toEqual({ error: { code: "forbidden", message: "Request refused" } });
  });

  it("same origin passes; so does no Origin with Sec-Fetch-Site: same-origin", async () => {
    const o = await s();
    const ok = await raw("/users/invites", {
      method: "POST",
      headers: { ...json, Origin: ORIGIN, Cookie: o.cookie },
      body: JSON.stringify({ email: newEmail(), role: "staff" }),
    });
    expect(ok.status).toBe(201);
    const fetchMeta = await raw("/users/invites", {
      method: "POST",
      headers: { ...json, "Sec-Fetch-Site": "same-origin", Cookie: o.cookie },
      body: JSON.stringify({ email: newEmail(), role: "staff" }),
    });
    expect(fetchMeta.status).toBe(201);
  });

  it("no Origin and no same-origin proof is refused; so are 'null', same-site and cross-site", async () => {
    const o = await s();
    const body = JSON.stringify({ email: newEmail(), role: "staff" });
    for (const headers of [
      { ...json, Cookie: o.cookie },
      { ...json, Origin: "null", Cookie: o.cookie },
      { ...json, "Sec-Fetch-Site": "same-site", Cookie: o.cookie },
      { ...json, "Sec-Fetch-Site": "cross-site", Cookie: o.cookie },
      { ...json, Origin: `${ORIGIN}.evil.example`, Cookie: o.cookie },
    ]) {
      expect((await raw("/users/invites", { method: "POST", headers, body })).status).toBe(403);
    }
  });

  it("a body that isn't JSON is 415, even from our own origin; a bodiless POST is fine", async () => {
    const o = await s();
    for (const type of [
      "text/plain",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
    ]) {
      const res = await raw("/users/invites", {
        method: "POST",
        headers: { "Content-Type": type, Origin: ORIGIN, Cookie: o.cookie },
        body: "email=a@b.co",
      });
      expect(res.status, type).toBe(415);
      expect(await bodyOf(res)).toEqual({ error: { code: "unsupported_media_type", message: "Send JSON" } });
    }
    const noType = await raw("/users/invites", {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: o.cookie },
      body: "{}",
    });
    expect(noType.status).toBe(415);
    const empty = await raw("/auth/sessions/revoke-all", {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: o.cookie },
    });
    expect(empty.status).toBe(200);
    const charset = await raw("/users/invites", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Origin: ORIGIN,
        Cookie: (await s()).cookie,
      },
      body: JSON.stringify({ email: newEmail(), role: "staff" }),
    });
    expect(charset.status).toBe(201);
  });

  it("safe methods are not checked (a cross-origin GET reaches the guard)", async () => {
    const o = await s();
    const res = await raw("/auth/me", { headers: { Origin: "https://evil.example", Cookie: o.cookie } });
    expect(res.status).toBe(200);
  });

  it("refusals by CSRF are logged like any refusal", async () => {
    const o = await s();
    const id = "ray-csrf";
    await raw("/users/invites", {
      method: "POST",
      headers: { ...json, Origin: "https://evil.example", Cookie: o.cookie, "cf-ray": id },
      body: "{}",
    });
    expect(await rows("SELECT status, route FROM access_log WHERE request_id = ?", id)).toEqual([
      { status: 403, route: "/api/v1/users/invites" },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("request ids and response headers (LD7, docs/05 §7.1)", () => {
  it("cf-ray is the request id; without it a 16-hex id is made; every error body carries it", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const staff = await sessionFor("staff");
    const cases: [string, Parameters<typeof call>[1]][] = [
      ["/auth/login", { body: { email: "nope" } }], // 400
      ["/auth/me", {}], // 401
      ["/users", { cookie: staff.cookie }], // 403
      ["/nothing/here", {}], // 404
      ["/users/invites", { body: { email: staff.email, role: "staff" }, cookie: o.cookie }], // 409
      ["/auth/login", { body: { email: "a@b.co", clientHash: "x".repeat(20_000) } }], // 413
    ];
    for (const [path, init] of cases) {
      const withRay = await call(path, { ...init, headers: { "cf-ray": "8f0c1a2b3c4d5e6f-BOM" } });
      expect(withRay.status).toBeGreaterThanOrEqual(400);
      expect(((await withRay.json()) as { request_id: string }).request_id).toBe("8f0c1a2b3c4d5e6f-BOM");
      const without = await call(path, init);
      expect(((await without.json()) as { request_id: string }).request_id).toMatch(/^[0-9a-f]{16}$/);
    }
    const wrongType = await send(
      `${ORIGIN}/api/v1/users/invites`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain", Origin: ORIGIN, Cookie: o.cookie },
        body: "x",
      },
      env,
    );
    expect(((await wrongType.json()) as { request_id: string }).request_id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("two requests get different ids", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++)
      ids.add(((await (await call("/auth/me")).json()) as { request_id: string }).request_id);
    expect(ids.size).toBe(5);
  });

  it("every /api response is no-store, success or error", async () => {
    const s = await sessionFor("staff");
    for (const [path, init] of [
      ["/health", {}],
      ["/auth/me", { cookie: s.cookie }],
      ["/auth/me", {}],
      ["/users", { cookie: s.cookie }],
      ["/nothing", {}],
      ["/auth/salt", { body: { email: "a@b.co" } }],
    ] as [string, Parameters<typeof call>[1]][]) {
      expect((await call(path, init)).headers.get("Cache-Control"), path).toBe("no-store");
    }
  });

  it("D1 calls: a refusal by the guard is 1 read + the access row; an allowed read adds its own", async () => {
    const s = await sessionFor("staff");
    const denied = await counting("/users", { cookie: s.cookie });
    expect([denied.res.status, denied.calls]).toEqual([403, 2]);
    const o = await sessionFor("owner");
    const read = await counting("/users", { cookie: o.cookie });
    expect([read.res.status, read.calls]).toEqual([200, 3]);
  });

  it("the invite helper and accept helper agree with the table (smoke)", async () => {
    const token = await invite(newEmail(), "staff");
    const e = await accept(token);
    expect((await call("/auth/me", { cookie: e.cookie })).status).toBe(200);
  });
});
