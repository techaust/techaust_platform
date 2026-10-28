// JOB-PDF-01: the PDF structure check, on synthetic PDFs only (the staging files are never committed). The damage under test is the
// owner's: three 8,192-byte blocks stored in the order 3, 1, 2.
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkPdfIntegrity } from "../src/integrity.ts";

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

type Stream = { raw: Uint8Array; flate: boolean; indirectLength?: boolean };

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
    const dict = `<< /Length ${s.indirectLength ? "9999 0 R" : data.length}${s.flate ? " /Filter /FlateDecode" : ""} >>\nstream\n`;
    add(cat(enc.encode(dict), data, enc.encode("\nendstream")));
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
    const padded = cat(sub(pdf, "%%EOF", "%%EOX"), enc.encode(" ".repeat(2000)));
    expect(await checkPdfIntegrity(padded)).toMatchObject({ code: "no_eof" });
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
    const text = new TextDecoder("latin1").decode(goodPdf());
    const damaged = enc.encode(text.replace(/startxref\n\d+/, "startxref\n3"));
    expect(await checkPdfIntegrity(damaged)).toMatchObject({ ok: false, code: "xref_unreadable" });
  });
});
