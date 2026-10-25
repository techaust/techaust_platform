import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  extOf,
  fileKey,
  isAllowedExtension,
  sanitiseFilename,
  sniffFileType,
} from "../src/file-types.ts";

const bytes = (...v: (number | string)[]) =>
  Uint8Array.from(v.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const PDF = bytes("%PDF-1.7\n");
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0);
const WEBP = bytes("RIFF", 1, 2, 3, 4, "WEBP", "VP8 ");
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 20, 0);
const utf = (s: string) => new TextEncoder().encode(s);

describe("sniffFileType [ADM-PRJ-04]", () => {
  it("accepts each type with its own bytes and returns our MIME type", () => {
    expect(sniffFileType(PDF, "pdf")).toEqual({ ok: true, ext: "pdf", mime: "application/pdf" });
    expect(sniffFileType(PNG, ".PNG")).toMatchObject({ ok: true, mime: "image/png" });
    expect(sniffFileType(JPG, "jpg")).toMatchObject({ ok: true, ext: "jpg", mime: "image/jpeg" });
    expect(sniffFileType(JPG, "jpeg")).toMatchObject({ ok: true, ext: "jpg" });
    expect(sniffFileType(WEBP, "webp")).toMatchObject({ ok: true, mime: "image/webp" });
    expect(sniffFileType(ZIP, "docx")).toMatchObject({ ok: true, ext: "docx" });
    expect(sniffFileType(ZIP, "xlsx")).toMatchObject({ ok: true, ext: "xlsx" });
    expect(sniffFileType(ZIP, "zip")).toMatchObject({ ok: true, mime: "application/zip" });
    expect(sniffFileType(utf("a,b\n1,2\n"), "csv")).toMatchObject({ ok: true, mime: "text/csv" });
    expect(sniffFileType(utf("héllo ₹ wörld"), "txt")).toMatchObject({ ok: true, mime: "text/plain" });
  });

  it("refuses an extension that is not on the list", () => {
    for (const ext of ["svg", "html", "exe", "js", "", "pdf.exe", "php"])
      expect(sniffFileType(PDF, ext), ext).toEqual({ ok: false, reason: "type_not_allowed" });
  });

  it("refuses bytes that do not match the extension", () => {
    expect(sniffFileType(PNG, "pdf")).toEqual({ ok: false, reason: "type_mismatch" });
    expect(sniffFileType(PDF, "png")).toEqual({ ok: false, reason: "type_mismatch" });
    expect(sniffFileType(utf("<html><script>alert(1)</script>"), "png")).toEqual({
      ok: false,
      reason: "type_mismatch",
    });
    expect(sniffFileType(bytes("RIFF", 0, 0, 0, 0, "WAVE"), "webp")).toEqual({
      ok: false,
      reason: "type_mismatch",
    });
    expect(sniffFileType(bytes(0xff, 0xd8), "jpg")).toEqual({ ok: false, reason: "type_mismatch" });
    expect(sniffFileType(PNG, "docx")).toEqual({ ok: false, reason: "type_mismatch" });
    expect(sniffFileType(utf("plain text"), "zip")).toEqual({ ok: false, reason: "type_mismatch" });
  });

  it("refuses text with a NUL, a binary control byte, invalid UTF-8 or a binary signature", () => {
    expect(sniffFileType(bytes("abc", 0, "def"), "txt")).toEqual({ ok: false, reason: "type_mismatch" });
    expect(sniffFileType(bytes("abc", 0x07), "csv")).toEqual({ ok: false, reason: "type_mismatch" });
    expect(sniffFileType(bytes("abc", 0xff, 0xfe, "x"), "txt")).toEqual({
      ok: false,
      reason: "type_mismatch",
    });
    expect(sniffFileType(PDF, "txt")).toEqual({ ok: false, reason: "type_mismatch" });
    expect(sniffFileType(PNG, "csv")).toEqual({ ok: false, reason: "type_mismatch" });
    expect(sniffFileType(ZIP, "txt")).toEqual({ ok: false, reason: "type_mismatch" });
  });

  it("accepts a multi-byte character cut by the end of the sample", () => {
    const rupee = utf("₹"); // 3 bytes
    expect(sniffFileType(Uint8Array.from([...utf("ab"), ...rupee.slice(0, 2)]), "txt")).toMatchObject({
      ok: true,
    });
  });

  it("refuses an empty file", () => {
    expect(sniffFileType(new Uint8Array(0), "pdf")).toEqual({ ok: false, reason: "empty" });
    expect(sniffFileType(new Uint8Array(0), "exe")).toEqual({ ok: false, reason: "type_not_allowed" });
  });

  it("property: bytes that start with a NUL are never any allowed type", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 64 }),
        fc.constantFrom("pdf", "png", "jpg", "webp", "zip", "docx", "xlsx", "csv", "txt"),
        (rest, ext) => {
          expect(sniffFileType(Uint8Array.from([0, ...rest]), ext).ok).toBe(false);
        },
      ),
    );
  });
});

