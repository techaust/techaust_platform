// CPU proxy of the pure parts of the M4.5 requests, in Node (a lower bound of a Worker's CPU: no D1, no R2, no queue, no Browser Run):
//   - the portal page: parse the stored copy + `toPdfView` + `JSON.stringify` of the answer, at cap size (100 lines, 16 sections, 12 KB of terms)
//   - the portal accept: the typed-name rules and the status helpers it runs before and after its one D1 batch
//   - the certificate render: the page's HTML from its view (the Browser Run wall time is not CPU; the HTML build and the put are)
//   - the offer link: 32 random bytes + SHA-256 (the jobs `offer.send` and the portal's link check)
// Run: node bench/offers-cpu.ts    (target: each well under 3 ms warm; the report states the figures)
import { normaliseTypedName, todayIst } from "@techaust/core/offers";
import { serializeEnvelope } from "../src/envelope.ts";
import { renderCertificateHtml } from "../src/render.ts";
import { parseEnvelope as parseViaEntry, toPdfView as viewViaEntry } from "../src/view-entry.ts";
import { buildFixture } from "../test/fixtures/index.ts";

const { envelope } = await buildFixture("long-inter-inr", {
  lineCount: 100,
  sectionChars: 1_800,
  termsChars: 12_000,
});
const text = serializeEnvelope(envelope);

const timed = async (name: string, run: () => unknown | Promise<unknown>, n = 300) => {
  for (let i = 0; i < 50; i++) await run(); // warm up
  const c0 = process.cpuUsage();
  for (let i = 0; i < n; i++) await run();
  const c = process.cpuUsage(c0);
  return { name, ms: (c.user + c.system) / 1000 / n };
};

const certificate = {
  number: "TH/PRP/2627/0003",
  version: "2",
  total: "₹2,95,000.00",
  kind: "Proposal",
  title: "Website rebuild",
  clientLegalName: "Sample Traders Pvt Ltd",
  typedName: "Asha Rao",
  email: "asha@example.test",
  acceptedAtIst: "26 Oct 2026, 10:30 IST",
  acceptedAtUtc: "2026-10-26 05:00:00 UTC",
  ip: "203.0.113.9",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  country: "IN",
  via: "link",
  pdfSha256: "a".repeat(64),
  snapshotSha256: "b".repeat(64),
  termsVersion: "4",
  termsSha256: "c".repeat(64),
};

const view = () => {
  const e = parseViaEntry(text);
  if (e === null) throw new Error("parse");
  return viewViaEntry(e);
};
const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

const results = [
  await timed("portal page: parse + toPdfView (cap size)", view),
  await timed("portal page: parse + toPdfView + JSON.stringify of the answer", () =>
    JSON.stringify({ view: view() }),
  ),
  await timed(
    "portal accept: typed-name rules + today (IST)",
    () => {
      normaliseTypedName("  Asha   Rao ");
      return todayIst(Date.now());
    },
    3000,
  ),
  await timed("certificate render: HTML of the page", () => renderCertificateHtml(certificate)),
  await timed(
    "offer link: 32 random bytes + SHA-256",
    async () => {
      const raw = crypto.getRandomValues(new Uint8Array(32));
      return hex(await crypto.subtle.digest("SHA-256", raw));
    },
    3000,
  ),
];
console.log(
  `stored copy ${text.length} bytes, answer ${JSON.stringify({ view: view() }).length} bytes, certificate html ${renderCertificateHtml(certificate).length} bytes`,
);
for (const r of results) console.log(`${r.ms.toFixed(3).padStart(8)} ms  ${r.name}`);
