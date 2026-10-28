// A whole document: supply, lines, discounts, tax, totals, round-off, words and the INR view [ADM-INV-05, ADM-EST-01/02,
// ADM-PROP-03, ADM-INV-08, ADM-INV-09, docs/05 §10]. Researched 2026-10-28, rule by rule in 08-C section 1 (the rules are in supply.ts, lines.ts, totals.ts).
import type { TaxInput } from "../clients.ts";
import type { Currency } from "../money.ts";
import { isCurrency } from "../money.ts";
import { prepareLines, taxLines } from "./lines.ts";
import {
  determineSupply,
  fixedSupplyWarnings,
  type PlaceOfSupplyOverride,
  recipientStatusIssues,
  supplyIssues,
  usableDate,
} from "./supply.ts";
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
  type RecipientStatus,
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
  /** Used with `recipient` only: with a fixed `supply` it is `supply_invalid`. */
  readonly placeOfSupplyOverride?: PlaceOfSupplyOverride | null | undefined;
  /** Used with `recipient` only: with a fixed `supply` it is `supply_invalid`. */
  readonly exportMode?: ExportMode | undefined;
  /**
   * With a fixed `supply` only (with a recipient it is `supply_invalid`): who the document is for, so the B2C details warning
   * can be given. An overseas status goes with an export supply, the others with a domestic one.
   */
  readonly recipientStatus?: RecipientStatus | undefined;
  /**
   * With a fixed `supply` only: the line rates come from a source document (a debit note at the original's rate, an inclusive
   * split recomputed), so today's `allowLineOverride` is not applied to them. With a recipient it is `supply_invalid`.
   */
  readonly trustRates?: boolean | undefined;
  /**
   * With a fixed `supply` only: sets the total instead of rounding (the same band and whole-unit rules as the final credit
   * note and the inclusive split). With a recipient it is `supply_invalid`.
   */
  readonly targetTotalMinor?: number | undefined;
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
  /** The line rates come from a source document (inclusive splits): the override switch is not applied again. */
  readonly trustRates?: boolean;
};

/**
 * The shared pipeline (documents and inclusive splits): validate everything, collecting every error, then compute.
 * Not exported from the package index; may throw an overflow, so callers wrap it in `guard`.
 */
export function computeCore(args: CoreArgs, ctx: TaxContext): TaxResult<ComputedDocument> {
  const errors = [...args.priorErrors];
  if (!isCurrency(args.currency)) errors.push(issue("currency_invalid", "currency"));
  errors.push(...fxIssues(args.currency, args.fx));
  const lines = prepareLines(args.lines, args.documentDiscount, ctx, args.trustRates === true);
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
 * codes and paths). Pass exactly one of `recipient` (the supply and place of supply are worked out) and `supply` (fixed, checked with
 * `supplyIssues`; `exportMode` and `placeOfSupplyOverride` are not allowed beside it).
 * Debit notes are this with `supply: original.supply` (their FX is M5.3's).
 */
export function computeDocument(input: DocumentInput, ctx: TaxContext): TaxResult<ComputedDocument> {
  return guard(() => {
    const errors: TaxIssue[] = [];
    const warnings: TaxWarning[] = [];
    const hasRecipient = input.recipient !== undefined;
    if (hasRecipient === (input.supply !== undefined)) errors.push(issue("recipient_or_supply_required"));
    if (!usableDate(input.documentDate)) errors.push(issue("date_invalid", "documentDate"));
    let supply = input.supply;
    if (input.supply !== undefined && !hasRecipient) {
      errors.push(...supplyIssues(input.supply, "supply"));
      // A fixed supply is final: a mode or an override beside it would be silently ignored, so it is refused.
      if (input.exportMode !== undefined) errors.push(issue("supply_invalid", "exportMode"));
      if (input.placeOfSupplyOverride) errors.push(issue("supply_invalid", "placeOfSupplyOverride"));
      errors.push(...recipientStatusIssues(input.recipientStatus, input.supply, "recipientStatus"));
      if (errors.length === 0 && usableDate(input.documentDate)) {
        warnings.push(...fixedSupplyWarnings(input.supply, input.documentDate, ctx));
      }
    } else if (hasRecipient) {
      // These belong to a fixed supply: beside a recipient they would be silently ignored, so they are refused.
      if (input.recipientStatus !== undefined) errors.push(issue("supply_invalid", "recipientStatus"));
      if (input.trustRates) errors.push(issue("supply_invalid", "trustRates"));
      if (input.targetTotalMinor !== undefined) errors.push(issue("supply_invalid", "targetTotalMinor"));
    }
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
        targetTotalMinor: input.targetTotalMinor,
        trustRates: input.trustRates === true,
        unregisteredRecipient: (input.recipient?.gstStatus ?? input.recipientStatus) === "unregistered",
        priorErrors: errors,
        priorWarnings: warnings,
      },
      ctx,
    );
  });
}
