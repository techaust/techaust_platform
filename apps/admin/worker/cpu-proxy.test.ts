// A local proxy for the Free plan's CPU limit (docs/runbooks/cpu-baseline.md) of the M3.4 routes: the wall time of each request through the
// whole Hono app in workerd with local D1 and R2. Wall time includes waiting on I/O, so it is an UPPER BOUND of CPU time; the real gate
// is the staging `cpuTimeMs` reading per milestone. Prints the median and worst of each; asserts only a very loose ceiling so the test
// is never flaky on a slow machine.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { mkClient } from "./test-clients.ts";
import { call, sessionFor } from "./test-helpers.ts";
import { mkFile, mkMilestone, mkNote, mkProject, pdfOfSize, sha256Hex, upload } from "./test-projects.ts";

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
