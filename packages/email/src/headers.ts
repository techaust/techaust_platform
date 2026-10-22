// Header sanitising (FRM-03): nothing a visitor typed may add a header line or break out of an address.
import { stripCrLf } from "@techaust/core";

/** A plain header value (subject): control characters (CR, LF) removed. */
export const headerValue = (value: string): string => stripCrLf(value);

/** A display name as a quoted string: control characters removed, backslash and quote escaped. */
export function quoteDisplayName(name: string): string {
  return `"${stripCrLf(name).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const ADDRESS = /^[^\s@<>",;:()[\]\\]+@[^\s@<>",;:()[\]\\]+$/;

/** `"Name" <address>`; throws if the address could carry anything but an address. */
export function formatAddress(name: string | undefined, address: string): string {
  const clean = stripCrLf(address);
  if (clean !== address || !ADDRESS.test(clean)) throw new Error("Invalid email address");
  return name ? `${quoteDisplayName(name)} <${clean}>` : clean;
}

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
