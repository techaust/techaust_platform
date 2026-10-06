// Reusable field rules for the shared form schemas [FRM-01]. Error messages follow docs/07 §forms.
import { z } from "zod";

// C0/C1 control characters. Single-line fields reject all of them (this also blocks CR/LF reaching an
// email header, FRM-03); multi-line fields allow only tab, line feed and carriage return.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_EXCEPT_NEWLINES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** A trimmed single-line text field (names, company): Unicode letters welcome, control characters not. */
export const singleLine = (opts: { max: number; required: string; min?: number; tooShort?: string }) =>
  z
    .string({ error: opts.required })
    .refine((v) => !CONTROL.test(v), { error: "Remove special characters such as line breaks" })
    .transform((v) => v.trim().normalize("NFC"))
    .pipe(
      z
        .string()
        .min(opts.min ?? 1, { error: opts.min ? (opts.tooShort ?? opts.required) : opts.required })
        .max(opts.max, { error: `Keep this under ${opts.max} characters` }),
    );

/** A trimmed multi-line text field (messages, goals). */
export const multiLine = (opts: { min: number; max: number; required: string; tooShort: string }) =>
  z
    .string({ error: opts.required })
    .refine((v) => !CONTROL_EXCEPT_NEWLINES.test(v), { error: "Remove special characters" })
    .transform((v) => v.replace(/\r\n?/g, "\n").trim().normalize("NFC"))
    .pipe(
      z
        .string()
        .min(1, { error: opts.required })
        .min(opts.min, { error: opts.tooShort })
        .max(opts.max, { error: `Keep this under ${opts.max.toLocaleString("en-IN")} characters` }),
    );

/** Optional: an empty or blank value becomes `undefined`. */
export const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

export const name = singleLine({ max: 100, required: "Enter your name" });

export const email = z
  .string({ error: "Enter an email address like name@company.com" })
  .trim()
  .toLowerCase()
  .max(254, { error: "Enter an email address like name@company.com" })
  .pipe(z.email({ error: "Enter an email address like name@company.com" }));

export const company = singleLine({ max: 120, required: "Enter your company" });

/** Phone or WhatsApp: digits with optional +, spaces, dashes, dots and brackets; 7–15 digits (E.164). */
export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ().-]+$/, { error: "Enter a phone number like +91 98765 43210" })
  .refine(
    (v) => {
      const digits = v.replace(/\D/g, "").length;
      return digits >= 7 && digits <= 15;
    },
    { error: "Enter a phone number like +91 98765 43210" },
  );

/** ISO 3166-1 alpha-2, e.g. "IN", "GB", "US". */
export const country = z
  .string({ error: "Choose your country" })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, { error: "Choose your country" });

/** An HTML checkbox: "on"/"true"/true when ticked; missing when not. Never pre-ticked (FRM-05). */
export const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());
