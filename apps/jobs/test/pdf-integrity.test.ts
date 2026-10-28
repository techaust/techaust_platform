// JOB-PDF-01 (owner finding F1): a PDF whose blocks arrive out of order is never stored. Synthetic PDFs only (the staging files are not
// committed: the repository is public). Runs in workerd, so it also proves what the platform's DecompressionStream does with a bad Adler-32.

import { env } from "cloudflare:workers";
import { checkPdfIntegrity, INFLATE_BUDGET_BYTES } from "@techaust/pdf/integrity";
import { describe, expect, it, vi } from "vitest";
import { type RenderEnv, renderPdf } from "../src/browser.ts";
import { failed, putOnce, putPdfOnce, sha256Bytes } from "../src/pdf.ts";

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

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65_536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65_536)));
  return out;
}

/**
 * Text-like bytes from a skewed 40-symbol alphabet with no long repeats: deflate codes them with dynamic Huffman tables (not stored blocks),
 * the costly kind to inflate, like font programs and content streams.
 */
function huffmanBytes(n: number): Uint8Array {
  const r = new Uint32Array(n);
  for (let i = 0; i < n; i += 16_384) crypto.getRandomValues(r.subarray(i, Math.min(n, i + 16_384)));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = r[i] ?? 0;
    out[i] = 0x41 + (Math.min(v % 64, (v >>> 8) % 64) % 40);
  }
  return out;
}