describe("sanitiseFilename", () => {
  it("keeps an ordinary name", () => {
    expect(sanitiseFilename("Quote v2 (final).pdf")).toBe("Quote v2 (final).pdf");
    expect(sanitiseFilename("résumé ₹.txt")).toBe("résumé ₹.txt");
  });

  it("drops the path, control and bidi characters", () => {
    expect(sanitiseFilename("../../x")).toBe("x");
    expect(sanitiseFilename("C:\\Users\\a\\b.pdf")).toBe("b.pdf");
    expect(sanitiseFilename("a\u202etxt.exe")).toBe("atxt.exe");
    expect(sanitiseFilename("a\u2066b\u2069.pdf")).toBe("ab.pdf");
    expect(sanitiseFilename("a\r\nb\u0000c.txt")).toBe("abc.txt");
    expect(sanitiseFilename('a<b>:"|?*.txt')).toBe("a_b______.txt");
  });

  it("makes Windows device names and leading dots harmless", () => {
    expect(sanitiseFilename("CON.txt")).toBe("_CON.txt");
    expect(sanitiseFilename("lpt1")).toBe("_lpt1");
    expect(sanitiseFilename(".hidden.txt")).toBe("hidden.txt");
    expect(sanitiseFilename(".htaccess")).toBe("file.htaccess");
    expect(sanitiseFilename("name. . ")).toBe("name");
  });

  it("normalises to NFC", () => {
    expect(sanitiseFilename("e\u0301.txt")).toBe("\u00e9.txt");
  });

  it("limits the length to 120 characters and keeps the extension", () => {
    const out = sanitiseFilename(`${"a".repeat(300)}.pdf`);
    expect(Array.from(out)).toHaveLength(120);
    expect(out.endsWith(".pdf")).toBe(true);
    const emoji = sanitiseFilename(`${"😀".repeat(300)}.png`);
    expect(Array.from(emoji)).toHaveLength(120);
    expect(emoji.endsWith(".png")).toBe(true);
  });

  it("falls back to file.<ext> when nothing is left", () => {
    expect(sanitiseFilename("")).toBe("file");
    expect(sanitiseFilename("///")).toBe("file");
    expect(sanitiseFilename("\u202e.pdf")).toBe("file.pdf");
    expect(sanitiseFilename("..")).toBe("file");
  });

  it("property: the result has no separators, controls or bidi characters and is at most 120 characters", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        const out = sanitiseFilename(s);
        expect(out).not.toMatch(/[\\/]/);
        for (const ch of out) {
          const code = ch.codePointAt(0) as number;
          expect(
            code >= 0x20 && !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069),
          ).toBe(true);
        }
        expect(Array.from(out).length).toBeLessThanOrEqual(120);
        expect(out.length).toBeGreaterThan(0);
        expect(out.startsWith(".")).toBe(false);
      }),
    );
  });
});

describe("contentDisposition", () => {
  it("has the ASCII and the UTF-8 forms and is always an attachment", () => {
    expect(contentDisposition("Quote.pdf")).toBe(
      `attachment; filename="Quote.pdf"; filename*=UTF-8''Quote.pdf`,
    );
    expect(contentDisposition("₹ rate's (v1).pdf")).toBe(
      `attachment; filename="_ rate's (v1).pdf"; filename*=UTF-8''%E2%82%B9%20rate%27s%20%28v1%29.pdf`,
    );
  });

  it("cannot be broken out of with quotes, backslashes, percent signs or line breaks", () => {
    const h = contentDisposition('a"; filename=evil\r\nX: y%.pdf');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.split('"')).toHaveLength(3);
    expect(h).toContain("filename*=UTF-8''a%22%3B%20filename%3Devil%0D%0AX%3A%20y%25.pdf");
  });
});

describe("text sampling does not leak between calls", () => {
  it("a sample cut inside a character does not make the next, unrelated sample pass or fail", () => {
    const cut = Uint8Array.from([0x61, 0xe2, 0x82]); // 'a' and the first two bytes of a three-byte character
    expect(sniffFileType(cut, "txt").ok).toBe(true);
    expect(sniffFileType(Uint8Array.from([0x62, 0x63]), "txt").ok).toBe(true);
    expect(sniffFileType(Uint8Array.from([0x80, 0x61]), "txt").ok).toBe(false); // a lone continuation byte
    expect(sniffFileType(cut, "txt").ok).toBe(true);
  });
});

describe("helpers", () => {
  it("isAllowedExtension", () => {
    for (const e of ["pdf", ".PNG", "jpeg", "jpg", "webp", "docx", "xlsx", "csv", "txt", "zip"])
      expect(isAllowedExtension(e), e).toBe(true);
    for (const e of ["svg", "html", "exe", "", "constructor", "__proto__", "toString"])
      expect(isAllowedExtension(e), e).toBe(false);
  });

  it("extOf and fileKey", () => {
    expect(extOf("a.b.PDF")).toBe("pdf");
    expect(extOf("noext")).toBe("");
    expect(fileKey("c1", "f1")).toBe("files/c1/f1");
  });
});
