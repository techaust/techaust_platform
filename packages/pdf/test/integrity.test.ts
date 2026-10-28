// JOB-PDF-01: the PDF structure check, on synthetic PDFs only (the staging files are never committed). The damage under test is the
// owner's: three 8,192-byte blocks stored in the order 3, 1, 2.
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkPdfIntegrity, INFLATE_BUDGET_BYTES, INFLATE_MIN_BYTES } from "../src/integrity.ts";

const enc = new TextEncoder();
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

type Stream = {
  raw: Uint8Array;
  flate: boolean;
  indirectLength?: boolean;
  /** The end of line before `endstream` (default "\n"). */
  eol?: string;
  /** Keys written before /Length (e.g. a font file's /Length1), and after it. */
  before?: string;
  after?: string;
};

/** A classic-xref PDF: `filler` small objects (to reach ~760), then the given streams. Offsets are computed. */
function buildPdf(streams: Stream[], filler = 0): Uint8Array {
  const parts: Uint8Array[] = [enc.encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  let pos = parts[0]?.length ?? 0;
  const offsets: number[] = [];
  const add = (body: Uint8Array) => {
    offsets.push(pos);
    const obj = cat(enc.encode(`${offsets.length} 0 obj\n`), body, enc.encode("\nendobj\n"));
    parts.push(obj);
    pos += obj.length;
  };
  add(enc.encode("<< /Type /Catalog >>"));
  for (let i = 0; i < filler; i++) add(enc.encode(`<< /Type /Note /N ${i} >>`));
  for (const s of streams) {
    const data = s.flate ? new Uint8Array(deflateSync(s.raw)) : s.raw;
    const dict = `<< ${s.before ?? ""}/Length ${s.indirectLength ? "9999 0 R" : data.length}${s.after ?? ""}${s.flate ? " /Filter /FlateDecode" : ""} >>\nstream\n`;
    add(cat(enc.encode(dict), data, enc.encode(`${s.eol ?? "\n"}endstream`)));
  }
  const xref = pos;
  let table = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) table += `${String(o).padStart(10, "0")} 00000 n \n`;
  table += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  parts.push(enc.encode(table));
  return cat(...parts);
}

/** Replaces `from` with the same-length `to` in place (byte-safe: the text is only searched, never re-encoded). */
const sub = (b: Uint8Array, from: string, to: string): Uint8Array => {
  const at = new TextDecoder("latin1").decode(b).search(from);
  expect(at).toBeGreaterThan(-1);
  const out = b.slice();
  out.set(enc.encode(to), at);
  return out;
};

/** Replaces the first match of `from` with the ASCII `to`, any length (bytes are spliced, never re-encoded: the binary stays as it was). */
const splice = (b: Uint8Array, from: string | RegExp, to: string): Uint8Array => {
  const text = new TextDecoder("latin1").decode(b);
  const m = typeof from === "string" ? { index: text.indexOf(from), 0: from } : from.exec(text);
  expect(m === null ? -1 : m.index).toBeGreaterThan(-1);
  const at = m?.index ?? 0;
  return cat(b.subarray(0, at), enc.encode(to), b.subarray(at + (m?.[0].length ?? 0)));
};

const big = (): Stream => ({ raw: new Uint8Array(randomBytes(24_000)), flate: true });
const goodPdf = () => buildPdf([big(), { raw: enc.encode("BT (small) Tj ET"), flate: false }], 750);

/** Moves the block [from, from+len) to just before `to`, the way the damage looked. */
const move = (b: Uint8Array, from: number, len: number, to: number): Uint8Array => {
  const block = b.slice(from, from + len);
  const rest = cat(b.subarray(0, from), b.subarray(from + len));
  return cat(rest.subarray(0, to), block, rest.subarray(to));
};

