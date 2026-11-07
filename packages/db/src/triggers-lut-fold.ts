// P7 LUT fold (run file docs/runs/p7-lut-fold.md; rt1 follow-up 1): the trigger set `lut_fold` (migration 0089), a custom data migration. No table is rebuilt.
//   1. The one letter of undertaking of M3 (`tax.lut {arn, fy}`) is folded into the M5.2 list `tax.luts` under exactly the M5.2 fold rule (core's former
//      `legacyLutFate`; written out below and twin-tested in `test/lut-fold-migration.test.ts`), then the `lut` key is removed from the `tax` row in every case.
//   2. `documents_advance_lut_fy` (0050) and `documents_debit_note_lut_fy` (0054) are dropped and created again from today's `LUT_FOR_FY_SQL`, which reads the
//      list only, so the triggers, the freeze WHEREs and core (`lutFor(fy, lutsOf(tax))`, `lutsFromStoredTax`) judge one list by one rule.
// The LUT rules themselves do not change, only where the letter is stored: Researched 2026-10-28, Rule 96A CGST Rules (08-C RA-19: one LUT per FY);
// Researched 2026-10-30, Rule 96A(1) CGST Rules, Notification 37/2017-CT (08-C RA-19, Q39). OPEN (08-C RA-19): the ARN's format, so only 1 to 30 letters and
// digits are checked, as the list does.
import { fyTokenOfDateSql, LUT_FOR_FY_SQL } from "./sql-rules.ts";

const abort = (message: string) => `SELECT RAISE(ABORT, '${message}');`;

/**
 * `documents_advance_lut_fy` from a LUT-for-FY text (`?FY` is replaced by the receipt day's FY token): a tax invoice for a payment received (`header_extras.advance`)
 * that is an export invoice on the LUT route is issued only while a LUT with an ARN is saved for the FY of the RECEIPT day (Researched 2026-10-28, Rule 96A(1) CGST
 * Rules, s.13(2) CGST Act (08-C RA-19, Q37)). 0050 installed it from `LUT_FOR_FY_SQL_0050`; 0089 from `LUT_FOR_FY_SQL`.
 */
export function advanceLutFyTrigger(lutForFySql: string): string {
  const issuing = "OLD.status = 'draft' AND NEW.status = 'issued'";
  const receivedOn = "json_extract(NEW.header_extras, '$.advance.receivedOn')";
  const lutBad = `${issuing} AND NEW.type = 'export_invoice' AND NEW.export_mode = 'lut' AND ${receivedOn} IS NOT NULL AND NOT ${lutForFySql.replaceAll("?FY", fyTokenOfDateSql(receivedOn))}`;
  return `CREATE TRIGGER \`documents_advance_lut_fy\` BEFORE UPDATE OF status ON \`documents\` WHEN ${lutBad} BEGIN ${abort("documents_advance_lut_fy: an export invoice under LUT for a payment received needs a LUT saved for the financial year of the day the payment arrived")} END;`;
}

/**
 * `documents_debit_note_lut_fy` from a LUT-for-FY text (`?FY` is replaced by the note's issue day's FY token): a debit note on an export under LUT is issued only
 * while a LUT with an ARN is saved for the FY of its OWN issue day (Researched 2026-10-30, Rule 96A(1) CGST Rules, Notification 37/2017-CT (08-C RA-19, Q39)).
 * 0054 installed it from `LUT_FOR_FY_SQL_0050`; 0089 from `LUT_FOR_FY_SQL`.
 */
export function debitNoteLutFyTrigger(lutForFySql: string): string {
  // The LUT route: the note's (or its invoice's) `export_mode` is 'lut', or its supply is `export_lut`. An export invoice issued on the settings' route leaves
  // `export_mode` empty (only a route typed on the draft is stored there), so the supply type is what says it went out under LUT.
  const lutRoute =
    "(NEW.export_mode IS 'lut' OR NEW.supply_type IS 'export_lut' OR EXISTS (SELECT 1 FROM documents p WHERE p.id = NEW.parent_id AND (p.export_mode IS 'lut' OR p.supply_type IS 'export_lut')))";
  const issuing = `OLD.status = 'draft' AND NEW.status = 'issued' AND NEW.type = 'debit_note' AND ${lutRoute}`;
  const lutBad = `(NEW.issue_date IS NULL OR NOT ${lutForFySql.replaceAll("?FY", fyTokenOfDateSql("NEW.issue_date"))})`;
  return `CREATE TRIGGER \`documents_debit_note_lut_fy\` BEFORE UPDATE OF status ON \`documents\` WHEN ${issuing} AND ${lutBad} BEGIN ${abort("documents_debit_note_lut_fy: a debit note on an export under LUT needs a LUT saved for the financial year of its own issue day")} END;`;
}

/**
 * What JavaScript's `\s` matches (core `normaliseLutArn` drops every one of them), as code points: tab, line feed, vertical tab, form feed, carriage return, space,
 * no-break space, ogham space, U+2000 to U+200A, line and paragraph separators, narrow no-break space, medium mathematical space, ideographic space and the BOM.
 */
export const JS_WHITESPACE_CODE_POINTS = [
  0x9, 0xa, 0xb, 0xc, 0xd, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
] as const;

