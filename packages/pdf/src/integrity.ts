// PDF structure check (JOB-PDF-01, ADM-PROP-05). Browser Run once returned a PDF whose 8 KB blocks were out of order (the cross-reference
// offsets were wrong, no reader opened it). Pure: bytes in, a verdict out; it never puts document text into a message or a log.
// Checks, in order: the declared length, one `startxref` and `%%EOF`, a classic cross-reference table (an xref stream fails closed), every
// entry landing on `N G obj`, every direct `/Length` landing on `endstream`, and the Adler-32 of every Flate stream of 4,096 bytes or more
// (a block moved inside one stream breaks it without moving any header).
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
  | { ok: true }
  | {
      ok: false;
      code: PdfIntegrityCode;
      bytes: number;
      /** The byte offset the check failed at (a cross-reference target, a stream end, a stream start), when it has one. */
      firstBadOffset: number | null;
      /** Where the object really is minus where the table says (xref_offset only). */
      displacement: number | null;
    };

/** Streams smaller than this are not inflated (their header and Length checks still run). */
export const INFLATE_MIN_BYTES = 4096;

const latin1 = new TextDecoder("latin1"); // one char per byte, so a string index is a byte offset

async function inflates(data: Uint8Array): Promise<boolean> {
  try {
    const stream = new Blob([data.slice().buffer]).stream().pipeThrough(new DecompressionStream("deflate"));
    const reader = stream.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) return true;
    }
  } catch {
    return false;
  }
}

/** Checks the structure of one PDF. `declaredLength` is the response's content-length when it had one. Never throws. */
export async function checkPdfIntegrity(
  bytes: Uint8Array,
  declaredLength: number | null = null,
): Promise<PdfIntegrity> {
  const size = bytes.byteLength;
  const bad = (
    code: PdfIntegrityCode,
    firstBadOffset: number | null = null,
    displacement: number | null = null,
  ): PdfIntegrity => ({ ok: false, code, bytes: size, firstBadOffset, displacement });
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength !== size)
    return bad("length_mismatch");
  const text = latin1.decode(bytes);

  const starts = [...text.matchAll(/startxref\s+(\d+)/g)];
  if (starts.length === 0) return bad("no_startxref");
  if (starts.length > 1) return bad("incremental");
  if (!text.slice(Math.max(0, size - 1024)).includes("%%EOF")) return bad("no_eof");
  if ([...text.matchAll(/%%EOF/g)].length > 1) return bad("incremental");
  const xrefAt = Number(starts[0]?.[1]);
  if (!(xrefAt >= 0 && xrefAt < size)) return bad("xref_unreadable", xrefAt);
  if (!/^xref\s/.test(text.slice(xrefAt, xrefAt + 8))) {
    return /^\d+\s+\d+\s+obj/.test(text.slice(xrefAt, xrefAt + 24))
      ? bad("xref_stream", xrefAt)
      : bad("xref_unreadable", xrefAt);
  }

  // The table: subsections of `first count` followed by count entries of 20 bytes.
  let at = xrefAt + 4;
  for (;;) {
    const head = /^\s*(\d+)\s+(\d+)\s*\r?\n/.exec(text.slice(at, at + 40));
    if (head === null) break;
    const first = Number(head[1]);
    const count = Number(head[2]);
    at += head[0].length;
    for (let i = 0; i < count; i++) {
      const entry = text.slice(at + i * 20, at + i * 20 + 20);
      if (entry.length < 18 || entry[17] !== "n") continue;
      const offset = Number(entry.slice(0, 10));
      const num = first + i;
      if (!new RegExp(`^${num}\\s+\\d+\\s+obj`).test(text.slice(offset, offset + 24))) {
        const real = text.indexOf(`\n${num} 0 obj`);
        return bad("xref_offset", offset, real === -1 ? null : real + 1 - offset);
      }
    }
    at += count * 20;
  }
  if (!/^\s*trailer/.test(text.slice(at, at + 12))) return bad("xref_unreadable", at);

  // The streams. A direct /Length must land on `endstream`; the data is then skipped so binary never reads as a keyword.
  let from = 0;
  for (;;) {
    const m = /stream\r?\n/g;
    m.lastIndex = from;
    const hit = m.exec(text);
    if (hit === null) break;
    const keyword = hit.index;
    const start = keyword + hit[0].length;
    if (keyword >= 3 && text.slice(keyword - 3, keyword) === "end") {
      from = start;
      continue;
    }
    const back = text.slice(Math.max(0, keyword - 1000), keyword);
    const dict = back.slice(Math.max(0, back.lastIndexOf(" obj")));
    const length = /\/Length\s+(\d+)(?!\d|\s+\d+\s+R)/.exec(dict);
    let end: number;
    if (length === null) {
      end = text.indexOf("endstream", start);
      if (end === -1) return bad("stream_length", start);
    } else {
      end = start + Number(length[1]);
      if (!/^\r?\n?endstream/.test(text.slice(end, end + 12))) return bad("stream_length", end);
    }
    if (length !== null && end - start >= INFLATE_MIN_BYTES && dict.includes("/FlateDecode")) {
      if (!(await inflates(bytes.subarray(start, end)))) return bad("stream_checksum", start);
    }
    from = end;
  }
  return { ok: true };
}