describe("checkPdfIntegrity: a healthy PDF", () => {
  it("passes (760 objects, one 24 KB Flate stream, a direct and an indirect length)", async () => {
    expect(await checkPdfIntegrity(goodPdf())).toEqual({ ok: true });
    const pdf = buildPdf([{ raw: enc.encode("x".repeat(20)), flate: false, indirectLength: true }]);
    expect(await checkPdfIntegrity(pdf)).toEqual({ ok: true });
  });

  it("agrees with a declared length that matches", async () => {
    const pdf = goodPdf();
    expect(await checkPdfIntegrity(pdf, pdf.length)).toEqual({ ok: true });
  });
});

describe("checkPdfIntegrity: one failing case per code", () => {
  it("length_mismatch: the declared length is not the byte count", async () => {
    const pdf = goodPdf();
    expect(await checkPdfIntegrity(pdf, pdf.length + 1)).toMatchObject({
      ok: false,
      code: "length_mismatch",
    });
  });

  it("xref_offset: three 8 KB blocks stored in the order 3, 1, 2 (the staging damage); numbers only", async () => {
    const pdf = goodPdf();
    const first = 4000; // inside the filler objects, so the offsets shift
    // blocks 3,1,2: take the third block and put it before the first
    const damaged = move(pdf, first + 2 * 8192, 8192, first);
    const r = await checkPdfIntegrity(damaged);
    expect(r).toMatchObject({ ok: false, code: "xref_offset", bytes: pdf.length });
    if (!r.ok) {
      expect(typeof r.firstBadOffset).toBe("number");
      expect(r.displacement === null || r.displacement !== 0).toBe(true); // null when the block cut the header itself
    }
  });

  it("stream_checksum: two blocks swapped inside one 24 KB Flate stream (no header moves)", async () => {
    const pdf = goodPdf();
    const text = new TextDecoder("latin1").decode(pdf);
    const start = text.indexOf("stream\n", text.indexOf("/FlateDecode")) + 7;
    const damaged = pdf.slice();
    const a = damaged.slice(start + 1000, start + 1000 + 4096);
    const b = damaged.slice(start + 9000, start + 9000 + 4096);
    damaged.set(b, start + 1000);
    damaged.set(a, start + 9000);
    expect(await checkPdfIntegrity(damaged)).toMatchObject({ ok: false, code: "stream_checksum" });
  });

  it("stream_length: a /Length that does not land on endstream", async () => {
    const pdf = goodPdf();
    const damaged = sub(pdf, "/Length 16 ", "/Length 15 ");
    expect(await checkPdfIntegrity(damaged)).toMatchObject({ ok: false, code: "stream_length" });
  });

  it("no_startxref and no_eof", async () => {
    const pdf = goodPdf();
    expect(await checkPdfIntegrity(sub(pdf, "startxref", "startxxxx"))).toMatchObject({
      code: "no_startxref",
    });
    expect(await checkPdfIntegrity(sub(pdf, "%%EOF", "%%EOX"))).toMatchObject({ code: "no_eof" });
    // both must sit in the last 1 KB: a startxref pushed further from the end is not where a reader looks
    const padded = cat(pdf, enc.encode(" ".repeat(2000)));
    expect(await checkPdfIntegrity(padded)).toMatchObject({ code: "no_startxref" });
  });

  it("incremental: a second startxref", async () => {
    const pdf = goodPdf();
    const more = cat(pdf, enc.encode("startxref\n0\n%%EOF\n"));
    expect(await checkPdfIntegrity(more)).toMatchObject({ ok: false, code: "incremental" });
  });

  it("xref_stream: a cross-reference stream fails closed", async () => {
    const body = "1 0 obj\n<< /Type /XRef /Length 0 >>\nstream\n\nendstream\nendobj\n";
    const pdf = enc.encode(`%PDF-1.5\n${body}startxref\n9\n%%EOF\n`);
    expect(await checkPdfIntegrity(pdf)).toMatchObject({ ok: false, code: "xref_stream" });
  });

  it("xref_unreadable: startxref points at nothing", async () => {
    const damaged = splice(goodPdf(), /startxref\n\d+/, "startxref\n3");
    expect(await checkPdfIntegrity(damaged)).toMatchObject({ ok: false, code: "xref_unreadable" });
  });
});

