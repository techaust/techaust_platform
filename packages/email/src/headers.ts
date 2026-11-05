// Header sanitising (FRM-03): nothing a visitor typed may add a header line or break out of an address.
import { stripCrLf } from "@techaust/core";
import { escapeRegExp } from "@techaust/core/text";

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

/**
 * M7.2 (C.4, ADM-MAIL-03): the only extra headers a send may carry, by their canonical names. Neither is among the headers SES v2 refuses as custom headers
 * (CONFIRMED, SES Developer Guide "Amazon SES header fields": BCC, CC, Content-Disposition, Content-Type, Date, From, Message-ID, MIME-Version, Reply-To,
 * Return-Path, Subject, To), and SES overrides them only when `ListManagementOptions` is used, which we never send (CONFIRMED, "Using subscription management").
 */
export const ALLOWED_HEADERS = ["List-Unsubscribe", "List-Unsubscribe-Post"] as const;
/** A header value longer than this is dropped (RFC 5322's 998-character line limit, with room for the name). */
const HEADER_VALUE_MAX = 900;

/**
 * The extra headers of a send as SES v2 takes them (`[{Name, Value}]`): only the allow-listed names (any case in, the canonical name out; any other name is
 * dropped), each value through `headerValue` (control characters, CR, LF, U+2028 and U+2029 become a space), an empty or over-long value dropped.
 */
export function allowedHeaders(
  headers: Record<string, string> | undefined,
): { Name: string; Value: string }[] {
  const out: { Name: string; Value: string }[] = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    const canonical = ALLOWED_HEADERS.find((h) => h.toLowerCase() === name.toLowerCase());
    if (!canonical || typeof value !== "string") continue;
    const clean = headerValue(value);
    if (clean === "" || clean.length > HEADER_VALUE_MAX || out.some((h) => h.Name === canonical)) continue;
    out.push({ Name: canonical, Value: clean });
  }
  return out;
}

/** A message tag value SES accepts (CONFIRMED, SES API v2 `MessageTag.Value`: ASCII letters, digits, `_`, `-`; at most 256). */
const TAG_VALUE = /^[A-Za-z0-9_-]{1,256}$/;

/** The `EmailTags` of a send (L6): `env` when its value is one SES accepts (an unusable value is dropped rather than failing the send). */
export function emailTags(tags: { env: string } | undefined): { Name: string; Value: string }[] {
  return tags && TAG_VALUE.test(tags.env) ? [{ Name: "env", Value: tags.env }] : [];
}

/**
 * The RFC 8058 one-click headers of a non-transactional email (C.4, L8), or none: only when `url` is exactly our jobs Worker's `/u?t=<mac>.<user id>`
 * (`PUBLIC_HOOKS_URL` + `u?t=` + at least 20 base64url characters, a dot, a 36-character id), so a template's data can never point the header anywhere else.
 * `escapeRegExp` from core (review fix 13). The token travels in the query string (the documented exception, run file "Lead's notes"; Workers Logs redact query
 * strings, `redact_query_string`).
 */
export function unsubscribeHeaders(
  url: string | undefined,
  publicHooksUrl: string | undefined,
): Record<string, string> | undefined {
  if (!url || !publicHooksUrl) return undefined;
  const pattern = new RegExp(`^${escapeRegExp(publicHooksUrl)}u\\?t=[A-Za-z0-9_-]{20,}\\.[0-9a-f-]{36}$`);
  if (!pattern.test(url)) return undefined;
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
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
