// JOB-PDF-01 for the M5.2 types [B2, LD33, LD37; Researched 2026-10-28, Rule 96A CGST Rules (08-C RA-19)]: the snapshot step writes the envelope of an export invoice (LUT route and IGST route) and of a
// proforma from the rows alone (the sealed header extras are read from the frozen `header_extras`: no settings, no `Intl`), whatever Settings say afterwards;
// the render step refuses, before Browser Run, a page that does not carry the frozen endorsement or notice byte for byte as one text node, rings the owners' bell
// once and never retries. The page the layout makes is replaced by a controlled one (the `htmlOf` argument of `processRender`), so the integrity rule is tested whatever
// the layout prints; the statutory lines are held as LITERALS (seed file), not imported from core.
import { env as realEnv } from "cloudflare:workers";
import { type PdfMessage, pdfKeys } from "@techaust/core/pdf-jobs";
import { esc, parseInvoiceEnvelope, renderDocumentHtml, verifyInvoiceEnvelope } from "@techaust/pdf";
import { beforeEach, describe, expect, it } from "vitest";
import { stubPdf } from "../src/browser.ts";
import type { Clock } from "../src/pacer.ts";
import { processRender, processSnapshot } from "../src/pdf.ts";
import {
  LITERAL_ENDORSEMENT,
  LITERAL_PROFORMA_NOTICE,
  SAMPLE_ARN,
  type SeededInvoice,
  seedIssuedInvoice,
} from "./pdf-invoice-seed.ts";

/** The page the controlled layout prints; a test sets it before it renders (the real layout when null). */
const page: { html: null | ((v: Record<string, unknown>) => string) } = { html: null };
const renderWith = (env: Env, documentId: string, clock: Clock = fakeClock()) =>
  processRender(env, renderMsg(documentId), T0, clock, (v) =>
    page.html ? page.html(v as unknown as Record<string, unknown>) : renderDocumentHtml(v),
  );

const T0 = Date.UTC(2026, 9, 28, 6, 0, 0);
const one = <T>(sql: string, ...p: unknown[]) =>
  realEnv.DB.prepare(sql)
    .bind(...p)
    .first<T>();
const all = async <T>(sql: string, ...p: unknown[]) =>
  (
    await realEnv.DB.prepare(sql)
      .bind(...p)
      .all<T>()
  ).results;

type Sent = { body: PdfMessage };
const makeEnv = (browser: unknown) => {
  const sent: Sent[] = [];
  const env = {
    DB: realEnv.DB,
    DOCS: realEnv.DOCS,
    ENVIRONMENT: "local",
    PDF_RENDERER: "browser",
    PDF_MIN_SPACING_MS: "0",
    BROWSER: browser,
    PDF_QUEUE: {
      send: async (body: PdfMessage) => {
        sent.push({ body });
      },
      sendBatch: async (items: { body: PdfMessage }[]) => {
        for (const i of items) sent.push({ body: i.body });
      },
    },
  } as unknown as Env;
  return { env, sent };
};
const fakeClock = (): Clock => {
  let t = T0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
};
const fakeBrowser = () => {
  const calls: { html: string }[] = [];
  return {
    calls,
    binding: {
      quickAction: async (_a: "pdf", o: Record<string, unknown>) => {
        calls.push({ html: String(o.html) });
        return new Response(stubPdf(), {
          status: 200,
          headers: { "content-type": "application/pdf", "x-browser-ms-used": "1500" },
        });
      },
    },
  };
};
const snapshotMsg = (documentId: string) =>
  ({ v: 1, kind: "pdf.snapshot", documentId, reason: "send" }) as const;
const renderMsg = (documentId: string) => ({ v: 1, kind: "pdf.render", documentId, hop: 0 }) as const;
const keysOf = (s: SeededInvoice) => pdfKeys({ type: s.type, fy: "2026-27", number: s.number, version: 1 });

async function ready(o: Parameters<typeof seedIssuedInvoice>[0]) {
  const s = await seedIssuedInvoice(o);
  expect(await processSnapshot(makeEnv({}).env, snapshotMsg(s.id))).toBe("queued");
  return s;
}
const envelopeOf = async (s: SeededInvoice) => {
  const text = await (await realEnv.DOCS.get(keysOf(s).snapshot))?.text();
  return parseInvoiceEnvelope(text ?? "");
};

beforeEach(async () => {
  page.html = null;
  await realEnv.DB.batch([
    realEnv.DB.prepare("DELETE FROM notifications"),
    realEnv.DB.prepare("DELETE FROM stats_daily WHERE metric LIKE 'pdf.%'"),
  ]);
});

