// The bank details form's pure parts (ADM-SET-02): the fields of one block, the same checks as the API worded for the
// form, and the PUT body. Every body carries `expectedUpdatedAt`, the `updatedAt` the form was opened with (null for an
// account not entered yet; the screen swaps in the one its own last save of the block returned), so a save over someone else's newer one is refused (409 `stale_version`, review M1).
import { ACCOUNT_NO, cleanAccountNo, IFSC, SWIFT } from "@techaust/core/bank";
import type { BankAccount, BankInput, BankKind } from "../api.ts";
import { checkPurposeCode } from "./invoice-types.ts";
import { orNull } from "./settings-form.ts";

export type BlockForm = {
  accountName: string;
  accountNo: string;
  accountNoAgain: string;
  ifsc: string;
  swift: string;
  bankName: string;
  branch: string;
  bankAddress: string;
  intermediary: string;
  /** M5.2 (LD30): the USD account's RBI purpose code. */
  purposeCode: string;
};

export const BANK_KINDS: readonly BankKind[] = ["INR", "USD_SWIFT"];

/** The id of a field in the form (also where a server error for that field lands). */
export const bankFieldId = (kind: BankKind, field: string) => `bank-${kind}-${field}`;

// Spaces and hyphens dropped, upper case: the same clean-up the Worker applies (core).
const clean = cleanAccountNo;

/** The form as it opens: what is stored, with both account number fields empty (empty keeps the stored number). */
export const toBlockForm = (a: Partial<BankAccount>): BlockForm => ({
  accountName: a.accountName ?? "",
  accountNo: "",
  accountNoAgain: "",
  ifsc: a.ifsc ?? "",
  swift: a.swift ?? "",
  bankName: a.bankName ?? "",
  branch: a.branch ?? "",
  bankAddress: a.bankAddress ?? "",
  intermediary: a.intermediary ?? "",
  purposeCode: a.purposeCode ?? "",
});

/** Has anything been typed into a block that has no account yet? (An untouched new block is skipped.) */
export const touchedBlock = (f: BlockForm) => Object.values(f).some((v) => v.trim() !== "");

/** The same checks as the API, worded for the form. Returns the errors (by field id) and the request body. */
export function checkBlock(kind: BankKind, f: BlockForm, account: BankAccount | undefined) {
  const exists = account?.exists ?? false;
  const fid = (field: string) => bankFieldId(kind, field);
  const e: Record<string, string> = {};
  const no = clean(f.accountNo);
  const again = clean(f.accountNoAgain);
  if (!f.accountName.trim()) e[fid("accountName")] = "Enter the account name.";
  if (!exists && !no) e[fid("accountNo")] = "Enter the account number.";
  else if (no && !ACCOUNT_NO.test(no))
    e[fid("accountNo")] = "Use letters and digits only, 5 to 34 characters.";
  // The same line as the API (review L8): an empty second field asks for it, a different one says they differ.
  if (no && !again) e[fid("accountNoAgain")] = "Type the account number again.";
  else if (no && no !== again) e[fid("accountNoAgain")] = "The two account numbers don't match.";
  if (kind === "INR" && !IFSC.test(clean(f.ifsc)))
    e[fid("ifsc")] = "An IFSC has 11 characters: 4 letters, a zero, then 6 letters or digits.";
  if (kind === "USD_SWIFT" && !SWIFT.test(clean(f.swift)))
    e[fid("swift")] = "A SWIFT/BIC has 8 or 11 letters and digits.";
  if (!f.bankName.trim()) e[fid("bankName")] = "Enter the bank's name.";
  if (kind === "USD_SWIFT" && !f.bankAddress.trim()) e[fid("bankAddress")] = "Enter the bank's address.";
  const purpose = kind === "USD_SWIFT" ? checkPurposeCode(f.purposeCode) : null;
  if (purpose && !purpose.ok) e[fid("purposeCode")] = purpose.error;
  const body: BankInput = {
    accountName: f.accountName.trim(),
    bankName: f.bankName.trim(),
    branch: orNull(f.branch),
    bankAddress: orNull(f.bankAddress),
    intermediary: orNull(f.intermediary),
    ...(kind === "INR"
      ? { ifsc: clean(f.ifsc) }
      : { swift: clean(f.swift), purposeCode: purpose?.ok ? purpose.value : null }),
    ...(no ? { accountNo: no, accountNoAgain: again } : {}),
    expectedUpdatedAt: exists ? (account?.updatedAt ?? null) : null,
  };
  return { errors: e, body };
}
