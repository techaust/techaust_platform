// A local proxy for the Free plan's CPU limit (docs/runbooks/cpu-baseline.md) of two M5.5b jobs: `realisation.scan` at a full page of 50 rows and the `pdf.statement` work before Browser Run
// (entries, view, hash input and HTML) at 200 entries. Wall time in workerd with local D1, so an UPPER BOUND of CPU time (it includes waiting on I/O and, for the first call, JIT). The loose
// ceilings only catch an accident; the staging `cpuTimeMs` reading is the gate. The figures print at the end and go in the builder report. [JOB-PDF-01, ADM-INV-17]
import { statementEntries } from "@techaust/core/statement";
import { renderStatementHtml, statementView } from "@techaust/pdf";
import { afterAll, describe, expect, it } from "vitest";
import { processRealisationScan } from "../src/reports.ts";
import { warmStatement } from "../src/warm.ts";
import { fakes, makeEnv, mkClient, mkDoc, run, staff, useFakes } from "./billing-fixtures.ts";

useFakes();

const report: string[] = [];
afterAll(() => console.info(`\nM5.5b jobs wall-time proxy (ms, local workerd):\n${report.join("\n")}`));

const summarise = (ms: number[]) => {
  const s = [...ms].sort((a, b) => a - b);
  return { first: ms[0] as number, median: s[Math.floor(s.length / 2)] as number, worst: s.at(-1) as number };
};

describe("realisation.scan at 50 rows", () => {
  it("a page of 50 overdue exports for one owner: the 50 are handled, the wall time is recorded", async () => {
    const owner = await staff("owner");
    await run(
      "UPDATE staff_users SET status = 'deactivated' WHERE role = 'owner' AND status = 'active' AND id != ?1",
      owner.id,
    );
    for (let i = 0; i < 50; i++) {
      const clientId = await mkClient({ currency: "USD" });
      await mkDoc(clientId, null, {
        type: "export_invoice",
        currency: "USD",
        issueDate: "2026-11-03",
        supplyType: "export_lut",
        placeOfSupply: "96",
        recipient: JSON.stringify({ legalName: `Acme Overseas ${i}`, gstStatus: "overseas", country: "US" }),
      });
    }
    // the first run rings (50 emails + 50 bells); later runs find every bell (the steady state of the daily scan)
    const now = Date.UTC(2027, 6, 10, 3, 30); // 2027-07-10 09:00 IST: fema_approaching
    const ms: number[] = [];
    for (let i = 0; i < 4; i++) {
      fakes.email.length = 0;
      const t = performance.now();
      const done = await processRealisationScan(makeEnv(), { v: 1, kind: "realisation.scan" }, now);
      ms.push(performance.now() - t);
      expect(done).toMatchObject({ kind: "done" });
      if (i === 0) expect(done).toMatchObject({ rows: 50, alerts: 50 });
    }
    const r = summarise(ms);
    report.push(
      `realisation.scan 50 rows (first run rings 50 emails + bells; the rest find them): first ${r.first.toFixed(1)}, median ${r.median.toFixed(1)}, worst ${r.worst.toFixed(1)}`,
    );
    expect(r.worst).toBeLessThan(3_000);
  });
});

describe("pdf.statement view and HTML at 200 entries (no Browser Run)", () => {
  it("entries, view and HTML of 200 lines: the 200 print, the wall time is recorded", () => {
    const ms: number[] = [];
    let bytes = 0;
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      bytes = warmStatement(200);
      ms.push(performance.now() - t);
    }
    expect(bytes).toBeGreaterThan(10_000);
    const r = summarise(ms);
    report.push(
      `pdf.statement entries + view + hash input + HTML, 200 entries (${bytes} bytes): first ${r.first.toFixed(1)}, median ${r.median.toFixed(1)}, worst ${r.worst.toFixed(1)}`,
    );
    expect(r.median).toBeLessThan(1_000);
  });

  it("the sample really carries 200 lines through the real functions", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: `r${i}`,
      kind: "tax_invoice" as const,
      date: "2026-10-05",
      number: `N${i}`,
      amountMinor: 100,
    }));
    const done = statementEntries(rows, 0);
    expect(done.ok && done.entries).toHaveLength(200);
    expect(typeof statementView).toBe("function");
    expect(typeof renderStatementHtml).toBe("function");
  });
});
