// PDF structure check (JOB-PDF-01, ADM-PROP-05). Browser Run once returned a PDF whose 8 KB blocks were out of order (the cross-reference
// offsets were wrong, no reader opened it). Pure: bytes in, a verdict out; it never puts document text into a message or a log.
// Checks, in order: the declared length, one `startxref` and one `%%EOF` in the last 1 KB, a classic cross-reference table (an xref stream
// fails closed) and no earlier revision (a trailer `/Prev` is `incremental`, except the one of a linearised file's first-page section),
// every entry landing on `N G obj`, every direct `/Length` landing on `endstream`, and the Adler-32 of every Flate stream of 8,192 bytes or
// more (a block moved inside one stream breaks it without moving any header), within an inflate budget per PDF.
// The bound (lead, 2026-10-29, docs/13; audit A6 finding 1): a smaller stream can't hold a moved 8 KB block, so it is not inflated; past
// `INFLATE_BUDGET_BYTES` of inflated output the remaining streams are not inflated and the PDF is accepted on the header, cross-reference and
// `/Length` checks alone (`partial`), never refused or retried for its size: a large signature image must never make a PDF unrenderable.
// Known limit, the same kind as `partial` (FX-3 round 3, item 4): a stream that is not Flate gets only its `/Length` check, so 8 KB blocks
// moved among themselves wholly inside one such stream move no header and pass. In our PDFs the only such stream is a JPEG signature
// (DCTDecode, invoice family; Chrome writes text, fonts, SVG and PNG images as Flate), and only one of 16 KB or more holds two whole blocks.
// Not fixed: JPEG's entropy-coded data carries no checksum and no structure a byte check can test without decoding the image (far past the
// 10 ms CPU budget). Comparing the stream with the JPEG the page embedded would work only if Browser Run copies JPEG bytes through
// unchanged, which is unverified; a wrong guess would refuse every invoice with a JPEG signature for ever. Test: pdf-integrity.test.ts.
// CPU (review round 2, finding 1): the check runs in a metered queue consumer, often in a cold isolate, so it reads the bytes directly.
// No text decoding of the file (a whole-file decode alone cost about 2 ms cold on a 204 KB PDF), no regular expression, no allocation per
// object; every search is the platform's native `Uint8Array.prototype.indexOf` / `lastIndexOf` on a byte that is rare in the keyword.
export type PdfIntegrityCode =
  | "length_mismatch"
  | "no_startxref"
  | "no_eof"
  | "incremental"
  | "xref_stream"
  | "xref_unreadable"
  | "xref_offset"
  | "stream_length"
  | "stream_checksum";

export type PdfIntegrity =
  | {
      ok: true;
      /** Present only when the inflate budget ran out: the bytes inflated and the eligible streams left unchecked (numbers only). */
      partial?: { inflated: number; skippedStreams: number };
    }
  | {
      ok: false;
      code: PdfIntegrityCode;
      bytes: number;
      /** The byte offset the check failed at (a cross-reference target, a stream end, a stream start), when it has one. */
      firstBadOffset: number | null;
      /** Where the object really is minus where the table says (xref_offset only). */
      displacement: number | null;
    };

/** Flate streams smaller than this are not inflated (their header and Length checks still run): the damage moves whole 8 KB blocks. */
export const INFLATE_MIN_BYTES = 8192;
/** The most output one check inflates, over all its streams (512 KiB, lead 2026-10-29: keeps the worst case inside the Free plan CPU). Past it the rest is accepted unchecked, see the head comment. */
export const INFLATE_BUDGET_BYTES = 524_288;

export type PdfIntegrityOptions = {
  /** The inflate budget in bytes (default `INFLATE_BUDGET_BYTES`); 0 inflates nothing. */
  inflateBudget?: number;
};

/** A keyword as bytes, with the index of the byte the native search looks for first (the rarest one in PDF text). */
type Word = { bytes: Uint8Array; anchor: number };
const word = (s: string, anchor = 0): Word => ({ bytes: Uint8Array.from(s, (c) => c.charCodeAt(0)), anchor });

const STARTXREF = word("startxref", 5); // the "x"
const EOF = word("%%EOF");
const STREAM = word("stream", 5); // the "m"
const ENDSTREAM = word("endstream", 8);
const XREF = word("xref");
const TRAILER = word("trailer");
const LENGTH = word("/Length", 6); // the "h": "/" and spaces are everywhere in a dictionary
const FLATE = word("/FlateDecode", 6); // the "D"
const PREV = word("/Prev", 4);
const LINEARIZED = word("/Linearized", 10);
const OBJ = word(" obj", 3); // the "j"