async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw.slice().buffer]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** About the size of a proposal: `filler` small objects and one Flate stream of `streamBytes` random (or Huffman-coded) bytes. */
async function syntheticPdf(
  filler: number,
  streamBytes: number,
  kind: "random" | "huffman" = "random",
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [enc.encode("%PDF-1.4\n")];
  let pos = 9;
  const offsets: number[] = [];
  const add = (body: Uint8Array) => {
    offsets.push(pos);
    const obj = cat(enc.encode(`${offsets.length} 0 obj\n`), body, enc.encode("\nendobj\n"));
    parts.push(obj);
    pos += obj.length;
  };
  add(enc.encode("<< /Type /Catalog >>"));
  for (let i = 0; i < filler; i++) add(enc.encode(`<< /Type /Note /N ${i} >>`));
  const data = await deflate(kind === "huffman" ? huffmanBytes(streamBytes) : randomBytes(streamBytes));
  add(
    cat(
      enc.encode(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`),
      data,
      enc.encode("\nendstream"),
    ),
  );
  const xref = pos;
  let table = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) table += `${String(o).padStart(10, "0")} 00000 n \n`;
  table += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  parts.push(enc.encode(table));
  return cat(...parts);
}

const respond = (bytes: Uint8Array, headers: Record<string, string> = {}) =>
  new Response(bytes, { status: 200, headers: { "content-type": "application/pdf", ...headers } });
const envFor = (res: () => Response): RenderEnv => ({
  BROWSER: { quickAction: async () => res() } as unknown as Pick<BrowserRun, "quickAction">,
  ENVIRONMENT: "staging",
});

/** The owner's damage: a block moved ahead of two others. */
const rotate = (b: Uint8Array, at: number): Uint8Array =>
  cat(
    b.subarray(0, at),
    b.subarray(at + 2 * 8192, at + 3 * 8192),
    b.subarray(at, at + 2 * 8192),
    b.subarray(at + 3 * 8192),
  );

describe("the structure check in workerd", () => {
  it("passes a healthy 270 KB, 760-object PDF and measures its cost", async ({ annotate }) => {
    const time = async (pdf: Uint8Array) => {
      await checkPdfIntegrity(pdf); // warm
      const t0 = performance.now();
      const runs = 20;
      for (let i = 0; i < runs; i++) expect(await checkPdfIntegrity(pdf)).toEqual({ ok: true });
      return (performance.now() - t0) / runs;
    };
    const whole = await syntheticPdf(755, 262_000);
    expect(whole.length).toBeGreaterThan(260_000);
    const objectsOnly = await syntheticPdf(755, 10);
    const streamOnly = await syntheticPdf(2, 262_000);
    const [a, b, c] = [await time(whole), await time(objectsOnly), await time(streamOnly)];
    await annotate(
      `integrity ms per check: whole ${whole.length} B ${a.toFixed(2)}, 756 objects ${b.toFixed(2)}, one 262 KB stream ${c.toFixed(2)}`,
    );
    expect(a).toBeLessThan(50); // a loose guard; the real figure is in the annotation (a tap reporter prints it)
  });

  it("Huffman-coded streams (fonts, content): the check's wall time under, at and past the inflate budget", async ({
    annotate,
  }) => {
    const time = async (pdf: Uint8Array, runs: number, inflateBudget = INFLATE_BUDGET_BYTES) => {
      const first = await checkPdfIntegrity(pdf, null, { inflateBudget }); // warm
      const t0 = performance.now();
      for (let i = 0; i < runs; i++) await checkPdfIntegrity(pdf, null, { inflateBudget });
      return { ms: (performance.now() - t0) / runs, result: first };
    };
    const small = await syntheticPdf(755, 262_000, "huffman"); // inflates 262 KB
    const atBudget = await syntheticPdf(755, INFLATE_BUDGET_BYTES - 16_384, "huffman"); // just under 512 KiB inflated
    const past = await syntheticPdf(755, 4 * 1024 * 1024, "huffman"); // 4 MiB inflated: cut at the budget
    const [s, at, p] = [await time(small, 10), await time(atBudget, 5), await time(past, 5)];
    // the same files with nothing inflated: the part of the cost that grows with the file's size, not with the budget
    const [at0, p0] = [await time(atBudget, 5, 0), await time(past, 5, 0)];
    expect(s.result).toEqual({ ok: true });
    expect(at.result).toEqual({ ok: true });
    expect(p.result).toMatchObject({ ok: true, partial: { skippedStreams: 1 } });
    await annotate(
      `huffman integrity ms per check: 262 KB inflated (${small.length} B) ${s.ms.toFixed(2)}; ` +
        `${INFLATE_BUDGET_BYTES - 16_384} B inflated (${atBudget.length} B) ${at.ms.toFixed(2)}; ` +
        `4 MiB inflated, cut at the budget (${past.length} B) ${p.ms.toFixed(2)}; ` +
        `with no inflating: ${at0.ms.toFixed(2)} and ${p0.ms.toFixed(2)}`,
    );
    // A loose sanity guard only: the bound itself is proven by the inflated byte count (packages/pdf/test/integrity.test.ts); wall times on
    // this shared PC swing by half. Unbounded, the 4 MiB stream alone would inflate 2.7 times the budget.
    expect(p.ms).toBeLessThan(500);
  }, 60_000);

  it("the platform's DecompressionStream rejects a block moved inside one Flate stream (Adler-32)", async () => {
    const pdf = await syntheticPdf(10, 40_000);
    const text = new TextDecoder("latin1").decode(pdf);
    const start = text.indexOf("stream\n", text.indexOf("/FlateDecode")) + 7;
    const damaged = pdf.slice();
    const a = damaged.slice(start + 2000, start + 2000 + 4096);
    const b = damaged.slice(start + 12_000, start + 12_000 + 4096);
    damaged.set(b, start + 2000);
    damaged.set(a, start + 12_000);
    expect(await checkPdfIntegrity(damaged)).toMatchObject({ ok: false, code: "stream_checksum" });
  });

  it("three 8 KB blocks stored in the order 3, 1, 2 fail xref_offset", async () => {
    const pdf = await syntheticPdf(755, 262_000);
    expect(await checkPdfIntegrity(rotate(pdf, 3770))).toMatchObject({ ok: false, code: "xref_offset" });
  });
});

describe("renderPdf with a damaged response", () => {
  it("is kind damaged, with numbers only in the log, and the same bytes intact pass", async () => {
    const pdf = await syntheticPdf(755, 262_000);
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void logs.push(String(line)));
    const r = await renderPdf(
      envFor(() => respond(rotate(pdf, 3770))),
      "<p>secret</p>",
    );
    spy.mockRestore();
    expect(r).toMatchObject({ ok: false, kind: "damaged" });
    const line = logs.find((l) => l.includes("pdf.damaged")) ?? "";
    expect(JSON.parse(line)).toMatchObject({ ev: "pdf.damaged", code: "xref_offset", bytes: pdf.length });
    expect(line).not.toContain("secret");
    expect(
      await renderPdf(
        envFor(() => respond(pdf)),
        "x",
      ),
    ).toMatchObject({ ok: true });
  });

  it("past the inflate budget the PDF is kept, with pdf.integrity_partial (numbers only) and no retry", async () => {
    const zeros = new Uint8Array(16 * 1024 * 1024); // a large blank image: about 16 KB compressed, 16 MB inflated
    const data = await deflate(zeros);
    const head = enc.encode("%PDF-1.4\n");
    const obj = cat(
      enc.encode(`1 0 obj\n<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`),
      data,
      enc.encode("\nendstream\nendobj\n"),
    );
    const xref = head.length + obj.length;
    const at = String(head.length).padStart(10, "0");
    const pdf = cat(
      head,
      obj,
      enc.encode(
        `xref\n0 2\n0000000000 65535 f \n${at} 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
      ),
    );
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void logs.push(String(line)));
    const r = await renderPdf(
      envFor(() => respond(pdf, { "content-length": String(pdf.length) })),
      "<p>secret</p>",
    );
    spy.mockRestore();
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.bytes).toEqual(pdf);
    const line = logs.find((l) => l.includes("pdf.integrity_partial")) ?? "";
    const event = JSON.parse(line);
    expect(event).toMatchObject({ ev: "pdf.integrity_partial", bytes: pdf.length, skippedStreams: 1 });
    expect(event.inflated).toBeGreaterThan(INFLATE_BUDGET_BYTES);
    // the event's own fields are numbers only (logEvent adds the isolate id and the invocation count)
    expect(
      Object.keys(event)
        .filter((k) => k !== "iso" && k !== "n")
        .sort(),
    ).toEqual(["bytes", "ev", "inflated", "skippedStreams"]);
    expect(line).not.toContain("secret");
    expect(logs.some((l) => l.includes("pdf.damaged"))).toBe(false);
  });

  it("a content-length that disagrees with the bytes is damaged (length_mismatch)", async () => {
    const pdf = await syntheticPdf(5, 5000);
    const r = await renderPdf(
      envFor(() => respond(pdf, { "content-length": String(pdf.length + 8192) })),
      "x",
    );
    expect(r).toMatchObject({ ok: false, kind: "damaged" });
  });

  it("failed() throws for it, so the queue retries with a fresh render", async () => {
    const result = {
      ok: false as const,
      kind: "damaged" as const,
      message: "PDF structure damaged (xref_offset)",
    };
    const msg = { v: 1, kind: "pdf.render", documentId: "d", hop: 0 } as const;
    await expect(failed(env as never, msg, result, Date.now())).rejects.toThrow("pdf render failed: damaged");
  });
});

