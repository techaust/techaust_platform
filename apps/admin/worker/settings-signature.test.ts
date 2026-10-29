// The signature image (M4.4; ADM-SET-01): upload by the bytes' own type, size and pixel limits, replace, delete, the company form cannot touch
// it, and a company row from before M4.4 reads as null.
import { env } from "cloudflare:workers";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import { sniffSignature } from "./settings-signature.ts";
import { call, one, rows, sessionFor } from "./test-helpers.ts";
import { json } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

/** A PNG header (signature, IHDR with the size): enough for the type check, which reads only the first 24 bytes. */
function png(width = 400, height = 120, pad = 0): Uint8Array {
  const b = new Uint8Array(33 + pad);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  for (let i = 33; i < b.length; i++) b[i] = i % 251;
  return b;
}
/** A JPEG header (SOI, a JFIF segment, SOF0 with the size) and `pad` filler bytes; not a decodable image, which the sniffer never needs. */
const jpeg = (pad = 0, width = 100, height = 50) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0,
    16,
    0x4a,
    0x46,
    0x49,
    0x46,
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    0xff,
    0xc0,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    0x11,
    0,
    ...new Array(pad).fill(7),
  ]);

const company = async (s: { cookie: string }) =>
  json(await call("/settings/groups/company", { cookie: s.cookie }));
const put = (s: { cookie: string }, raw: Uint8Array) =>
  call("/settings/signature", { cookie: s.cookie, method: "PUT", raw });

describe("sniffSignature", () => {
  it("knows a PNG (with its size) and a JPEG by their first bytes", () => {
    expect(sniffSignature(png(400, 120))).toMatchObject({
      ok: true,
      mime: "image/png",
      ext: "png",
      width: 400,
      height: 120,
    });
    expect(sniffSignature(jpeg())).toMatchObject({
      ok: true,
      mime: "image/jpeg",
      ext: "jpg",
      width: 100,
      height: 50,
    });
  });
  it("refuses a JPEG over 800 by 400 pixels (FX-3; a small file with a huge size in its header), one with no frame header, and a zero size", () => {
    expect(sniffSignature(jpeg(0, 801, 100))).toEqual({ ok: false, reason: "pixels" });
    expect(sniffSignature(jpeg(0, 100, 401))).toEqual({ ok: false, reason: "pixels" });
    expect(sniffSignature(jpeg(0, 2400, 1200))).toEqual({ ok: false, reason: "pixels" }); // the bound before FX-3
    expect(sniffSignature(jpeg(0, 65535, 65535))).toEqual({ ok: false, reason: "pixels" });
    expect(sniffSignature(jpeg(0, 0, 10))).toEqual({ ok: false, reason: "pixels" });
    expect(sniffSignature(jpeg(0, 800, 400))).toMatchObject({ ok: true, width: 800, height: 400 });
    expect(sniffSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 7]))).toEqual({
      ok: false,
      reason: "type",
    });
  });
  it("refuses everything else: SVG, GIF, PDF, text, a PNG with a bad chunk, a zero or oversize PNG", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniffSignature(enc('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'))).toEqual({
      ok: false,
      reason: "type",
    });
    expect(sniffSignature(enc("GIF89a......................."))).toEqual({ ok: false, reason: "type" });
    expect(sniffSignature(enc("%PDF-1.4\n......................"))).toEqual({ ok: false, reason: "type" });
    expect(sniffSignature(new Uint8Array(0))).toEqual({ ok: false, reason: "type" });
    const bad = png();
    bad[12] = 0x58;
    expect(sniffSignature(bad)).toEqual({ ok: false, reason: "type" });
    expect(sniffSignature(png(0, 10))).toEqual({ ok: false, reason: "pixels" });
    // FX-3 (A6 1c): the IHDR bound is 800 by 400, inclusive
    expect(sniffSignature(png(801, 100))).toEqual({ ok: false, reason: "pixels" });
    expect(sniffSignature(png(100, 401))).toEqual({ ok: false, reason: "pixels" });
    expect(sniffSignature(png(2400, 1200))).toEqual({ ok: false, reason: "pixels" });
    expect(sniffSignature(png(800, 400))).toMatchObject({ ok: true, width: 800, height: 400 });
    expect(sniffSignature(png(800, 1))).toMatchObject({ ok: true });
    expect(sniffSignature(png(1, 400))).toMatchObject({ ok: true });
  });
});

