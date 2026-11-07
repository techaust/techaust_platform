// Rebuild PDF screens [JOB-PDF-02, ADM-PROP-05, ADM-INV-07]: every 07-ZV line the screens use is the approved one, word for word (and the API's own message
// where the API says it); each refusal code reads as its line; each outcome reads as its state line; the button only for a role that may rebuild; the state
// right after a start; the paths of every kind.

import { REPAIR_KINDS } from "@techaust/core/pdf-repair";
import { decide, ROLES } from "@techaust/core/permissions";
import { describe, expect, it } from "vitest";
import zvPage from "../../../../docs/07-content-appendix/ZV-rebuild-pdf.md?raw";
import rebuildRouteSource from "../../worker/pdf-rebuild.ts?raw";
import componentSource from "../components/rebuild-pdf.tsx?raw";
import { PDF_ERASED_LINE } from "./copy-zg.ts";
import {
  FINGERPRINT_CHARS,
  numberLabel,
  outcomeLine,
  type RebuildState,
  rebuildLines,
  refusalLine,
  startedState,
  ZV,
} from "./pdf-repairs.ts";
import { rebuildPath } from "./pdf-repairs-api.ts";

const day = (ms: number) => `day(${ms})`;
const SHA = "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef560000";
const state = (over: Partial<RebuildState> = {}): RebuildState => ({
  rebuiltAt: null,
  rebuilding: false,
  served: null,
  history: [],
  ...over,
});
const row = (outcome: RebuildState["history"][number]["outcome"], code: string | null = null) => ({
  n: 1,
  found: "missing" as const,
  requestedAt: 1,
  outcome,
  code,
  completedAt: outcome ? 2 : null,
});

describe("07-ZV, word for word", () => {
  const quoted = (s: string) => zvPage.includes(`"${s}"`);
  it("lines 1 to 5: the buttons, the dialog and the started line are the approved ones", () => {
    for (const label of new Set(Object.values(ZV.button))) expect(quoted(label)).toBe(true);
    expect(zvPage).toContain('Dialog title: "Rebuild the PDF of {number}?"');
    expect(ZV.title("TH/INV/2026-27/0001")).toBe("Rebuild the PDF of TH/INV/2026-27/0001?");
    for (const s of [ZV.body, ZV.started]) expect(quoted(s)).toBe(true);
    expect(zvPage).toContain(`"${ZV.confirm}" and "${ZV.cancel}"`);
  });
  it("lines 6 to 10, 19 and 24 are the approved ones and the API's own messages", () => {
    for (const s of [
      ZV.nothingToRebuild,
      ZV.tooSoon,
      ZV.inProgress,
      ZV.clientGone,
      ZV.queueUnavailable,
      ZV.offerOpen,
      ZV.rebuildLimit,
    ]) {
      expect(quoted(s)).toBe(true);
      expect(rebuildRouteSource).toContain(`"${s}"`);
    }
  });
  it("lines 11 to 15 and 23: the state lines", () => {
    expect(zvPage).toContain('Fact: "Rebuilt on {date}. Fingerprint of the stored file: {fp}."');
    expect(ZV.rebuilt("07 Nov 2026", "ab12cd34ef56")).toBe(
      "Rebuilt on 07 Nov 2026. Fingerprint of the stored file: ab12cd34ef56.",
    );
    for (const s of [ZV.rebuilding, ZV.refused, ZV.envelopeMissing, ZV.failed, ZV.intact, ZV.skipped])
      expect(quoted(s)).toBe(true);
  });
  it("no placeholder text anywhere in the screens' words", () => {
    expect(JSON.stringify(ZV)).not.toContain("Placeholder");
    expect(componentSource).not.toContain("Placeholder");
  });
});

describe("refusals: code to line", () => {
  it.each([
    ["nothing_to_rebuild", ZV.nothingToRebuild],
    ["too_soon", ZV.tooSoon],
    ["rebuild_in_progress", ZV.inProgress],
    ["client_gone", ZV.clientGone],
    ["queue_unavailable", ZV.queueUnavailable],
    ["offer_open", ZV.offerOpen],
    ["rebuild_limit", ZV.rebuildLimit],
    ["pdf_erased", PDF_ERASED_LINE],
  ])("%s", (code, line) => expect(refusalLine(code)).toBe(line));
  it("every other code keeps the API's message (pdf_pending, not_found, the guard's)", () => {
    for (const code of [
      "pdf_pending",
      "not_found",
      "forbidden",
      "step_up_required",
      "invalid_code",
      "network",
    ])
      expect(refusalLine(code)).toBeNull();
  });
});

describe("outcomes: result to line", () => {
  it.each([
    ["intact", null, ZV.intact],
    ["refused", "signature", ZV.refused],
    ["failed", "envelope_missing", ZV.envelopeMissing],
    ["failed", "dead_letter", ZV.failed],
    ["failed", "queue_unavailable", ZV.failed],
    ["skipped", "client_gone", ZV.skipped],
    ["skipped", "redacted", ZV.skipped],
  ] as const)("%s / %s", (outcome, code, line) => expect(outcomeLine(outcome, code)).toBe(line));
  it("a rebuilt result and a request without one have no outcome line", () => {
    expect(outcomeLine("rebuilt", null)).toBeNull();
    expect(outcomeLine(null, null)).toBeNull();
  });
});

