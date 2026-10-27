// The API messages of the M5.2 codes are the 07-S §8 lines, word for word (review 3). A change of a line must fail this test until the copy has been
// looked at. `export_declaration_tampered` has no 07-S line yet: it stays `[Placeholder]` (flagged to the lead), and nothing else may.
import { describe, expect, it } from "vitest";
import * as model from "./invoice-model.ts";

const NOT_APPLICABLE = "This doesn't apply to this type of invoice.";

const LINES: ReadonlyArray<[{ code: string; message: string }, string, string]> = [
  [
    model.ADVANCE_DATE_INVALID,
    "advance_date_invalid",
    "The date received can't be before the proforma's date or in the future.",
  ],
  [model.ALREADY_SET, "already_set", "The service completion date is already set and can't be changed."],
  [model.SERVICE_DATE_FUTURE, "service_date_future", "The service completion date can't be in the future."],
  [model.SERVICE_DATE_NOT_APPLICABLE, "service_date_not_applicable", NOT_APPLICABLE],
  [model.EXPORT_MODE_NOT_APPLICABLE, "export_mode_not_applicable", NOT_APPLICABLE],
  [model.EXPORT_DECLARATION_NOT_APPLICABLE, "export_declaration_not_applicable", NOT_APPLICABLE],
  [
    model.EXPORT_DECLARATION_MISSING,
    "export_declaration_missing",
    "The export note in Settings › Terms was removed. Choose again.",
  ],
  [
    model.EXPORT_DECLARATION_CHANGED,
    "export_declaration_changed",
    "The export note in Settings › Terms changed since this draft was saved. Save the draft again.",
  ],
  [model.INVOICE_VOID, "invoice_void", "This invoice is void."],
  [model.FX_NOT_APPLICABLE, "fx_not_applicable", "An exchange rate is only needed for USD invoices."],
];

describe("the M5.2 API messages are the 07-S §8 lines", () => {
  it.each(LINES)("%#: %s", (made, code, message) => {
    expect(made.code).toBe(code);
    expect(made.message).toBe(message);
  });

  it("only export_declaration_tampered is still a placeholder (07-S has no line for it yet)", () => {
    const placeholders = Object.entries(model)
      .filter(([, v]) => typeof v === "object" && v !== null && "message" in v && "code" in v)
      .filter(([, v]) => String((v as { message: string }).message).includes("[Placeholder]"))
      .map(([, v]) => (v as { code: string }).code);
    expect(placeholders).toEqual(["export_declaration_tampered"]);
  });
});