describe("PUT /settings/signature", () => {
  it("stores the image under a hash-named key, records it in the company settings and the audit log, and serves it back", async () => {
    const s = await owner();
    const bytes = png(300, 100, 50);
    const res = await put(s, bytes);
    expect(res.status).toBe(200);
    const ref = (await json(res)).signature;
    expect(ref).toMatchObject({ mime: "image/png", size: bytes.byteLength, width: 300, height: 100 });
    expect(ref.key).toMatch(/^settings\/signature-[0-9a-f]{16}\.png$/);
    expect(await env.DOCS.head(ref.key)).not.toBeNull();
    expect((await company(s)).value.signature).toMatchObject({ key: ref.key, sha256: ref.sha256 });
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'settings.signature.update' ORDER BY rowid DESC LIMIT 1",
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({
      mime: "image/png",
      size: bytes.byteLength,
      replaced: false,
    });
    const img = await call("/settings/signature", { cookie: s.cookie });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toBe("no-store");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(bytes);
  });

  it("a replacement gets a new key, keeps the old object and says replaced", async () => {
    const s = await owner();
    const first = (await json(await put(s, png(300, 100, 10)))).signature;
    const second = (await json(await put(s, jpeg(80)))).signature;
    expect(second.key).not.toBe(first.key);
    expect(second.mime).toBe("image/jpeg");
    expect(await env.DOCS.head(second.key)).not.toBeNull();
    expect(await env.DOCS.head(first.key)).not.toBeNull();
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'settings.signature.update' ORDER BY rowid DESC LIMIT 1",
    );
    expect(JSON.parse(audit?.summary ?? "{}").replaced).toBe(true);
  });

  it("refuses what is not a small PNG or JPEG, and writes nothing", async () => {
    const s = await owner();
    const before = (await rows("SELECT key FROM settings")).length;
    expect((await put(s, new TextEncoder().encode("<svg onload=alert(1)></svg>"))).status).toBe(415);
    expect((await put(s, png(5000, 100))).status).toBe(415);
    const huge = await put(s, jpeg(0, 9000, 9000));
    expect(huge.status).toBe(415);
    expect((await json(huge)).error.code).toBe("image_too_big");
    // FX-3 (A6 1c): a PNG one pixel past 800 by 400 is refused from its IHDR (the bound itself passes: see sniffSignature above)
    for (const [w, h] of [
      [801, 400],
      [800, 401],
    ] as const) {
      const r = await put(s, png(w, h));
      expect(r.status).toBe(415);
      expect(await json(r)).toMatchObject({
        error: { code: "image_too_big", message: "The image is larger than 800 by 400 pixels" },
      });
    }
    expect((await put(s, png(100, 100, 256 * 1024))).status).toBe(413);
    expect(
      (await call("/settings/signature", { cookie: s.cookie, method: "PUT", raw: new Uint8Array(0) })).status,
    ).toBe(400);
    expect((await rows("SELECT key FROM settings")).length).toBe(before);
    const listed = await env.DOCS.list({ prefix: "settings/signature-" });
    for (const o of listed.objects) expect(o.size).toBeLessThanOrEqual(256 * 1024);
  });

  it("is for the owner only", async () => {
    for (const role of ["staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role);
      expect((await put(s, png())).status, role).toBe(403);
      expect((await call("/settings/signature", { cookie: s.cookie })).status, role).toBe(403);
      expect((await call("/settings/signature", { cookie: s.cookie, method: "DELETE" })).status, role).toBe(
        403,
      );
    }
  });
});

describe("DELETE /settings/signature", () => {
  it("clears the reference, keeps the object, audits it, and a second delete is 404", async () => {
    const s = await owner();
    const ref = (await json(await put(s, png(200, 80, 20)))).signature;
    const res = await call("/settings/signature", { cookie: s.cookie, method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await company(s)).value.signature).toBeNull();
    expect(await env.DOCS.head(ref.key)).not.toBeNull();
    expect((await call("/settings/signature", { cookie: s.cookie })).status).toBe(404);
    expect(
      await one("SELECT 1 AS x FROM audit_log WHERE action = 'settings.signature.delete'"),
    ).not.toBeNull();
    expect((await call("/settings/signature", { cookie: s.cookie, method: "DELETE" })).status).toBe(404);
  });
});

describe("the company form and older rows", () => {
  it("saving the company group neither sets nor clears the signature, whatever the body says", async () => {
    const s = await owner();
    const ref = (await json(await put(s, png(220, 90, 30)))).signature;
    const got = await company(s);
    const { signature: _kept, ...form } = got.value;
    const saved = await call("/settings/groups/company", {
      cookie: s.cookie,
      method: "PUT",
      body: { version: got.version, value: { ...form, tradeName: "TecHaust Technologies" } },
    });
    expect(saved.status).toBe(200);
    expect((await company(s)).value.signature).toMatchObject({ key: ref.key });
    const forged = await call("/settings/groups/company", {
      cookie: s.cookie,
      method: "PUT",
      body: {
        version: (await company(s)).version,
        value: { ...form, tradeName: "TecHaust Technologies 2", signature: null },
      },
    });
    expect(forged.status).toBe(200);
    expect((await company(s)).value.signature).toMatchObject({ key: ref.key });
  });

  it("a company row stored before M4.4 (no signature key) reads as null", async () => {
    const s = await owner();
    const { signature: _none, ...old } = SETTINGS_DEFAULTS.company;
    await env.DB.prepare(
      "INSERT INTO settings (key, value, version) VALUES ('company', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = excluded.version",
    )
      .bind(JSON.stringify(old))
      .run();
    expect((await company(s)).value.signature).toBeNull();
    expect((await call("/settings/signature", { cookie: s.cookie })).status).toBe(404);
  });
});