describe("the snapshot step for an export invoice and a proforma [LD37]", () => {
  it("an export invoice under LUT: the envelope has the frozen endorsement, the LUT letter, the country, the rate and the SWIFT block, verifies, and is queued", async () => {
    const s = await seedIssuedInvoice({ type: "export_invoice" });
    const { env, sent } = makeEnv({});
    expect(await processSnapshot(env, snapshotMsg(s.id))).toBe("queued");
    expect(keysOf(s).snapshot).toBe(
      `docs/export_invoice/2026-27/${String(s.number).padStart(4, "0")}-v1.json`,
    );
    const e = await envelopeOf(s);
    expect(e).not.toBeNull();
    expect(await verifyInvoiceEnvelope(e as NonNullable<typeof e>)).toEqual({ ok: true });
    const h = (e as NonNullable<typeof e>).snapshot.header;
    expect(h.export).toEqual({
      mode: "lut",
      endorsement: LITERAL_ENDORSEMENT.lut,
      lut: { fy: "2627", arn: SAMPLE_ARN },
      countryCode: "US",
      countryName: "United States",
      declarationRef: null,
    });
    expect(h.fx).toEqual({ rateMicros: 83_123_400, date: "2026-10-27", source: "FBIL reference rate" });
    expect(h.issuer.bank.swift).toMatchObject({ swift: "SAMPINBBXXX", purposeCode: "P0802" });
    expect(h.proforma).toBeUndefined();
    expect(sent).toEqual([{ body: { v: 1, kind: "pdf.render", documentId: s.id, hop: 0 } }]);
    // the extras are in the frozen column, as the real issue wrote them
    expect(
      JSON.parse(
        (await one<{ header_extras: string }>("SELECT header_extras FROM documents WHERE id = ?", s.id))
          ?.header_extras ?? "null",
      ),
    ).toEqual({ export: h.export });
  });

  it("the IGST route seals the IGST endorsement and no LUT", async () => {
    const s = await ready({ type: "export_invoice", exportMode: "igst_paid" });
    const e = (await envelopeOf(s)) as NonNullable<Awaited<ReturnType<typeof envelopeOf>>>;
    expect(await verifyInvoiceEnvelope(e)).toEqual({ ok: true });
    expect(e.snapshot.header.export).toMatchObject({
      mode: "igst_paid",
      endorsement: LITERAL_ENDORSEMENT.igst_paid,
      lut: null,
    });
  });

  it("a proforma: its notice is in the envelope, in its own series, and no export or rate part", async () => {
    const s = await ready({ type: "proforma" });
    expect(keysOf(s).snapshot).toMatch(/^docs\/proforma\/2026-27\/\d{4}-v1\.json$/);
    const e = (await envelopeOf(s)) as NonNullable<Awaited<ReturnType<typeof envelopeOf>>>;
    expect(await verifyInvoiceEnvelope(e)).toEqual({ ok: true });
    expect(e.snapshot.header.proforma).toEqual({ notice: LITERAL_PROFORMA_NOTICE });
    expect(e.snapshot.header.export).toBeUndefined();
    expect(e.snapshot.header.fx).toBeUndefined();
    expect(e.numberDisplay).toMatch(/^TH\/PI\/2627\/\d{4}$/);
  });

  it("the snapshot needs no settings: the letter, the route and the client's country edited after issue change nothing in it", async () => {
    const s = await seedIssuedInvoice({ type: "export_invoice" });
    await realEnv.DB.batch([
      realEnv.DB.prepare(
        "INSERT INTO settings (key, value, version) VALUES ('tax', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1",
      ).bind(
        JSON.stringify({ exportMode: "igst_paid", luts: [{ fy: "2627", arn: "CHANGED", filedOn: null }] }),
      ),
      realEnv.DB.prepare("UPDATE clients SET country = 'DE' WHERE id = ?").bind(s.clientId),
    ]);
    expect(await processSnapshot(makeEnv({}).env, snapshotMsg(s.id))).toBe("queued");
    const e = (await envelopeOf(s)) as NonNullable<Awaited<ReturnType<typeof envelopeOf>>>;
    expect(await verifyInvoiceEnvelope(e)).toEqual({ ok: true });
    expect(e.snapshot.header.export).toMatchObject({
      endorsement: LITERAL_ENDORSEMENT.lut,
      lut: { arn: SAMPLE_ARN },
      countryName: "United States",
    });
  });

  it("an export invoice whose frozen extras were lost (NULL) is refused: nothing is written, the owners are told, no render is queued", async () => {
    // sealed WITH the extras, frozen WITHOUT them (the seed's `dropFrozenExtras`): the rows cannot reproduce the seal
    const s = await seedIssuedInvoice({ type: "export_invoice", dropFrozenExtras: true });
    expect(
      (await one<{ header_extras: string | null }>("SELECT header_extras FROM documents WHERE id = ?", s.id))
        ?.header_extras,
    ).toBeNull();
    const { env, sent } = makeEnv({});
    expect(await processSnapshot(env, snapshotMsg(s.id))).toBe("refused");
    expect(await realEnv.DOCS.head(keysOf(s).snapshot)).toBeNull();
    expect(sent).toEqual([]);
    expect(
      await all("SELECT 1 FROM notifications WHERE kind = 'pdf.refused' AND entity_id = ?", s.id),
    ).not.toHaveLength(0);
  });
});