/** Inside the first object a linearised file says so (PDF 32000-1 Annex F); only then may it carry two `startxref` and two `%%EOF`. */
const LINEARISED_WITHIN = 1024;
/** The last `startxref` and `%%EOF` must sit this close to the end. */
const TAIL = 1024;
/** How far past `trailer` its dictionary's `/Prev` is looked for (up to the next `startxref`). */
const TRAILER_WITHIN = 4096;
/** How far back from `stream` its dictionary is looked for. */
const DICT_WITHIN = 1000;
/** A cross-reference entry is exactly 20 bytes (PDF 32000-1 7.5.4). */
const ENTRY = 20;

const isSpace = (c: number): boolean => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;

/** True when `w` is at exactly `at`. */
function isAt(b: Uint8Array, at: number, w: Word): boolean {
  const p = w.bytes;
  if (at < 0 || at + p.length > b.length) return false;
  for (let k = 0; k < p.length; k++) if (b[at + k] !== p[k]) return false;
  return true;
}

/** The first `w` starting in [from, to - length], or -1. */
function find(b: Uint8Array, w: Word, from = 0, to = b.length): number {
  const p = w.bytes;
  const a = w.anchor;
  const last = to - p.length;
  for (let i = b.indexOf(p[a] ?? 0, from + a); i !== -1; i = b.indexOf(p[a] ?? 0, i + 1)) {
    const s = i - a;
    if (s > last) return -1;
    if (b[s] === p[0] && isAt(b, s, w)) return s;
  }
  return -1;
}

/** The last `w` starting in [min, from], or -1. */
function findLast(b: Uint8Array, w: Word, from = b.length - w.bytes.length, min = 0): number {
  const p = w.bytes;
  const a = w.anchor;
  for (
    let i = b.lastIndexOf(p[a] ?? 0, from + a);
    i !== -1 && i - a >= min;
    i = i === 0 ? -1 : b.lastIndexOf(p[a] ?? 0, i - 1)
  ) {
    if (b[i - a] === p[0] && isAt(b, i - a, w)) return i - a;
  }
  return -1;
}

/** How many `w` start in [from, before). */
function countBefore(b: Uint8Array, w: Word, from: number, before: number): number {
  let n = 0;
  for (
    let k = find(b, w, from, before + w.bytes.length - 1);
    k !== -1;
    k = find(b, w, k + 1, before + w.bytes.length - 1)
  )
    n++;
  return n;
}

const skipSpace = (b: Uint8Array, at: number, end = b.length): number => {
  let i = at;
  while (i < end && isSpace(b[i] ?? 0)) i++;
  return i;
};

/** The unsigned integer at `at`: its value and where it ends, or null when there's no digit (or more than 15). */
function digitsAt(b: Uint8Array, at: number): { value: number; end: number } | null {
  let i = at;
  let value = 0;
  while (i < b.length && isDigit(b[i] ?? 0)) value = value * 10 + ((b[i++] ?? 0) - 48);
  return i === at || i - at > 15 ? null : { value, end: i };
}

/** The number after `key` and white space in [from, to), or null. */
function numberAfter(b: Uint8Array, key: Word, from: number, to: number): number | null {
  const k = find(b, key, from, to);
  return k === -1 ? null : (digitsAt(b, skipSpace(b, k + key.bytes.length, to))?.value ?? null);
}

/**
 * The object number of an `N G obj` header starting exactly at `at`, or -1. Called once per cross-reference entry, so it is one flat
 * function (no helper calls: a cold isolate interprets it, and every call costs there).
 */
function objectNumberAt(b: Uint8Array, at: number): number {
  const end = Math.min(b.length, at + 40);
  let i = at;
  let n = 0;
  let c = b[i] ?? 0;
  while (c >= 48 && c <= 57 && i < end) {
    n = n * 10 + (c - 48);
    c = b[++i] ?? 0;
  }
  if (i === at || i - at > 10) return -1;
  let mark = i;
  while ((c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0) && i < end) c = b[++i] ?? 0;
  if (i === mark) return -1;
  mark = i;
  while (c >= 48 && c <= 57 && i < end) c = b[++i] ?? 0;
  if (i === mark) return -1;
  mark = i;
  while ((c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0) && i < end) c = b[++i] ?? 0;
  if (i === mark) return -1;
  return c === 111 && b[i + 1] === 98 && b[i + 2] === 106 ? n : -1; // "obj"
}

/** The 10-digit offset of a cross-reference entry `oooooooooo ggggg n|f` at `at`, or -1. */
function entryOffset(b: Uint8Array, at: number): number {
  let n = 0;
  for (let i = at; i < at + 10; i++) {
    const c = b[i] ?? 0;
    if (c < 48 || c > 57) return -1;
    n = n * 10 + (c - 48);
  }
  return b[at + 10] === 32 && b[at + 16] === 32 ? n : -1;
}

