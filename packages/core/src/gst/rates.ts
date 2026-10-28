// The INR rates of a computed document, for the register (M5.5a; ADM-REP-04). It reads the tax engine's output and
// groups its lines by (SAC, effective rate): an INR document uses the line values, a USD document the INR view of each line
// (`line.inr`). The sums must equal the document's INR totals; if the engine ever disagrees, the result says
// `rates_sum_mismatch` and nothing is patched around it. Researched 2026-10-28, GSTN advisories of June 2025 (08-C RA-23).
import type { ComputedDocument } from "../tax/types.ts";
import { compareText, fail, type GstResult, guard, issue, num, ok, type RegisterRate } from "./types.ts";

type Sum = { taxable: bigint; igst: bigint; cgst: bigint; sgst: bigint };

/** The rates of a document, sorted by SAC (none first) and then rate. */
export function registerRatesOf(computed: ComputedDocument): GstResult<readonly RegisterRate[]> {
  return guard(() => {
    const isInr = computed.currency === "INR";
    const target = isInr ? computed : computed.inr;
    if (target === null) return fail([issue("fx_missing")]);

    const groups = new Map<string, { sac: string | null; rateBp: number; sum: Sum }>();
    const total: Sum = { taxable: 0n, igst: 0n, cgst: 0n, sgst: 0n };
    for (const line of computed.lines) {
      const view = isInr ? line : line.inr;
      if (view === null) return fail([issue("fx_missing", "lines", line.index)]);
      const key = `${line.sac ?? ""}|${line.sac === null ? "n" : "s"}|${line.effectiveRateBp}`;
      let group = groups.get(key);
      if (group === undefined) {
        group = {
          sac: line.sac,
          rateBp: line.effectiveRateBp,
          sum: { taxable: 0n, igst: 0n, cgst: 0n, sgst: 0n },
        };
        groups.set(key, group);
      }
      for (const s of [group.sum, total]) {
        s.taxable += BigInt(view.taxableMinor);
        s.igst += BigInt(view.igstMinor);
        s.cgst += BigInt(view.cgstMinor);
        s.sgst += BigInt(view.sgstMinor);
      }
    }
    if (
      total.taxable !== BigInt(target.taxableMinor) ||
      total.igst !== BigInt(target.igstMinor) ||
      total.cgst !== BigInt(target.cgstMinor) ||
      total.sgst !== BigInt(target.sgstMinor)
    ) {
      return fail([issue("rates_sum_mismatch")]);
    }
    const rows = [...groups.values()]
      .sort((a, b) => compareText(a.sac ?? "", b.sac ?? "") || a.rateBp - b.rateBp)
      .map(({ sac, rateBp, sum }) => ({
        sac,
        rateBp,
        taxableMinor: num(sum.taxable),
        igstMinor: num(sum.igst),
        cgstMinor: num(sum.cgst),
        sgstMinor: num(sum.sgst),
      }));
    return ok(rows);
  });
}