describe("the render step: the statutory line before Browser Run [LD33]", () => {
  const withLine = (v: Record<string, unknown>) => {
    const e = v.export as { endorsement: string } | null;
    const p = v.proforma as { notice: string } | null;
    return `<html><body><h1>${esc(String(v.docLabel))}</h1>${e ? `<p class="endorsement">${esc(e.endorsement)}</p>` : ""}${p ? `<p class="notice">${esc(p.notice)}</p>` : ""}</body></html>`;
  };

  it("an export invoice whose page carries its frozen endorsement renders: one Browser Run call, the PDF stored once, the row set", async () => {
    const s = await ready({ type: "export_invoice" });
    page.html = withLine;
    const clock = fakeClock();
    const b = fakeBrowser();
    expect(await renderWith(makeEnv(b.binding).env, s.id, clock)).toBe("rendered");
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]?.html).toContain(LITERAL_ENDORSEMENT.lut);
    const row = await one<{ pdf_r2_key: string }>("SELECT pdf_r2_key FROM documents WHERE id = ?", s.id);
    expect(row?.pdf_r2_key).toBe(keysOf(s).pdf);
  });

  it("a proforma whose page carries its frozen notice renders", async () => {
    const s = await ready({ type: "proforma" });
    page.html = withLine;
    const b = fakeBrowser();
    expect(await renderWith(makeEnv(b.binding).env, s.id)).toBe("rendered");
    expect(b.calls[0]?.html).toContain(LITERAL_PROFORMA_NOTICE);
  });

  it("an export invoice whose page lacks, rewords, splits or shortens its endorsement is refused BEFORE Browser Run: the bell rings once, nothing is stored, no retry is queued", async () => {
    const e = LITERAL_ENDORSEMENT.lut;
    const pages: [string, string][] = [
      ["lacks it", "<html><body><p>Export Invoice</p></body></html>"],
      ["one character more", `<p>${e.replace("UNDER BOND", "UNDER BONDS")}</p>`],
      ["shortened", `<p>${e.slice(0, -1)}</p>`],
      ["the other route's line", `<p>${LITERAL_ENDORSEMENT.igst_paid}</p>`],
      ["split in two", `<p>${e.slice(0, 50)}</p><p>${e.slice(50)}</p>`],
      ["inside a longer text", `<p>Note: ${e}</p>`],
    ];
    for (const [label, html] of pages) {
      const s = await ready({ type: "export_invoice" });
      page.html = () => html;
      const b = fakeBrowser();
      const { env, sent } = makeEnv(b.binding);
      expect(await renderWith(env, s.id), label).toBe("refused");
      expect(b.calls, label).toHaveLength(0);
      expect(sent, label).toEqual([]);
      expect(await realEnv.DOCS.head(keysOf(s).pdf), label).toBeNull();
      expect(
        (await one<{ pdf_r2_key: string | null }>("SELECT pdf_r2_key FROM documents WHERE id = ?", s.id))
          ?.pdf_r2_key,
        label,
      ).toBeNull();
      const bells = await all<{ kind: string; link: string }>(
        "SELECT kind, link FROM notifications WHERE entity_id = ?",
        s.id,
      );
      expect(bells, label).toEqual(
        expect.arrayContaining([{ kind: "pdf.refused", link: `/invoices/${s.id}` }]),
      );
      expect(
        bells.every((x) => x.kind === "pdf.refused"),
        label,
      ).toBe(true);
    }
  });

  it("a proforma whose page lacks or rewords its notice is refused the same way", async () => {
    for (const html of [
      "<p>Proforma Invoice</p>",
      `<p>${LITERAL_PROFORMA_NOTICE.replace("not a", "a")}</p>`,
      `<p>${LITERAL_PROFORMA_NOTICE} extra</p>`,
    ]) {
      const s = await ready({ type: "proforma" });
      page.html = () => html;
      const b = fakeBrowser();
      expect(await renderWith(makeEnv(b.binding).env, s.id), html).toBe("refused");
      expect(b.calls).toHaveLength(0);
    }
  });

  it("an ordinary tax invoice needs no such line: it renders with a page that has none", async () => {
    const s = await ready({});
    page.html = () => "<html><body><p>Tax Invoice</p></body></html>";
    const b = fakeBrowser();
    expect(await renderWith(makeEnv(b.binding).env, s.id)).toBe("rendered");
  });

  it("a stored envelope whose endorsement was changed is refused by the seal check, before any page is made", async () => {
    const s = await ready({ type: "export_invoice" });
    const key = keysOf(s).snapshot;
    const text = (await (await realEnv.DOCS.get(key))?.text()) ?? "";
    await realEnv.DOCS.put(key, text.replace("UNDER BOND", "UNDER BONDS"));
    page.html = withLine;
    const b = fakeBrowser();
    expect(await renderWith(makeEnv(b.binding).env, s.id)).toBe("refused");
    expect(b.calls).toHaveLength(0);
  });
});
