// A whole document: supply, lines, discounts, tax, totals, round-off, words and the INR view [ADM-INV-05, ADM-EST-01/02,
// ADM-PROP-03, ADM-INV-08, ADM-INV-09, docs/05 §10]. VERIFY WITH CA/LEGAL (the rules are in supply.ts, lines.ts, totals.ts).
import type { TaxInput } from "../clients.ts";
import { isValidDate } from "../dates.ts";
import type { Currency } from "../money.ts";
import { isCurrency } from "../money.ts";
import { prepareLines, taxLines } from "./lines.ts";
import { determineSupply, type PlaceOfSupplyOverride } from "./supply.ts";
import { assemble } from "./totals.ts";
import {
  type CalendarDate,
  type ComputedDocument,
  type Discount,
  type ExportMode,
  type Fx,
  fail,
  guard,
  isInt,
  issue,
  type LineInput,
  ok,
  type Supply,
  type TaxContext,
  type TaxIssue,
  type TaxResult,
  type TaxWarning,
  uniqueIssues,
} from "./types.ts";

export type DocumentInput = {
  readonly currency: Currency;
  readonly documentDate: CalendarDate;
  /** The recipient: the supply is worked out from it. Exactly one of `recipient` and `supply`. */
  readonly recipient?: TaxInput | undefined;
  /** A fixed supply (credit and debit notes, an estimate turned into an invoice). */
  readonly supply?: Supply | undefined;
  /** Used with `recipient` only. */
  readonly placeOfSupplyOverride?: PlaceOfSupplyOverride | null | undefined;
  /** Used with `recipient` only. */
  readonly exportMode?: ExportMode | undefined;
  readonly lines: readonly LineInput[];
  readonly documentDiscount?: Discount | null | undefined;
  /** INR micros per USD, USD documents only. */
  readonly fx?: Fx | null | undefined;
};

/** FX rules (ADM-INV-08): none on INR, a rate of at least 1 micro on USD. */
export function fxIssues(currency: Currency, fx: Fx | null | undefined): TaxIssue[] {
  if (fx === null || fx === undefined) return [];
  if (currency === "INR") return [issue("fx_not_applicable", "fx")];
  return isInt(fx.rateMicros) && fx.rateMicros >= 1 ? [] : [issue("fx_invalid", "fx", "rateMicros")];
}

export type CoreArgs = {
  readonly currency: Currency;
  /** Missing only when `priorErrors` says why. */
  readonly supply: Supply | undefined;
  readonly lines: readonly LineInput[];
  readonly documentDiscount?: Discount | null | undefined;
  readonly fx?: Fx | null | undefined;
  readonly targetTotalMinor?: number | undefined;
  readonly unregisteredRecipient: boolean;
  readonly priorErrors: readonly TaxIssue[];
  readonly priorWarnings: readonly TaxWarning[];
};

/**
 * The shared pipeline (documents and inclusive splits): validate everything, collecting every error, then compute.
 * Not exported from the package index; may throw an overflow, so callers wrap it in `guard`.
 */
export function computeCore(args: CoreArgs, ctx: TaxContext): TaxResult<ComputedDocument> {
  const errors = [...args.priorErrors];
  if (!isCurrency(args.currency)) errors.push(issue("currency_invalid", "currency"));
  errors.push(...fxIssues(args.currency, args.fx));
  const lines = prepareLines(args.lines, args.documentDiscount, ctx);
  if (!lines.ok) errors.push(...lines.errors);
  if (errors.length > 0 || !lines.ok || args.supply === undefined) return fail(uniqueIssues(errors));

  const assembled = assemble(
    {
      currency: args.currency,
      supply: args.supply,
      lines: taxLines(lines.value, args.supply.type),
      fxRateMicros: args.fx ? args.fx.rateMicros : null,
      targetTotalMinor: args.targetTotalMinor,
      unregisteredRecipient: args.unregisteredRecipient,
    },
    ctx,
  );
  if (!assembled.ok) return assembled;
  return ok(assembled.value, [...args.priorWarnings, ...lines.warnings, ...assembled.warnings]);
}

/**
 * Computes a document from its lines. Never throws: bad input comes back as `{ ok: false, errors }` (every error found, as
 * codes and paths). Pass exactly one of `recipient` (the supply and place of supply are worked out) and `supply` (fixed).
 * Debit notes are this with `supply: original.supply` (their FX is M5.3's).
 */
export function computeDocument(input: DocumentInput, ctx: TaxContext): TaxResult<ComputedDocument> {
  return guard(() => {
    const errors: TaxIssue[] = [];
    const warnings: TaxWarning[] = [];
    const hasRecipient = input.recipient !== undefined;
    if (hasRecipient === (input.supply !== undefined)) errors.push(issue("recipient_or_supply_required"));
    if (!isValidDate(input.documentDate)) errors.push(issue("date_invalid", "documentDate"));
    let supply = input.supply;
    if (input.recipient !== undefined) {
      const found = determineSupply(input.recipient, ctx, {
        documentDate: input.documentDate,
        currency: input.currency,
        exportMode: input.exportMode,
        placeOfSupplyOverride: input.placeOfSupplyOverride,
      });
      if (found.ok) {
        supply = found.value;
        warnings.push(...found.warnings);
      } else {
        errors.push(...found.errors);
      }
    }
    return computeCore(
      {
        currency: input.currency,
        supply: errors.length > 0 ? undefined : supply,
        lines: input.lines,
        documentDiscount: input.documentDiscount,
        fx: input.fx,
        unregisteredRecipient: input.recipient?.gstStatus === "unregistered",
        priorErrors: errors,
        priorWarnings: warnings,
      },
      ctx,
    );
  });
}