type Inflated = { ok: boolean; out: number; complete: boolean };

/**
 * Inflates one zlib stream, stopping once `cap` bytes have come out (the platform emits small chunks on demand, so a cancel stops the work:
 * at most one chunk past the cap). `ok: false` is a broken stream (bad data or a wrong Adler-32); `complete: false` means it was cut short.
 */
async function inflate(data: Uint8Array, cap: number): Promise<Inflated> {
  let out = 0;
  try {
    const stream = new Blob([data.slice().buffer]).stream().pipeThrough(new DecompressionStream("deflate"));
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { ok: true, out, complete: true };
      out += value.byteLength;
      if (out > cap) {
        await reader.cancel().catch(() => undefined);
        return { ok: true, out, complete: false };
      }
    }
  } catch {
    return { ok: false, out, complete: false };
  }
}

type Bad = (
  code: PdfIntegrityCode,
  firstBadOffset?: number | null,
  displacement?: number | null,
) => PdfIntegrity;

/**
 * Reads the classic cross-reference section at `xrefAt` and checks that every in-use entry lands on its `N G obj`. Returns where its
 * trailer keyword starts, or the failure. The entry count is bounded by the bytes left, so a broken count can't spin the loop.
 */
function checkXrefSection(b: Uint8Array, xrefAt: number, bad: Bad): number | PdfIntegrity {
  const size = b.length;
  if (!(xrefAt >= 0 && xrefAt < size)) return bad("xref_unreadable", xrefAt);
  if (!isAt(b, xrefAt, XREF) || !isSpace(b[xrefAt + 4] ?? 65))
    return objectNumberAt(b, xrefAt) === -1 ? bad("xref_unreadable", xrefAt) : bad("xref_stream", xrefAt);
  // Subsections: a `first count` line, then count entries of 20 bytes.
  let at = xrefAt + 4;
  for (;;) {
    const h = skipSpace(b, at);
    const first = digitsAt(b, h);
    if (first === null) break;
    const c = skipSpace(b, first.end);
    const count = c === first.end ? null : digitsAt(b, c);
    if (count === null) return bad("xref_unreadable", h);
    const entries = skipSpace(b, count.end);
    if (b[entries - 1] !== 10 && b[entries - 1] !== 13) return bad("xref_unreadable", h); // the line ends before the entries
    at = entries;
    if (count.value > (size - at) / ENTRY) return bad("xref_unreadable", at);
    for (let i = 0; i < count.value; i++) {
      const e = at + i * ENTRY;
      const offset = entryOffset(b, e);
      const kind = b[e + 17];
      if (offset === -1 || (kind !== 110 && kind !== 102)) return bad("xref_unreadable", e);
      if (kind === 102) continue; // "f": a free entry points at nothing
      const num = first.value + i;
      if (objectNumberAt(b, offset) !== num) {
        const real = find(b, word(`\n${num} 0 obj`, 1)); // the failure path only
        return bad("xref_offset", offset, real === -1 ? null : real + 1 - offset);
      }
    }
    at += count.value * ENTRY;
  }
  const t = skipSpace(b, at);
  return isAt(b, t, TRAILER) ? t : bad("xref_unreadable", at);
}