describe("rebuildLines", () => {
  it("nothing read, or never rebuilt: no lines", () => {
    expect(rebuildLines(null, { owner: true, day })).toEqual({ fact: null, status: null });
    expect(rebuildLines(state(), { owner: true, day })).toEqual({ fact: null, status: null });
  });
  it("the rebuilt fact, with the date and the first 12 characters, for every reader", () => {
    const s = state({ rebuiltAt: 5, served: { sha256: SHA }, history: [row("rebuilt")] });
    for (const owner of [true, false]) {
      const l = rebuildLines(s, { owner, day });
      expect(l.fact).toBe(ZV.rebuilt("day(5)", SHA.slice(0, FINGERPRINT_CHARS)));
      expect(l.fact).toContain("ab12cd34ef56.");
      expect(l.status).toBeNull();
    }
  });
  it("being rebuilt, for every reader, beside an earlier rebuild's fact", () => {
    const s = state({ rebuilding: true, rebuiltAt: 5, served: { sha256: SHA }, history: [row(null)] });
    for (const owner of [true, false]) {
      const l = rebuildLines(s, { owner, day });
      expect(l.status).toEqual({ tone: "busy", text: ZV.rebuilding });
      expect(l.fact).not.toBeNull();
    }
  });
  it("an outcome without a new file: the Owner only (it is theirs to act on)", () => {
    const s = state({ history: [row("refused", "signature")] });
    expect(rebuildLines(s, { owner: true, day }).status).toEqual({ tone: "problem", text: ZV.refused });
    expect(rebuildLines(s, { owner: false, day }).status).toBeNull();
    expect(
      rebuildLines(state({ history: [row("intact", "original_present")] }), { owner: true, day }).status,
    ).toEqual({
      tone: "quiet",
      text: ZV.intact,
    });
    expect(
      rebuildLines(state({ history: [row("failed", "envelope_missing")] }), { owner: true, day }).status
        ?.text,
    ).toBe(ZV.envelopeMissing);
    expect(
      rebuildLines(state({ history: [row("skipped", "redacted")] }), { owner: true, day }).status?.text,
    ).toBe(ZV.skipped);
  });
  it("only the newest request speaks: a later rebuilt result hides an earlier failure", () => {
    const s = state({
      rebuiltAt: 9,
      served: { sha256: SHA },
      history: [{ ...row("rebuilt"), n: 2 }, row("failed", "dead_letter")],
    });
    expect(rebuildLines(s, { owner: true, day }).status).toBeNull();
  });
});

describe("startedState", () => {
  it("puts the new request first, running, and keeps the earlier fact", () => {
    const prev = state({ rebuiltAt: 5, served: { sha256: SHA }, history: [row("rebuilt")] });
    const s = startedState(prev, { n: 2, found: "damaged" }, 100);
    expect(s.rebuilding).toBe(true);
    expect(s.history[0]).toMatchObject({ n: 2, found: "damaged", requestedAt: 100, outcome: null });
    expect(s.history).toHaveLength(2);
    expect(s.rebuiltAt).toBe(5);
    expect(startedState(null, { n: 1, found: "missing" }, 1).history).toHaveLength(1);
  });
  it("keeps at most 10 rows, as the API does", () => {
    const prev = state({ history: Array.from({ length: 10 }, () => row("failed")) });
    expect(startedState(prev, { n: 11, found: "missing" }, 1).history).toHaveLength(10);
  });
});

describe("who sees the button, and where each kind lives", () => {
  it("the Owner only (`pdfs.rebuild`)", () => {
    for (const role of ROLES) expect(decide(role, "pdfs.rebuild") !== "deny").toBe(role === "owner");
    expect(componentSource).toContain('allowed(useUser().role, "pdfs.rebuild")');
  });
  it("the routes' paths, as in the brief's table", () => {
    const paths = Object.fromEntries(REPAIR_KINDS.map((k) => [k, rebuildPath(k, "a/b")]));
    expect(paths).toEqual({
      offer: "/documents/a%2Fb/pdf",
      certificate: "/documents/a%2Fb/certificate",
      deed: "/deeds/a%2Fb/pdf",
      invoice: "/invoices/a%2Fb/pdf",
      supplier: "/invoices/a%2Fb/pdf/supplier",
      receipt: "/receipts/a%2Fb/pdf",
    });
  });
  it("a dialog title never shows an empty number", () => {
    expect(numberLabel(null)).toBe("Untitled");
    expect(numberLabel(" ")).toBe("Untitled");
    expect(numberLabel("TH/RC/2026-27/0001")).toBe("TH/RC/2026-27/0001");
  });
});