/** Swaps two `len`-byte blocks inside the data of the first Flate stream (no header moves; only its Adler-32 can tell). */
const swapInsideStream = (pdf: Uint8Array, a: number, b: number, len: number, nth = 0): Uint8Array => {
  const text = new TextDecoder("latin1").decode(pdf);
  let at = -1;
  for (let i = 0; i <= nth; i++) at = text.indexOf("/FlateDecode", at + 1);
  const start = text.indexOf("stream\n", at) + 7;
  const out = pdf.slice();
  out.set(pdf.slice(start + b, start + b + len), start + a);
  out.set(pdf.slice(start + a, start + a + len), start + b);
  return out;
};

/** Random bytes whose zlib stream is exactly `size` bytes long (stored blocks: 2 header + 5 block + 4 Adler bytes around the data). */
const flateOfSize = (size: number): Stream => {
  const raw = new Uint8Array(randomBytes(size - 11));
  expect(deflateSync(raw).length).toBe(size);
  return { raw, flate: true };
};

describe("checkPdfIntegrity: the bound on inflating (lead 2026-10-29, audit A6 finding 1)", () => {
  it("the constants are the decided ones: 8,192 bytes and 512 KiB; a budget that is not a number is the default, never unbounded", async () => {
    expect(INFLATE_MIN_BYTES).toBe(8192);
    expect(INFLATE_BUDGET_BYTES).toBe(524_288);
    const blank = buildPdf([{ raw: new Uint8Array(16 * 1024 * 1024), flate: true }]);
    for (const inflateBudget of [Number.NaN, Number.POSITIVE_INFINITY])
      expect(await checkPdfIntegrity(blank, null, { inflateBudget })).toMatchObject({
        ok: true,
        partial: { skippedStreams: 1 },
      });
  });

  it("a Flate stream of 8,191 bytes is not inflated; one of 8,192 bytes is (a swapped block inside it is stream_checksum)", async () => {
    const under = buildPdf([flateOfSize(8191)], 20);
    const at = buildPdf([flateOfSize(8192)], 20);
    expect(await checkPdfIntegrity(under)).toEqual({ ok: true });
    expect(await checkPdfIntegrity(at)).toEqual({ ok: true });
    expect(await checkPdfIntegrity(swapInsideStream(under, 1000, 5000, 1024))).toEqual({ ok: true });
    expect(await checkPdfIntegrity(swapInsideStream(at, 1000, 5000, 1024))).toMatchObject({
      ok: false,
      code: "stream_checksum",
    });
  });

  it("past the budget the rest is not inflated: accepted on the header, xref and Length checks, with the numbers of what was left", async () => {
    const pdf = buildPdf(
      [
        { raw: new Uint8Array(randomBytes(100_000)), flate: true },
        { raw: new Uint8Array(randomBytes(100_000)), flate: true },
        { raw: new Uint8Array(randomBytes(100_000)), flate: true },
      ],
      20,
    );
    expect(await checkPdfIntegrity(pdf)).toEqual({ ok: true }); // 300 KB is inside the default budget
    const r = await checkPdfIntegrity(pdf, pdf.length, { inflateBudget: 150_000 });
    expect(r.ok).toBe(true);
    // the first stream in full, the second cut short at the budget (at most one chunk past it), the third not started
    if (r.ok) {
      expect(r.partial?.skippedStreams).toBe(2);
      expect(r.partial?.inflated).toBeGreaterThan(150_000);
      expect(r.partial?.inflated).toBeLessThan(150_000 + 65_536);
    }
    // a block swapped inside the third stream is the accepted risk past the budget; inside the first it is still caught
    expect(
      await checkPdfIntegrity(swapInsideStream(pdf, 1000, 50_000, 4096, 2), null, { inflateBudget: 150_000 }),
    ).toMatchObject({ ok: true, partial: { skippedStreams: 2 } });
    expect(
      await checkPdfIntegrity(swapInsideStream(pdf, 1000, 50_000, 4096, 0), null, { inflateBudget: 150_000 }),
    ).toMatchObject({ ok: false, code: "stream_checksum" });
  });

  it("the default budget stops a stream that inflates to 16 MB near 512 KiB, and never refuses it for its size", async () => {
    const zeros = { raw: new Uint8Array(16 * 1024 * 1024), flate: true }; // 16 MB of blank pixels: about 16 KB once compressed
    const r = await checkPdfIntegrity(buildPdf([zeros], 20));
    expect(r).toMatchObject({ ok: true, partial: { skippedStreams: 1 } });
    if (r.ok) {
      expect(r.partial?.inflated).toBeGreaterThan(INFLATE_BUDGET_BYTES);
      expect(r.partial?.inflated).toBeLessThan(INFLATE_BUDGET_BYTES + 65_536);
    }
  });

  it("with the budget at its minimum (0) nothing is inflated, and the owner's 3, 1, 2 permutation is still xref_offset", async () => {
    const pdf = goodPdf();
    expect(await checkPdfIntegrity(pdf, pdf.length, { inflateBudget: 0 })).toEqual({
      ok: true,
      partial: { inflated: 0, skippedStreams: 1 },
    });
    const damaged = move(pdf, 4000 + 2 * 8192, 8192, 4000);
    expect(await checkPdfIntegrity(damaged, damaged.length, { inflateBudget: 0 })).toMatchObject({
      ok: false,
      code: "xref_offset",
    });
    expect(
      await checkPdfIntegrity(sub(pdf, "/Length 16 ", "/Length 15 "), null, { inflateBudget: 0 }),
    ).toMatchObject({
      ok: false,
      code: "stream_length",
    });
  });
});

