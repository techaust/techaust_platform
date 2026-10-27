// The store-only ZIP writer [ADM-REP-04; M5.5b, LD84]: CRC-32 vectors, the headers read back, byte-stable output.
import { describe, expect, it } from "vitest";
import { crc32, storedZip } from "../../src/gst/index.ts";
import { checkU32 } from "../../src/gst/zip.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("crc32", () => {
  it("matches the published vectors", () => {
    expect(crc32(bytes(""))).toBe(0);
    expect(crc32(bytes("a"))).toBe(0xe8b7be43);
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(bytes("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });

  it("is unsigned and works on every byte value", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const c = crc32(all);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(0xffff_ffff);
    expect(c).toBe(0x29058c73);
  });
});

/** A small reader: the local headers and the central directory of an archive. */
function read(zip: Uint8Array) {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdStart = v.getUint32(eocd + 16, true);
  expect(cdStart + cdSize).toBe(eocd);
  const dec = new TextDecoder();
  const files: {
    name: string;
    text: string;
    crc: number;
    flags: number;
    method: number;
    date: number;
    time: number;
  }[] = [];
  let at = cdStart;
  for (let i = 0; i < count; i += 1) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const flags = v.getUint16(at + 8, true);
    const method = v.getUint16(at + 10, true);
    const time = v.getUint16(at + 12, true);
    const date = v.getUint16(at + 14, true);
    const crc = v.getUint32(at + 16, true);
    const csize = v.getUint32(at + 20, true);
    const usize = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const offset = v.getUint32(at + 42, true);
    const name = dec.decode(zip.subarray(at + 46, at + 46 + nameLen));
    // the local header agrees with the central one
    expect(v.getUint32(offset, true)).toBe(0x04034b50);
    expect(v.getUint32(offset + 14, true)).toBe(crc);
    expect(v.getUint32(offset + 18, true)).toBe(csize);
    expect(v.getUint32(offset + 22, true)).toBe(usize);
    expect(csize).toBe(usize);
    const localNameLen = v.getUint16(offset + 26, true);
    expect(localNameLen).toBe(nameLen);
    const dataStart = offset + 30 + localNameLen;
    const text = dec.decode(zip.subarray(dataStart, dataStart + usize));
    files.push({ name, text, crc, flags, method, date, time });
    at += 46 + nameLen;
  }
  expect(at).toBe(eocd);
  return files;
}

describe("storedZip", () => {
  const files = [
    { name: "b2b.csv", text: "a,b\r\n1,2\r\n" },
    { name: "docs.csv", text: "Nature,Zürich ₹ \u{1f600}\r\n" },
    { name: "empty.csv", text: "" },
  ];

  it("reads back: names, bytes, CRC-32, stored, UTF-8 flag, the fixed 1980-01-01 date", () => {
    const got = read(storedZip(files));
    expect(got.map((f) => [f.name, f.text])).toEqual(files.map((f) => [f.name, f.text]));
    for (const [i, f] of got.entries()) {
      expect(f.crc).toBe(crc32(bytes(files[i]?.text ?? "")));
      expect(f.method).toBe(0);
      expect(f.flags).toBe(0x0800);
      expect(f.date).toBe(0x0021);
      expect(f.time).toBe(0);
    }
  });

  it("is byte-stable: the same files give the same bytes", () => {
    expect(storedZip(files)).toEqual(storedZip(files));
    expect(storedZip(files).length).toBe(
      22 + files.reduce((n, f) => n + 30 + 46 + 2 * bytes(f.name).length + bytes(f.text).length, 0),
    );
  });

  it("an empty archive is just the end record", () => {
    const z = storedZip([]);
    expect(z.length).toBe(22);
    expect(read(z)).toEqual([]);
  });

  it("refuses an invalid name, too many files and a name that is too long", () => {
    for (const name of [
      "",
      "/abs.csv",
      "a\\b.csv",
      "../x.csv",
      "a/../b.csv",
      "a//b.csv",
      "./a.csv",
      "a\u0000b",
    ]) {
      expect(() => storedZip([{ name, text: "x" }]), JSON.stringify(name)).toThrow(RangeError);
    }
    expect(() => storedZip(Array.from({ length: 65_536 }, () => ({ name: "a.csv", text: "" })))).toThrow(
      RangeError,
    );
    expect(() => storedZip([{ name: "a".repeat(65_536), text: "" }])).toThrow(RangeError);
    expect(() => storedZip([{ name: "dir/ok.csv", text: "x" }])).not.toThrow();
  });

  it("the 32-bit size guard", () => {
    expect(() => checkU32(0xffff_ffff, "File")).not.toThrow();
    expect(() => checkU32(0x1_0000_0000, "File")).toThrow(RangeError);
  });
});