/** Checks the structure of one PDF. `declaredLength` is the response's content-length when it had one. Never throws. */
export async function checkPdfIntegrity(
  bytes: Uint8Array,
  declaredLength: number | null = null,
  options: PdfIntegrityOptions = {},
): Promise<PdfIntegrity> {
  const asked = options.inflateBudget ?? INFLATE_BUDGET_BYTES;
  const budget = Number.isFinite(asked) ? Math.max(0, asked) : INFLATE_BUDGET_BYTES; // never unbounded
  let inflated = 0;
  let skippedStreams = 0;
  const b = bytes;
  const size = b.byteLength;
  const bad: Bad = (code, firstBadOffset = null, displacement = null) => ({
    ok: false,
    code,
    bytes: size,
    firstBadOffset,
    displacement,
  });
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength !== size)
    return bad("length_mismatch");

  // The end of the file: its last `startxref` and `%%EOF` sit in the last 1 KB, with no other one there. Only the end is searched (a
  // whole-file search costs a cold isolate about 0.5 ms): an earlier revision is found by its trailer's `/Prev` below instead.
  const tail = Math.max(0, size - TAIL);
  const lastStart = findLast(b, STARTXREF, size - STARTXREF.bytes.length, tail);
  if (lastStart === -1) return bad("no_startxref");
  const lastEof = findLast(b, EOF, size - EOF.bytes.length, tail);
  if (lastEof === -1) return bad("no_eof");
  const linearised = find(b, LINEARIZED, 0, Math.min(size, LINEARISED_WITHIN)) !== -1;
  // A linearised file shorter than 2 KB can hold both of its `startxref` (and `%%EOF`) in the last 1 KB.
  const allowed = linearised && size < 2 * TAIL ? 1 : 0;
  if (countBefore(b, STARTXREF, tail, lastStart) > allowed || countBefore(b, EOF, tail, lastEof) > allowed)
    return bad("incremental");
  const pointer = digitsAt(b, skipSpace(b, lastStart + STARTXREF.bytes.length));
  if (pointer === null) return bad("no_startxref");

  // Every cross-reference section, by the trailers' `/Prev` chain (PDF 32000-1 7.5.6). A single-revision file has one section and no
  // `/Prev`; an incremental update adds a section whose trailer names the one before, so a `/Prev` is `incremental` (fails closed). A
  // linearised file (Annex F) has exactly two: the last `startxref` points at the first-page section, whose `/Prev` names the main one.
  const sections = linearised ? 2 : 1;
  let xrefAt = pointer.value;
  const seen: number[] = [];
  for (;;) {
    seen.push(xrefAt);
    const trailer = checkXrefSection(b, xrefAt, bad);
    if (typeof trailer !== "number") return trailer;
    const stop = find(b, STARTXREF, trailer, Math.min(size, trailer + TRAILER_WITHIN));
    const prev = numberAfter(b, PREV, trailer, stop === -1 ? Math.min(size, trailer + TRAILER_WITHIN) : stop);
    if (prev === null) break;
    if (seen.length === sections) return bad("incremental", prev);
    if (seen.includes(prev)) return bad("xref_unreadable", prev);
    xrefAt = prev;
  }

  // The streams. A direct /Length must land on `endstream`; the data is then skipped, so binary never reads as a keyword.
  let from = 0;
  for (;;) {
    const keyword = find(b, STREAM, from);
    if (keyword === -1) break;
    let start = keyword + STREAM.bytes.length;
    const eol = b[start];
    if (eol === 13 && b[start + 1] === 10) start += 2;
    else if (eol === 10) start += 1;
    else {
      from = start; // "stream" inside a word or a name, not the keyword
      continue;
    }
    if (keyword >= 3 && b[keyword - 3] === 101 && b[keyword - 2] === 110 && b[keyword - 1] === 100) {
      from = start; // "endstream"
      continue;
    }
    // The dictionary: from the nearest ` obj` before the keyword (within DICT_WITHIN bytes) to the keyword.
    const window = Math.max(0, keyword - DICT_WITHIN);
    const obj = findLast(b, OBJ, keyword - OBJ.bytes.length, window);
    const dictAt = obj === -1 ? window : obj;
    let length: number | null = null;
    for (let k = find(b, LENGTH, dictAt, keyword); k !== -1; k = find(b, LENGTH, k + 1, keyword)) {
      const v = k + LENGTH.bytes.length;
      if (!isSpace(b[v] ?? 65)) continue; // /Length1, /Length2, /Length3 of a font file
      const n = digitsAt(b, skipSpace(b, v, keyword));
      if (n === null) break;
      // `/Length 12 0 R` is an indirect length: the stream end is then found by its keyword
      const g = skipSpace(b, n.end, keyword);
      const gen = g === n.end ? null : digitsAt(b, g);
      const r = gen === null ? -1 : skipSpace(b, gen.end, keyword);
      if (gen === null || r === gen.end || b[r] !== 82) length = n.value;
      break;
    }
    let end: number; // where the data ends
    let next: number; // just past `endstream`
    if (length === null) {
      end = find(b, ENDSTREAM, start);
      if (end === -1) return bad("stream_length", start);
      next = end + ENDSTREAM.bytes.length;
    } else {
      end = start + length;
      let e = end;
      if (b[e] === 13)
        e += b[e + 1] === 10 ? 2 : 1; // PDF 32000-1 7.3.8.1: an EOL before `endstream` (CR alone included), or none
      else if (b[e] === 10) e += 1;
      if (end > size || !isAt(b, e, ENDSTREAM)) return bad("stream_length", end);
      next = e + ENDSTREAM.bytes.length;
    }
    if (length !== null && end - start >= INFLATE_MIN_BYTES && find(b, FLATE, dictAt, keyword) !== -1) {
      if (inflated >= budget) skippedStreams += 1;
      else {
        const r = await inflate(b.subarray(start, end), budget - inflated);
        inflated += r.out;
        if (!r.ok) return bad("stream_checksum", start);
        if (!r.complete) skippedStreams += 1;
      }
    }
    from = next; // past `endstream`, so its "stream" is not read again
  }
  return skippedStreams === 0 ? { ok: true } : { ok: true, partial: { inflated, skippedStreams } };
}
