// T7 screens [ADM-CLI-05, ADM-PROP-05]: an offer whose personal details were erased shows 07-ZG line 1 at the top, its PDF panel says line 2 with
// no action, it is never sent again ("Send again" and "Try again" gone, "Revoke links" kept), and the Erase or anonymise dialog says line 3 when
// the API answers 409 `too_many_offers`. The words are the approved ones, word for word, and the same as the API's.
import { describe, expect, it } from "vitest";
import pdfRouteSource from "../../worker/document-pdf.ts?raw";
import redactionSource from "../../worker/offer-redaction.ts?raw";
import dataToolsSource from "../routes/clients/data-tools.tsx?raw";
import pdfPanelSource from "../routes/documents/pdf-panel.tsx?raw";
import readSource from "../routes/documents/read.tsx?raw";
import { erasedBanner, isErased, PDF_ERASED_LINE, TOO_MANY_OFFERS_LINE } from "./copy-zg.ts";
import { canResend } from "./offers.ts";
import { pdfPhase } from "./pdf.ts";

describe("07-ZG, word for word", () => {
  it("line 1: the banner names the day of the newest erasure", () => {
    expect(erasedBanner("31 Oct 2026")).toBe(
      "Personal details erased on 31 Oct 2026. The number, status, dates and amounts are kept.",
    );
  });
  it("line 2 and line 3 are the API's messages for `pdf_erased` and `too_many_offers`", () => {
    expect(PDF_ERASED_LINE).toBe("The PDF was deleted when the personal details were erased.");
    expect(TOO_MANY_OFFERS_LINE).toBe(
      "This person is named on more than 10 offers, so they can't be anonymised in one go. Nothing was changed. Ask your developer to anonymise them in parts.",
    );
    expect(pdfRouteSource).toContain(`message: "${PDF_ERASED_LINE}"`);
    expect(redactionSource.replace(/\s+/g, " ")).toContain(`message: "${TOO_MANY_OFFERS_LINE}"`);
  });
});

describe("an erased offer", () => {
  it("is erased only when the API gives a time (absent and null are not)", () => {
    expect(isErased({ redactedAt: 1_800_000_000_000 })).toBe(true);
    expect(isErased({ redactedAt: null })).toBe(false);
    expect(isErased({})).toBe(false);
  });

  it("is never sent again, even while it is the latest open version", () => {
    const open = { status: "sent", validUntil: "2026-11-10" };
    expect(canResend(open, "2026-11-01", true)).toBe(true);
    expect(canResend({ ...open, redactedAt: null }, "2026-11-01", true)).toBe(true);
    expect(canResend({ ...open, redactedAt: 1_800_000_000_000 }, "2026-11-01", true)).toBe(false);
    expect(canResend({ ...open, status: "viewed", redactedAt: 1 }, "2026-11-01", true)).toBe(false);
  });

  it("its PDF panel says the PDF was deleted, at any time after the send, and offers nothing", () => {
    const t0 = 1_800_000_000_000;
    expect(pdfPhase("erased", t0, t0)).toBe("erased");
    expect(pdfPhase("erased", t0, t0 + 60 * 60_000)).toBe("erased");
    expect(pdfPhase("erased", null, t0)).toBe("erased");
    // the heading carries line 2; the download shows only when ready and "Try again" only when slow
    expect(pdfPanelSource).toMatch(/phase === "erased" \? PDF_ERASED_LINE : words\[phase\]/);
    expect(pdfPanelSource).toMatch(/\{phase === "ready" && \(\s*<a className="btn/);
    expect(pdfPanelSource).toMatch(/\{phase === "slow" && props\.canRetry && \(/);
    // it asks the API again only while the PDF is being made
    expect(pdfPanelSource).toMatch(/if \(phase !== "making"\) return;/);
  });

  it("the read view shows the banner from `redactedAt` in the screen's day format, and takes away the retry; Revoke links stays", () => {
    expect(readSource).toMatch(/const erasedAt = v\.redactedAt \?\? null;/);
    expect(readSource).toMatch(
      /\{erasedAt !== null && \(?\s*<Notice tone="info">\s*\{erasedBanner\(formatIstDay\(erasedAt\)\)\}/,
    );
    expect(readSource).toMatch(/canRetry=\{[^}]*&& !erased\}/);
    // "Send again" follows canResend, which reads `redactedAt` from the view; the delivery panel (and its "Revoke links") is still drawn
    expect(readSource).toMatch(/canResend=\{canResend\(v, /);
    expect(readSource).toMatch(/\{v\.delivery && v\.delivery\.length > 0 && \(\s*<DeliveryPanel/);
  });
});

describe("the Erase or anonymise dialog [ADM-CLI-05]", () => {
  it("shows 409 `too_many_offers` as its refusal, with line 3, and keeps the button off", () => {
    expect(dataToolsSource).toMatch(
      /e\.code === "on_issued_document" \|\| e\.code === "legal_hold" \|\| e\.code === "too_many_offers"/,
    );
    expect(dataToolsSource).toMatch(
      /e\.code === "too_many_offers" \? TOO_MANY_OFFERS_LINE : sentence\(e\.message\)/,
    );
    expect(dataToolsSource).toMatch(/blocked\?\.code === "too_many_offers"\s*\n?\s*\}/);
  });
});