describe("putPdfOnce: the rendered bytes hashed once (audit A6, finding 5)", () => {
  it("one digest for a new file; the stored file and its hash when another render was first", async () => {
    const rendered = enc.encode("%PDF-1.4 rendered");
    const digest = vi.spyOn(crypto.subtle, "digest");
    const made = await putPdfOnce(env.DOCS, "t/pdf-once.pdf", rendered);
    expect(digest).toHaveBeenCalledTimes(1);
    digest.mockRestore();
    expect(made).toEqual({ bytes: rendered, sha256: await sha256Bytes(rendered) });
    const other = enc.encode("%PDF-1.4 a later render");
    const again = await putPdfOnce(env.DOCS, "t/pdf-once.pdf", other);
    expect(again).toEqual({ bytes: rendered, sha256: await sha256Bytes(rendered) });
  });
});

describe("putOnce with a checksum", () => {
  it("stores the object when the sha256 matches and refuses a mismatch", async () => {
    const bytes = enc.encode("%PDF-1.4 test");
    const ok = await putOnce(
      env.DOCS,
      "t/integrity-ok.pdf",
      bytes,
      "application/pdf",
      await sha256Bytes(bytes),
    );
    expect(ok).toEqual({ created: true });
    await expect(
      putOnce(
        env.DOCS,
        "t/integrity-bad.pdf",
        bytes,
        "application/pdf",
        await sha256Bytes(enc.encode("other")),
      ),
    ).rejects.toThrow();
  });
});