const pad = (n: number) => String(n).padStart(10, "0");

/**
 * A linearised file (PDF 32000-1 Annex F): the linearisation dictionary, the first-page section (its trailer's /Prev names the main one),
 * `filler` body objects, the main section; the last startxref points at the first-page section. `mainPrev` gives the main trailer a /Prev
 * too (a further revision); `breakMain` puts one main-section entry a byte off.
 */
function buildLinearised(filler: number, opts: { mainPrev?: boolean; breakMain?: boolean } = {}): Uint8Array {
  let s = "%PDF-1.4\n";
  const lin = s.length;
  s += "1 0 obj\n<< /Linearized 1 /L 0 >>\nendobj\n";
  const firstXref = s.length;
  s += `xref\n1 1\n${pad(lin)} 00000 n \ntrailer\n<< /Size ${filler + 2} /Prev PREVPREVPR >>\nstartxref\n0\n%%EOF\n`;
  const offsets: number[] = [];
  for (let i = 0; i < filler; i++) {
    offsets.push(s.length);
    s += `${i + 2} 0 obj\n<< /Type /Note /N ${i} >>\nendobj\n`;
  }
  s = s.replace("PREVPREVPR", pad(s.length)); // ten digits for ten letters: no offset moves
  let table = `xref\n0 1\n0000000000 65535 f \n2 ${filler}\n`;
  offsets.forEach((o, i) => {
    table += `${pad(opts.breakMain && i === 3 ? o + 1 : o)} 00000 n \n`;
  });
  table += `trailer\n<< /Size ${filler + 2}${opts.mainPrev ? ` /Prev ${firstXref}` : ""} >>\nstartxref\n${firstXref}\n%%EOF\n`;
  return enc.encode(s + table);
}