/**
 * The only code points outside A-Z, a-z and 0-9 whose JavaScript `toUpperCase()` is made of A-Z alone (sharp s, dotless i, long s and the Latin ligatures): core
 * `normaliseLutArn` turns them into letters the list accepts, SQLite's `upper()` does not, so the fold spells them out first. Every other code point stays outside
 * A-Z and 0-9 after `toUpperCase()` in both, so it is refused in both. `test/lut-fold-migration.test.ts` recomputes both lists from the runtime.
 */
export const JS_UPPER_TO_ASCII = [
  [0xdf, "SS"],
  [0x131, "I"],
  [0x17f, "S"],
  [0xfb00, "FF"],
  [0xfb01, "FI"],
  [0xfb02, "FL"],
  [0xfb03, "FFI"],
  [0xfb04, "FFL"],
  [0xfb05, "ST"],
  [0xfb06, "ST"],
] as const;

/** The SQL twin of core `normaliseLutArn` (`arn.replace(/\s+/g, "").toUpperCase()`) for the text `expr`. */
export function normaliseLutArnSql(expr: string): string {
  let out = expr;
  for (const cp of JS_WHITESPACE_CODE_POINTS) out = `replace(${out}, char(${cp}), '')`;
  for (const [cp, upper] of JS_UPPER_TO_ASCII) out = `replace(${out}, char(${cp}), '${upper}')`;
  return `upper(${out})`;
}

/**
 * The fold of 0089, before the triggers are created again: the M5.2 rule of the old key, statement by statement.
 * - It folds only when `lut.arn` and `lut.fy` are both JSON strings (core read anything else as no letter), no entry of the list has that exact `fy` (`listed`:
 *   the list entry wins), the `fy` is four ASCII digits naming two consecutive years and the normalised ARN is 1 to 30 of A-Z and 0-9 (else `invalid`), and the
 *   list holds fewer than 20 (else `full`). A list that is missing gets one; a list that is not an array (a row no reader could parse) gets nothing.
 * - The folded entry is `{fy, arn: normalised, filedOn: null}`, appended last, as `foldLegacyLut` did.
 * - Then `lut` is removed in every case (a JSON null or garbage too) and `version` moves by one, so a tab holding the old version gets 409 and reloads.
 * Rows whose value is not valid JSON are left alone (the reads already refuse them): every JSON function reads `CASE WHEN json_valid(value) THEN value END`, which
 * is NULL for them, so no statement can fail on one whatever order SQLite evaluates the terms in. Run twice, the second run changes nothing (both statements need
 * the key). `length(CAST(x AS BLOB))` equals `length(x)` only for text of single-byte characters without a NUL (SQLite's `length` stops at a NUL, JavaScript's
 * does not).
 */
export function lutFoldBackfill(): string[] {
  const fy = "f.fy";
  const arn = "f.arn";
  const listType = "json_type(f.v, '$.luts')";
  const foldable = [
    "json_type(f.v, '$.lut.arn') = 'text'",
    "json_type(f.v, '$.lut.fy') = 'text'",
    `(${listType} = 'array' OR ${listType} IS NULL)`,
    `NOT EXISTS (SELECT 1 FROM json_each(f.v, '$.luts') l WHERE (CASE WHEN l.type = 'object' THEN json_extract(l.value, '$.fy') END) = ${fy})`,
    `length(${fy}) = 4 AND length(CAST(${fy} AS BLOB)) = 4 AND ${fy} NOT GLOB '*[^0-9]*'`,
    `(CAST(substr(${fy}, 1, 2) AS INTEGER) + 1) % 100 = CAST(substr(${fy}, 3, 2) AS INTEGER)`,
    `length(${arn}) BETWEEN 1 AND 30 AND length(CAST(${arn} AS BLOB)) = length(${arn}) AND ${arn} NOT GLOB '*[^A-Z0-9]*'`,
    `coalesce(json_array_length(f.v, '$.luts'), 0) < 20`,
  ].join("\n       AND ");
  const entry = `json_object('fy', ${fy}, 'arn', ${arn}, 'filedOn', NULL)`;
  const valid = "CASE WHEN json_valid(value) THEN value END";
  return [
    `UPDATE settings AS s SET value = CASE WHEN ${listType} = 'array' THEN json_insert(f.v, '$.luts[#]', ${entry}) ELSE json_insert(f.v, '$.luts', json_array(${entry})) END
     FROM (SELECT key, v, json_extract(v, '$.lut.fy') AS fy, ${normaliseLutArnSql("json_extract(v, '$.lut.arn')")} AS arn
           FROM (SELECT key, ${valid} AS v FROM settings WHERE key = 'tax')) AS f
     WHERE s.key = f.key
       AND ${foldable};`,
    `UPDATE settings SET value = json_remove(value, '$.lut'), version = version + 1 WHERE key = 'tax' AND json_type(${valid}, '$.lut') IS NOT NULL;`,
  ];
}

/** The statements of 0089: the fold, then the two LUT triggers dropped and created again from the list-only `LUT_FOR_FY_SQL`. */
export function lutFoldTriggerStatements(): string[] {
  return [
    ...lutFoldBackfill(),
    "DROP TRIGGER `documents_advance_lut_fy`;",
    advanceLutFyTrigger(LUT_FOR_FY_SQL),
    "DROP TRIGGER `documents_debit_note_lut_fy`;",
    debitNoteLutFyTrigger(LUT_FOR_FY_SQL),
  ];
}
