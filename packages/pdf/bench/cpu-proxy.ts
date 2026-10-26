// CPU proxy of the pure parts of the PDF snapshot and render steps at cap size, in Node (a lower bound of a Worker's CPU: no R2, no
// queue, no Browser Run). Per message: the snapshot step (rows -> sealed envelope: sealOf, content hash, terms hash, serialise) and the
// render step (parse + verify the envelope with core's real hash functions + view + Markdown + HTML). Phase 2: the real `contentHash`.
// Run: node bench/cpu-proxy.ts    (target: <= 3 ms warm per message; the report states the figures)
import { envelopeOfBundle } from "../src/bundle.ts";
import { parseEnvelope, serializeEnvelope, verifyEnvelope } from "../src/envelope.ts";
import { renderDocumentHtml } from "../src/render.ts";
import { toPdfView } from "../src/view.ts";
import { bundleOf } from "../test/fixtures/bundle.ts";
import { buildFixture } from "../test/fixtures/index.ts";

// Cap size: 100 lines (the engine's maximum), 16 sections of 1,800 characters (about the 30,000-character total), 12 KB of terms.
const { envelope } = await buildFixture("long-inter-inr", {
  lineCount: 100,
  sectionChars: 1_800,
  termsChars: 12_000,
});
const text = serializeEnvelope(envelope);

function once() {
  const e = parseEnvelope(text);
  if (e === null) throw new Error("parse");
  return e;
}
const timed = async (name: string, run: () => unknown | Promise<unknown>, n = 300) => {
  for (let i = 0; i < 50; i++) await run(); // warm up
  const c0 = process.cpuUsage();
  for (let i = 0; i < n; i++) await run();
  const c = process.cpuUsage(c0);
  return { name, ms: (c.user + c.system) / 1000 / n };
};

const bundle = bundleOf(envelope);
const results = [
  await timed("parse (JSON.parse of the envelope)", once),
  await timed("verify (snapshot hash + computed hash + terms hash + real content hash)", async () => {
    const r = await verifyEnvelope(once());
    if (!r.ok) throw new Error(r.code);
  }),
  await timed("view + Markdown + HTML", () => renderDocumentHtml(toPdfView(once()))),
  await timed("RENDER message total (parse + verify + view + HTML)", async () => {
    const e = once();
    const r = await verifyEnvelope(e);
    if (!r.ok) throw new Error(r.code);
    return renderDocumentHtml(toPdfView(e));
  }),
  await timed(
    "SNAPSHOT message total (rows -> envelope: sealOf + content hash + terms hash + serialise)",
    async () => {
      const r = await envelopeOfBundle(bundle);
      if (!r.ok) throw new Error(r.code);
      return serializeEnvelope(r.envelope);
    },
  ),
];
console.log(`envelope ${text.length} bytes, html ${renderDocumentHtml(toPdfView(envelope)).length} bytes`);
for (const r of results) console.log(`${r.ms.toFixed(2).padStart(7)} ms  ${r.name}`);