describe("checkPdfIntegrity: edge cases (review round 2, finding 10)", () => {
  it("a linearised file is not incremental: both sections are read, and a wrong entry in the main one is xref_offset", async () => {
    const pdf = buildLinearised(120);
    expect(pdf.length).toBeGreaterThan(2048); // its first-page startxref and %%EOF lie outside the last 1 KB
    expect(await checkPdfIntegrity(pdf, pdf.length)).toEqual({ ok: true });
    expect(await checkPdfIntegrity(buildLinearised(5))).toEqual({ ok: true }); // a small one: both startxref in the last 1 KB
    expect(await checkPdfIntegrity(buildLinearised(120, { breakMain: true }))).toMatchObject({
      ok: false,
      code: "xref_offset",
    });
    expect(await checkPdfIntegrity(buildLinearised(120, { mainPrev: true }))).toMatchObject({
      ok: false,
      code: "incremental",
    });
  });

  it("a trailer /Prev in a file that is not linearised is an earlier revision: incremental", async () => {
    const updated = splice(goodPdf(), "/Root 1 0 R >>", "/Root 1 0 R /Prev 9 >>");
    expect(await checkPdfIntegrity(updated)).toMatchObject({ ok: false, code: "incremental" });
  });

  it("an entry count larger than the bytes left is xref_unreadable (the loop is bounded by the file)", async () => {
    const huge = splice(goodPdf(), /xref\n0 \d+\n/, "xref\n0 99999999999\n");
    expect(await checkPdfIntegrity(huge)).toMatchObject({ ok: false, code: "xref_unreadable" });
  });

  it("an entry that is neither n nor f is xref_unreadable", async () => {
    expect(await checkPdfIntegrity(sub(goodPdf(), " 00000 n \n", " 00000 x \n"))).toMatchObject({
      ok: false,
      code: "xref_unreadable",
    });
  });

  it("the end of line before endstream may be CR LF, LF, CR alone or nothing", async () => {
    for (const eol of ["\r\n", "\n", "\r", ""]) {
      const pdf = buildPdf([{ raw: enc.encode("BT (eol) Tj ET"), flate: false, eol }], 5);
      expect(await checkPdfIntegrity(pdf)).toEqual({ ok: true });
    }
  });

  it("a font file's /Length1 to /Length3 and a key containing 'stream' don't pass for the stream's /Length", async () => {
    const raw = enc.encode("x".repeat(40));
    const cases: Stream[] = [
      { raw, flate: false, before: "/Length1 5000 " },
      { raw, flate: false, after: " /Length1 5000 /Length2 7000 /Length3 0" },
      { raw, flate: false, before: "/Length1 5000 ", indirectLength: true },
      { raw, flate: false, after: " /Mystream 1 /Upstream (stream) " },
    ];
    for (const c of cases) expect(await checkPdfIntegrity(buildPdf([c], 5))).toEqual({ ok: true });
    // a wrong /Length after a /Length1 is still caught
    const wrong = buildPdf([{ raw, flate: false, before: "/Length1 5000 " }], 5);
    expect(await checkPdfIntegrity(sub(wrong, "/Length 40 ", "/Length 39 "))).toMatchObject({
      ok: false,
      code: "stream_length",
    });
  });

  it("the displacement of a moved object is reported (where it is minus where the table says)", async () => {
    const pdf = goodPdf();
    const text = new TextDecoder("latin1").decode(pdf);
    // one entry pointed 7 bytes early: the object is found 7 bytes later than the table says
    const m = /\n(\d{10}) 00000 n \n/.exec(text.slice(text.indexOf("\nxref\n") + 30));
    expect(m).not.toBeNull();
    const at = Number(m?.[1]);
    const damaged = splice(pdf, `${pad(at)} 00000 n `, `${pad(at - 7)} 00000 n `);
    expect(await checkPdfIntegrity(damaged)).toMatchObject({
      ok: false,
      code: "xref_offset",
      displacement: 7,
    });
  });
});
