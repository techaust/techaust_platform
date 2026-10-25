// A local proxy for the Free plan's CPU limit (docs/runbooks/cpu-baseline.md) of the M3.4 routes: the wall time of each request through the
// whole Hono app in workerd with local D1 and R2. Wall time includes waiting on I/O, so it is an UPPER BOUND of CPU time; the real gate
// is the staging `cpuTimeMs` reading per milestone. Prints the median and worst of each; asserts only a very loose ceiling so the test
// is never flaky on a slow machine.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { mkClient } from "./test-clients.ts";
import { call, sessionFor } from "./test-helpers.ts";
import { mkFile, mkMilestone, mkNote, mkProject, pdfOfSize, sha256Hex, upload } from "./test-projects.ts";
import { getDoc, json, mkDraft, mkTerms, patchDoc, sendDoc } from "./test-quotes.ts";

const time = async (n: number, run: () => Promise<Response>) => {
  const ms: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    const res = await run();
    await res.arrayBuffer();
    ms.push(performance.now() - t);
    expect(res.status).toBeLessThan(300);
  }
  ms.sort((a, b) => a - b);
  return { median: ms[Math.floor(n / 2)] as number, worst: ms.at(-1) as number };
};
const report: string[] = [];
// M4.3: a proposal of 100 lines and 30,000 characters of sections, saved, read and sent.
const BIG_LINES = Array.from({ length: 100 }, (_, i) => ({
  description: `Line ${i} ${"d".repeat(110)}`,
  detail: "x".repeat(200),
  qtyMilli: 1000,
  unit: "fixed",
  rateMinor: 1_000 + i,
  sac: "998314",
}));
const BIG_SECTIONS = ["estimate", "terms", "acceptance", "summary", "scope", "team"].map((kind) => ({
  kind,
  title: kind,
  bodyMd: "t".repeat(4_990),
}));
const show = (name: string, r: { median: number; worst: number }) =>
  report.push(`${name}: median ${r.median.toFixed(1)}, worst ${r.worst.toFixed(1)}`);

describe("wall-time proxy for CPU [docs/05 §10, NFR p99 ≤ 7 ms]", () => {
  it("project page, notes list, client projects list, small and 25 MiB upload and download", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const clientId = await mkClient();
    const p = await mkProject(clientId, { budget_minor: 1_000_000 });
    for (let i = 1; i <= 20; i++) await mkMilestone(p.id, { position: i, title: `M${i}` });
    for (let i = 0; i < 30; i++) {
      await mkNote(clientId, { project_id: p.id, created_at: 9_000_000 + i });
      await mkFile(clientId, { projectId: p.id });
    }
    const page = await time(15, () => call(`/projects/${p.id}`, { cookie: o.cookie }));
    show("GET /projects/:id (20 milestones, 5 notes, 5 files)", page);
    const notes = await time(15, () => call(`/projects/${p.id}/notes`, { cookie: o.cookie }));
    show("GET /projects/:id/notes (25 rows)", notes);
    const list = await time(15, () => call("/projects?limit=25", { cookie: o.cookie }));
    show("GET /projects (25 rows)", list);
    const small = pdfOfSize(100_000);
    const smallUp = await time(5, () => upload(`/projects/${p.id}/files`, small, { cookie: o.cookie }));
    show("POST file, 100 KB", smallUp);

    const big = pdfOfSize(25 * 1024 * 1024);
    const sha = await sha256Hex(big);
    let id = "";
    const t0 = performance.now();
    const res = await upload(`/clients/${clientId}/files`, big, { cookie: o.cookie, sha });
    const upMs = performance.now() - t0;
    expect(res.status).toBe(201);
    id = ((await res.json()) as { id: string }).id;
    show("POST file, 25 MiB", { median: upMs, worst: upMs });
    const down = await time(2, () => call(`/files/${id}/download`, { cookie: o.cookie }));
    show("GET download, 25 MiB", down);
    expect(page.median).toBeLessThan(500);
    expect(env.FILES).toBeDefined();
    expect(report).toHaveLength(6); // to read the numbers, compare report.join(" | ") with "" and read the failure
  }, 180_000);
});

describe("wall-time proxy for CPU of the M4.3 routes: a 100-line proposal with 30,000 characters of sections [docs/05 §10]", () => {
  it("save (PATCH), read (GET) and send of a cap-sized document; and the cold first request", async () => {
    await mkTerms();
    const o = await sessionFor("owner", { stepUp: true });
    const ms = async (run: () => Promise<Response>, status = 200) => {
      const t = performance.now();
      const res = await run();
      await res.arrayBuffer();
      const took = performance.now() - t;
      expect(res.status).toBe(status);
      return took;
    };
    const stat = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return { median: s[Math.floor(s.length / 2)] as number, worst: s.at(-1) as number };
    };
    const made = await mkDraft(o);
    let view = await getDoc(o, made.id);
    const saves: number[] = [];
    const gets: number[] = [];
    for (let i = 0; i < 8; i++) {
      saves.push(
        await ms(async () => {
          const res = await patchDoc(o, made.id, {
            expectedUpdatedAt: view.updatedAt,
            fields: { title: `Cap-sized ${i}` },
            lines: BIG_LINES,
            sections: BIG_SECTIONS,
          });
          view = await res.clone().json();
          return res;
        }),
      );
      gets.push(await ms(() => call(`/documents/${made.id}`, { cookie: o.cookie })));
    }
    const sends: number[] = [];
    for (let i = 0; i < 4; i++) {
      const d = await mkDraft(o);
      const v = await getDoc(o, d.id);
      const saved = await patchDoc(o, d.id, {
        expectedUpdatedAt: v.updatedAt,
        lines: BIG_LINES,
        sections: BIG_SECTIONS,
      });
      const sv = await json(saved);
      sends.push(await ms(() => sendDoc(o, d.id, sv.updatedAt)));
    }
    show("PATCH 100 lines + 30,000 characters of sections", stat(saves));
    show("GET the same document", stat(gets));
    show("POST send of the same", stat(sends));
    // The floor of this setup: the cheapest guarded read and a one-call list, for comparison.
    const floor: number[] = [];
    const list: number[] = [];
    for (let i = 0; i < 8; i++) {
      floor.push(await ms(() => call("/auth/me", { cookie: o.cookie })));
      list.push(await ms(() => call("/documents?limit=25", { cookie: o.cookie })));
    }
    show("floor: GET /auth/me", stat(floor));
    show("GET /documents (25 rows)", stat(list));
    // A loose ceiling only (a slow PC and wall time, not CPU); the real gate is the staging cpuTimeMs reading.
    expect(stat(saves).median).toBeLessThan(500);
    // Local wall time on this PC (median, ms; M4.3, workerd with local D1): PATCH 25, GET 14, send 16; the floor GET /auth/me 5 and a one-call
    // list 9. Wall time includes the local D1 and is an UPPER BOUND of CPU; the staging cpuTimeMs reading is the gate (docs/05 §10).
    expect(report.slice(-5)).toHaveLength(5); // to read the numbers, compare report.slice(-5).join(" | ") with "" and read the failure
  }, 180_000);
});
