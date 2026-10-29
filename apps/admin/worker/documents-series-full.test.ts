// A full proposal or estimate series (FX-1, full audit A0 6; ADM-SET-04, ADM-INV-03): the send's freeze holds `next number <= highest` like the invoice issue's,
// so a full series answers 409 `series_full` (not a generic 500), takes no number, writes no audit row and leaves the draft a draft. A file of its own: far FYs'
// counters are set here, and the other send tests read the newest counter.
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { putPaymentTerms } from "./test-catalogue.ts";
import { countOf, one } from "./test-helpers.ts";
import { farSession } from "./test-invoices.ts";
import { codeOf, dbRow, getDoc, json, mkDraft, mkTerms, sendDoc } from "./test-quotes.ts";

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});
afterEach(() => vi.useRealTimers());

const counterOf = async (series: string, fy: string) =>
  (
    await one<{ next_no: number }>(
      "SELECT next_no FROM doc_counters WHERE series = ?1 AND fy = ?2",
      series,
      fy,
    )
  )?.next_no ?? null;
const setCounter = (series: string, fy: string, next: number) =>
  env.DB.prepare("INSERT INTO doc_counters (series, fy, next_no) VALUES (?1, ?2, ?3)")
    .bind(series, fy, next)
    .run();

describe("a full series refuses the send [A0 6]", () => {
  it.each([
    ["proposal", "TH/PRP", 2090],
    ["estimate", "TH/EST", 2092],
  ] as const)(
    "%s: the counter past 9999 is 409 series_full and nothing moves; the last number 9999 is still given out",
    async (type, prefix, year) => {
      const o = await farSession();
      const fy = `${String(year % 100).padStart(2, "0")}${String((year + 1) % 100).padStart(2, "0")}`;
      vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(year, 5, 1, 6, 0, 0, 0) });
      const made = await mkDraft(o, { type });
      vi.setSystemTime(Date.UTC(year, 5, 1, 6, 5, 0, 0));
      await setCounter(type, fy, 10_000);
      const res = await sendDoc(o, made.id, (await getDoc(o, made.id)).updatedAt);
      expect(res.status, await res.clone().text()).toBe(409);
      expect(await codeOf(res)).toBe("series_full");
      expect(await counterOf(type, fy)).toBe(10_000);
      expect((await dbRow(made.id))?.status).toBe("draft");
      expect(await countOf("audit_log", "action = 'document.send' AND entity_id = ?", made.id)).toBe(0);

      // The next FY, with one number left: the send takes 9999.
      const nextFy = `${String((year + 1) % 100).padStart(2, "0")}${String((year + 2) % 100).padStart(2, "0")}`;
      vi.setSystemTime(Date.UTC(year + 1, 5, 1, 6, 0, 0, 0));
      // (a session of its own: the first one's idle window slid to 12 hours after its last use, a year ago on this clock)
      const o2 = await farSession();
      const last = await mkDraft(o2, { type });
      vi.setSystemTime(Date.UTC(year + 1, 5, 1, 6, 5, 0, 0));
      await setCounter(type, nextFy, 9_999);
      const ok = await sendDoc(o2, last.id, (await getDoc(o2, last.id)).updatedAt);
      expect(ok.status, await ok.clone().text()).toBe(200);
      expect((await json(ok)).number).toBe(`${prefix}/${nextFy}/9999`);
      expect(await counterOf(type, nextFy)).toBe(10_000);
    },
  );
});
