// A store-only ZIP writer for "Download all" (M5.5b, LD84; ADM-REP-04). In the browser only, no package: the files are the CSVs of a
// GSTR-1 pack, a few kilobytes each, so nothing is compressed. UTF-8 names (general-purpose flag bit 11), a fixed DOS date of
// 1 January 1980 so the same files give the same bytes, CRC-32 from an in-house table. Programming errors (an invalid name, more
// than 65,535 files, a file of 4 GiB or more) throw a RangeError; the caller's input is always the layouts' own file names.

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 (IEEE 802.3, as ZIP uses it) of some bytes, as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipFile = { readonly name: string; readonly text: string };

const DOS_TIME = 0;
/** 1980-01-01: year 0, month 1, day 1. */
const DOS_DATE = (1 << 5) | 1;
const UTF8_FLAG = 0x0800;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffff_ffff;

/** A size that must fit in the 32-bit fields of the format (a limit a browser can never reach with CSV text, so it is tested directly). */
export function checkU32(size: number, what: string): void {
  if (size > MAX_U32) throw new RangeError(`${what} too large for a ZIP archive`);
}

const nameIsValid = (name: string): boolean =>
  name !== "" &&
  !name.startsWith("/") &&
  !name.includes("\\") &&
  !name.includes("\u0000") &&
  !name.split("/").some((part) => part === ".." || part === "." || part === "");

/** The bytes of a store-only ZIP archive of text files, in the order given. */
export function storedZip(files: readonly ZipFile[]): Uint8Array {
  if (files.length > MAX_U16) throw new RangeError("Too many files for a ZIP archive");
  const encoder = new TextEncoder();
  const entries = files.map((f) => {
    if (!nameIsValid(f.name)) throw new RangeError(`Invalid file name: ${f.name}`);
    const name = encoder.encode(f.name);
    const data = encoder.encode(f.text);
    checkU32(data.length, "File");
    if (name.length > MAX_U16) throw new RangeError("File name too long for a ZIP archive");
    return { name, data, crc: crc32(data) };
  });

  const localSize = (e: { name: Uint8Array; data: Uint8Array }): number => 30 + e.name.length + e.data.length;
  const centralSize = (e: { name: Uint8Array }): number => 46 + e.name.length;
  const localTotal = entries.reduce((n, e) => n + localSize(e), 0);
  const centralTotal = entries.reduce((n, e) => n + centralSize(e), 0);
  checkU32(localTotal + centralTotal + 22, "Archive");

  const out = new Uint8Array(localTotal + centralTotal + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true); // version needed
    view.setUint16(at + 6, UTF8_FLAG, true);
    view.setUint16(at + 8, 0, true); // method: stored
    view.setUint16(at + 10, DOS_TIME, true);
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, e.crc, true);
    view.setUint32(at + 18, e.data.length, true);
    view.setUint32(at + 22, e.data.length, true);
    view.setUint16(at + 26, e.name.length, true);
    view.setUint16(at + 28, 0, true); // extra field length
    out.set(e.name, at + 30);
    out.set(e.data, at + 30 + e.name.length);
    at += localSize(e);
  }
  const centralStart = at;
  entries.forEach((e, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true); // version made by
    view.setUint16(at + 6, 20, true); // version needed
    view.setUint16(at + 8, UTF8_FLAG, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, DOS_TIME, true);
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, e.crc, true);
    view.setUint32(at + 20, e.data.length, true);
    view.setUint32(at + 24, e.data.length, true);
    view.setUint16(at + 28, e.name.length, true);
    view.setUint16(at + 30, 0, true); // extra
    view.setUint16(at + 32, 0, true); // comment
    view.setUint16(at + 34, 0, true); // disk number
    view.setUint16(at + 36, 0, true); // internal attributes
    view.setUint32(at + 38, 0, true); // external attributes
    view.setUint32(at + 42, offsets[i] as number, true);
    out.set(e.name, at + 46);
    at += centralSize(e);
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, centralTotal, true);
  view.setUint32(at + 16, centralStart, true);
  view.setUint16(at + 20, 0, true); // comment length
  return out;
}
