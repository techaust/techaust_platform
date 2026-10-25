// Upload rules for project and client files [ADM-PRJ-04, docs/08 threat-model row "Files"]. Pure: the route reads the first bytes of
// the body and asks here. The type is decided by the BYTES (an allow-list of signatures) and has to agree with the extension; the
// MIME type stored and served is ours, never the one the browser claimed. No SVG, HTML, scripts or executables are on the list.

export const MAX_UPLOAD_BYTES = 26_214_400; // 25 MiB (the files table has the same check)
export const SNIFF_BYTES = 512;

/** extension -> the canonical MIME type served for it. `jpeg` is an alias of `jpg`. */
export const FILE_MIME = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
  csv: "text/csv",
  txt: "text/plain",
} as const;
export type FileExt = keyof typeof FILE_MIME;
type Family = "pdf" | "png" | "jpg" | "webp" | "zip" | "text";
const FAMILY: Record<FileExt, Family> = {
  pdf: "pdf",
  png: "png",
  jpg: "jpg",
  webp: "webp",
  docx: "zip",
  xlsx: "zip",
  zip: "zip",
  csv: "text",
  txt: "text",
};

export type SniffResult =
  | { ok: true; ext: FileExt; mime: string }
  | { ok: false; reason: "empty" | "type_not_allowed" | "type_mismatch" };

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The binary family the bytes announce, or null when no known signature is there. */
function signature(head: Uint8Array): Family | null {
  if (startsWith(head, ascii("%PDF-"))) return "pdf";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8)) return "webp";
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  return null;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });
/** Text: valid UTF-8 (a character cut by the end of the sample is fine), no NUL and no other binary control byte. */
function isText(head: Uint8Array): boolean {
  for (const v of head) if (v < 0x20 && v !== 0x09 && v !== 0x0a && v !== 0x0c && v !== 0x0d) return false;
  try {
    UTF8.decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/** The extension in lower case without its dot ("" when there is none). */
export const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};

/**
 * Whether `head` (the first up to 512 bytes of the file) is what `ext` says it is. docx, xlsx and zip share one container
 * signature and are told apart by the extension alone (no unzipping). A text type must be UTF-8 without binary signatures.
 */
export function sniffFileType(head: Uint8Array, extension: string): SniffResult {
  const raw = extension.replace(/^\./, "").toLowerCase();
  const ext = (raw === "jpeg" ? "jpg" : raw) as FileExt;
  if (!Object.hasOwn(FILE_MIME, ext)) return { ok: false, reason: "type_not_allowed" };
  if (head.length === 0) return { ok: false, reason: "empty" };
  const family = FAMILY[ext];
  const sig = signature(head);
  const same = family === "text" ? sig === null && isText(head) : sig === family;
  return same ? { ok: true, ext, mime: FILE_MIME[ext] } : { ok: false, reason: "type_mismatch" };
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// Control characters, the bidi controls (U+202A-202E, U+2066-2069, U+200E, U+200F, U+061C) and the zero-width ones.
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu;
const MAX_NAME = 120;

/**
 * A name that is safe to store, to show and to put in a header: NFC; only the last path segment; no control, bidi or zero-width
 * characters; `<>:"|?*` become `_`; no leading dots or trailing dots and spaces; a Windows device name gets a `_` in front; at most
 * 120 characters with the extension kept. When nothing is left the name is `file` plus the original extension.
 */
export function sanitiseFilename(name: string): string {
  const segment = name.normalize("NFC").split(/[\\/]/).pop() ?? "";
  const cleaned = segment.replace(UNSAFE, "").trim();
  // a name that is only an extension (".pdf") keeps it
  const bare = /^\.+([A-Za-z0-9]{1,10})$/.exec(cleaned);
  if (bare) return `file.${(bare[1] as string).toLowerCase()}`;
  let s = cleaned
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  const dot = s.lastIndexOf(".");
  const ext = dot > 0 && /^[A-Za-z0-9]{1,10}$/.test(s.slice(dot + 1)) ? s.slice(dot) : "";
  let base = ext ? s.slice(0, dot) : s;
  if (RESERVED.test(base.split(".")[0] ?? "")) base = `_${base}`;
  const room = MAX_NAME - ext.length;
  const chars = Array.from(base);
  if (chars.length > room) base = chars.slice(0, room).join("");
  s = `${base}${ext}`;
  if (base.trim() === "") return "file";
  return s;
}

/** `attachment; filename="<ascii>"; filename*=UTF-8''<percent-encoded>` (RFC 6266 and 8187): never inline. */
export function contentDisposition(name: string): string {
  const asciiName = name.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  const pct = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${pct}`;
}

/** The R2 key: the client and the file id, never a filename. */
export const fileKey = (clientId: string, fileId: string) => `files/${clientId}/${fileId}`;
