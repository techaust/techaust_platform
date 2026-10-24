// Bank detail shapes [ADM-SET-02]: ONE place for the checks the admin Worker (authoritative) and the admin screen (early help)
// both run. An account number is letters and digits, 5 to 34 characters (IBAN-sized); the IFSC and SWIFT/BIC shapes are the
// published ones. Pure.

export const ACCOUNT_NO = /^[A-Z0-9]{5,34}$/;
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const SWIFT = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

/** Spaces and hyphens dropped, upper case: the form the number is checked and stored in. */
export const cleanAccountNo = (v: string): string => v.replace(/[\s-]/g, "").toUpperCase();
