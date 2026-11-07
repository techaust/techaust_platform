// Rebuild PDF (JOB-PDF-02): the key rule, the verdict and the queue message. The SQL twin of `repairKey` is tested against D1 in packages/db.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isPdfKind, isPdfMessage, PDF_MAX_HOPS } from "../src/pdf-jobs.ts";
import {
  isRepairCode,
  REBUILD_OPEN_MS,
  REBUILD_WINDOW_MS,
  REPAIR_KINDS,
  REPAIR_MAX,
  REPAIR_OUTCOMES,
  rebuildVerdict,
  repairKey,
} from "../src/pdf-repair.ts";
import { decide } from "../src/permissions.ts";

const stem = fc.stringMatching(/^(docs|deeds)\/[a-z0-9_/-]{1,60}[a-z0-9]$/).filter((s) => !/-r\d+$/.test(s));

describe("repairKey (L7)", () => {
  it("the brief's examples", () => {
    expect(repairKey("docs/proposal/2026-27/0001-v1.pdf", 1)).toBe("docs/proposal/2026-27/0001-v1-r1.pdf");
    expect(repairKey("docs/tax_invoice/2026-27/0003-v1-supplier.pdf", 1)).toBe(
      "docs/tax_invoice/2026-27/0003-v1-supplier-r1.pdf",
    );
    expect(repairKey("docs/estimate/2026-27/0002-v1-certificate.pdf", 1)).toBe(
      "docs/estimate/2026-27/0002-v1-certificate-r1.pdf",
    );
    expect(repairKey("docs/receipt/2026-27/0001-v1.pdf", 1)).toBe("docs/receipt/2026-27/0001-v1-r1.pdf");
    expect(repairKey(`deeds/d1/unsigned-${"a".repeat(64)}.pdf`, 99)).toBe(
      `deeds/d1/unsigned-${"a".repeat(64)}-r99.pdf`,
    );
  });

  it("property: the key keeps the original's stem, ends -r<n>.pdf, differs for every n and is never the original", () => {
    fc.assert(
      fc.property(
        stem,
        fc.integer({ min: 1, max: REPAIR_MAX }),
        fc.integer({ min: 1, max: REPAIR_MAX }),
        (s, n, m) => {
          const original = `${s}.pdf`;
          const k = repairKey(original, n);
          expect(k.startsWith(s)).toBe(true);
          expect(k).toBe(`${s}-r${n}.pdf`);
          expect(k).not.toBe(original);
          if (n !== m) expect(repairKey(original, m)).not.toBe(k);
          // a rebuilt key is never the stem of another rebuild
          expect(() => repairKey(k, 1)).toThrow(RangeError);
        },
      ),
    );
  });

  it("refuses an n out of 1–99, a key that is not a PDF and an already rebuilt key", () => {
    for (const n of [0, -1, 100, 1.5, Number.NaN])
      expect(() => repairKey("docs/a.pdf", n)).toThrow(RangeError);
    for (const k of ["docs/a.json", "docs/a", ".pdf", "docs/a-r3.pdf"])
      expect(() => repairKey(k, 1)).toThrow(RangeError);
  });
});

describe("rebuildVerdict (L6)", () => {
  it("missing, damaged and intact", () => {
    const sha = "a".repeat(64);
    expect(rebuildVerdict({ present: false, recordedSha: sha, objectSha: null })).toBe("missing");
    expect(rebuildVerdict({ present: false, recordedSha: null, objectSha: null })).toBe("missing");
    expect(rebuildVerdict({ present: true, recordedSha: sha, objectSha: sha })).toBe("intact");
    expect(rebuildVerdict({ present: true, recordedSha: sha, objectSha: "b".repeat(64) })).toBe("damaged");
    // present but not hashed (over the size cap): damaged
    expect(rebuildVerdict({ present: true, recordedSha: sha, objectSha: null })).toBe("damaged");
    // no recorded hash (a supplier copy without a stored checksum): a present copy counts as intact
    expect(rebuildVerdict({ present: true, recordedSha: null, objectSha: null })).toBe("intact");
  });
});

describe("constants and codes", () => {
  it("the kinds, outcomes and windows", () => {
    expect(REPAIR_KINDS).toEqual(["offer", "certificate", "deed", "invoice", "supplier", "receipt"]);
    expect(REPAIR_OUTCOMES).toEqual(["rebuilt", "intact", "refused", "failed", "skipped"]);
    expect(REBUILD_WINDOW_MS).toBe(5 * 60_000);
    expect(REBUILD_OPEN_MS).toBe(26 * 3_600_000);
    expect(isRepairCode("statutory_endorsement")).toBe(true);
    expect(isRepairCode("Bad")).toBe(false);
    expect(isRepairCode("x".repeat(41))).toBe(false);
  });
});

describe("pdf.rebuild message and permission", () => {
  it("is a PDF message with a repair id and a bounded hop", () => {
    expect(isPdfMessage({ v: 1, kind: "pdf.rebuild", repairId: "r1", hop: 0 })).toBe(true);
    expect(isPdfMessage({ v: 1, kind: "pdf.rebuild", repairId: "r1", hop: PDF_MAX_HOPS })).toBe(true);
    expect(isPdfKind({ v: 1, kind: "pdf.rebuild" })).toBe(true);
    for (const bad of [
      { v: 1, kind: "pdf.rebuild", repairId: "", hop: 0 },
      { v: 1, kind: "pdf.rebuild", repairId: "x".repeat(65), hop: 0 },
      { v: 1, kind: "pdf.rebuild", repairId: "r1", hop: PDF_MAX_HOPS + 1 },
      { v: 1, kind: "pdf.rebuild", repairId: "r1", hop: -1 },
      { v: 1, kind: "pdf.rebuild", repairId: "r1", hop: 1.5 },
      { v: 2, kind: "pdf.rebuild", repairId: "r1", hop: 0 },
      { v: 1, kind: "pdf.rebuild", repairId: "r1" },
    ])
      expect(isPdfMessage(bad), JSON.stringify(bad)).toBe(false);
  });

  it("pdfs.rebuild is the Owner's with step-up; every other role is denied", () => {
    expect(decide("owner", "pdfs.rebuild")).toBe("step-up");
    for (const r of ["staff", "sales", "accountant"] as const) expect(decide(r, "pdfs.rebuild")).toBe("deny");
  });
});
