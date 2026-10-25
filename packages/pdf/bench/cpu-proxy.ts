// CPU proxy of the pure parts of the PDF snapshot and render steps at cap size, in Node (a lower bound of a Worker's CPU: no R2, no
// queue, no Browser Run). Per message: parse + verify the envelope (hashes included) and view + Markdown + HTML.
// Run: node bench/cpu-proxy.ts    (target: <= 3 ms warm per message; the report states the figures)
import { parseEnvelope, serializeEnvelope, verifyEnvelope } from "../src/envelope.ts";
import { renderDocumentHtml } from "../src/render.ts";
import { toPdfView } from "../src/view.ts";
import { buildFixture, testContentHash } from "../test/fixtures/index.ts";

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

const results = [
  await timed("parse (JSON.parse of the envelope)", once),
  await timed("verify (3 hashes + content hash stand-in)", async () => {
    const r = await verifyEnvelope(once(), testContentHash);
    if (!r.ok) throw new Error(r.code);
  }),
  await timed("view + Markdown + HTML", () => renderDocumentHtml(toPdfView(once()))),
  await timed("render message total (parse + view + HTML)", () => renderDocumentHtml(toPdfView(once()))),
  await timed("snapshot message total (parse + verify + serialise)", async () => {
    const e = once();
    await verifyEnvelope(e, testContentHash);
    return serializeEnvelope(e);
  }),
];
console.log(`envelope ${text.length} bytes, html ${renderDocumentHtml(toPdfView(envelope)).length} bytes`);
for (const r of results) console.log(`${r.ms.toFixed(2).padStart(7)} ms  ${r.name}`);
