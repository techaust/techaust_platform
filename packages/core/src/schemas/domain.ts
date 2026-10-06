// Shared schemas for domain values (admin forms and the API), built on the pure validators.
import { z } from "zod";
import { type CalendarDate, parseIsoDate } from "../dates.ts";
import { isStateCode, type StateCode, validateGstin } from "../gstin.ts";
import { CURRENCIES, type Currency, type Money, parseMoney } from "../money.ts";

export const currency = z.enum(Object.keys(CURRENCIES) as [Currency, ...Currency[]]);

/** A stored amount: integer minor units (paise/cents). */
export const minorUnits = z.int({ error: "Amounts are whole paise or cents" }).refine(Number.isSafeInteger, {
  error: "That amount is too large",
});

/** What a person types into a money field ("1,23,456.50") → Money. */
export const moneyInput = (cur: Currency) =>
  z.string({ error: "Enter an amount" }).transform((value, ctx): Money => {
    const parsed = parseMoney(value, cur);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.error });
      return z.NEVER;
    }
    return parsed.value;
  });

/** A GSTIN, normalised to upper case; the state and PAN can then be derived with validateGstin. */
export const gstin = z.string({ error: "Enter the GSTIN" }).transform((value, ctx) => {
  const result = validateGstin(value);
  if (!result.ok) {
    ctx.addIssue({ code: "custom", message: result.error });
    return z.NEVER;
  }
  return result.gstin;
});

export const stateCode = z
  .string({ error: "Choose a state" })
  .refine((v): v is StateCode => isStateCode(v), { error: "Choose a state" });

/** A date input value ("2026-10-06") → CalendarDate. */
export const isoDate = z.string({ error: "Enter a date" }).transform((value, ctx): CalendarDate => {
  const date = parseIsoDate(value);
  if (!date) {
    ctx.addIssue({ code: "custom", message: "Enter a real date, like 2026-10-06" });
    return z.NEVER;
  }
  return date;
});
