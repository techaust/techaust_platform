// T11 in the jobs Worker (run file docs/runs/t11-deed.md, L4, L5; 08-C RB-38(a), RB-21; POR-05): the `pdf.deed` consumer (render once, write-once in DOCS, the
// row set once, an object already stored adopted, a tampered snapshot refused with the owners' bell, a draft and an erased client skipped, staging rendered
// once the designed layout replaced the placeholder, the queue routing) and the `deed.signed` expansion (one email per live portal contact, sent once per deed and person). Browser Run is a fake
// binding. All names, numbers and amounts are invented test data.
import { env as realEnv } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { type DeedSnapshot, deedSnapshotJson, deedUnsignedKey } from "@techaust/core/deeds";
import { sha256Hex } from "@techaust/core/hash";
import type { Transport } from "@techaust/email";
import { describe, expect, it } from "vitest";
import { stubPdf } from "../src/browser.ts";
import { processDeedPdf, processDeedSigned } from "../src/deed-pdf.ts";
import { processEmail } from "../src/email.ts";
import type { Clock } from "../src/pacer.ts";
import { handleQueue } from "../src/queue.ts";
import {
  all,
  emailsQueued,
  fakes,
  makeEnv,
  mkClient,
  mkContact,
  mkDoc,
  one,
  PORTAL,
  run,
  staff,
  useFakes,
} from "./billing-fixtures.ts";

useFakes();

const NOW = Date.UTC(2026, 10, 2, 6, 0, 0);
const clock: Clock = { now: () => NOW, sleep: async () => undefined };

const pdfResponse = () =>
  new Response(stubPdf(), {
    status: 200,
    headers: { "content-type": "application/pdf", "x-browser-ms-used": "900" },
  });

function browser() {
  const pages: string[] = [];
  return {
    pages,
    binding: {
      quickAction: async (_a: "pdf", options: { html: string }) => {
        pages.push(options.html);
        return pdfResponse();
      },
    },
  };
}

const mkEnv = (b = browser(), extra: Record<string, unknown> = {}) =>
  makeEnv({
    DOCS: realEnv.DOCS,
    PDF_RENDERER: "browser",
    PDF_MIN_SPACING_MS: "0",
    BROWSER: b.binding,
    ...extra,
  });

const SNAPSHOT: DeedSnapshot = {
  layout: "deed-v1",
  madeOn: "2026-11-01",
  supplier: { address: "1 Sample Road, Balurghat", gstin: "19ABCDE1234F1Z5" },
  client: { legalName: "Sample Traders Pvt Ltd", address: "4 Sample Street, Kolkata, India", reg: null },
  offer: { docType: "proposal", number: "TH/PRP/2627/0007", version: 1, acceptedOn: "2026-10-05" },
  payment: { invoiceNumbers: ["TH/INV/2627/0009"], amountPaidMinor: 118_000, currency: "INR" },
  schedule1: { deliverables: "Website source", location: "Git repository", deliveredDates: "28 Oct 2026" },
  schedule2: { tools: "None", thirdParty: "Astro (MIT licence)" },
};

let deedNo = 0;

/** A client, an accepted proposal, a project made from it, and its deed in `status` (final by default). `badSeal` stores a SHA-256 that is not the snapshot's. */
async function mkDeed(o: { status?: "draft" | "final" | "signed"; badSeal?: boolean } = {}) {
  const owner = await staff("owner");
  const clientId = await mkClient();
  const proposal = await mkDoc(clientId, null, { type: "proposal", status: "accepted" });
  const projectId = uuidv7();
  await run(
    "INSERT INTO projects (id, code, client_id, name, status, currency, source_document_id) VALUES (?1, ?2, ?3, 'Website', 'completed', 'INR', ?4)",
    projectId,
    `PRJ-D${++deedNo}`,
    clientId,
    proposal.id,
  );
  const id = `deed_${uuidv7().replaceAll("-", "")}`;
  await run(
    "INSERT INTO deeds (id, client_id, project_id, source_document_id, status) VALUES (?1, ?2, ?3, ?4, 'draft')",
    id,
    clientId,
    projectId,
    proposal.id,
  );
  const snapshot = deedSnapshotJson(SNAPSHOT);
  const sha = o.badSeal ? "0".repeat(64) : await sha256Hex(snapshot);
  const number = `TH/DA/2627/${String(deedNo).padStart(4, "0")}`;
  if ((o.status ?? "final") !== "draft")
    await run(
      `UPDATE deeds SET status = 'final', fy = '2627', number = ?2, number_display = ?3, made_on = '2026-11-01', snapshot = ?4, snapshot_sha256 = ?5,
         finalised_at = 1, finalised_by = ?6, sched_deliverables = 'a', sched_location = 'b', sched_delivered_dates = 'c', sched_tools = 'None', sched_third_party = 'e'
       WHERE id = ?1`,
      id,
      deedNo,
      number,
      snapshot,
      sha,
      owner.id,
    );
  if (o.status === "signed")
    await run(
      `UPDATE deeds SET status = 'signed', signed_r2_key = ?2, signed_sha256 = ?3, signed_size = 10, esign_at = 2, esign_txn = 'TXN-1', signed_at = 3, signed_by = ?4
       WHERE id = ?1`,
      id,
      `deeds/${id}/signed-${"a".repeat(64)}`,
      "a".repeat(64),
      owner.id,
    );
  return { id, owner, clientId, projectId, proposal, sha, number };
}

const msg = (deedId: string) => ({ v: 1 as const, kind: "pdf.deed" as const, deedId, hop: 0 });
const deedRow = (id: string) =>
  one<{ unsigned_r2_key: string | null; unsigned_sha256: string | null; updated_at: number }>(
    "SELECT unsigned_r2_key, unsigned_sha256, updated_at FROM deeds WHERE id = ?",
    id,
  );

describe("pdf.deed [T11 L4]", () => {
  it("renders the deed's text once, writes it once at its sealed key, sets the row once and leaves updated_at alone", async () => {
    const d = await mkDeed();
    const before = await deedRow(d.id);
    const b = browser();
    expect(await processDeedPdf(mkEnv(b), msg(d.id), NOW, clock)).toBe("rendered");
    expect(b.pages).toHaveLength(1);
    expect(b.pages[0]).toContain(`Deed of assignment of copyright · No. ${d.number}`);
    expect(b.pages[0]).toContain("Stamp duty: Not stamped at signing.");
    const row = await deedRow(d.id);
    expect(row?.unsigned_r2_key).toBe(deedUnsignedKey(d.id, d.sha));
    expect(row?.unsigned_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.updated_at).toBe(before?.updated_at);
    const stored = await realEnv.DOCS.get(deedUnsignedKey(d.id, d.sha));
    expect(stored).not.toBeNull();
    await stored?.arrayBuffer();
    // A repeat (a redelivery, or the Owner's "render again" racing it) does nothing: no second render.
    expect(await processDeedPdf(mkEnv(b), msg(d.id), NOW, clock)).toBe("skipped");
    expect(b.pages).toHaveLength(1);
  });

  it("adopts an object already stored at the key (an earlier run whose row update was lost): no render", async () => {
    const d = await mkDeed();
    await realEnv.DOCS.put(deedUnsignedKey(d.id, d.sha), stubPdf());
    const b = browser();
    expect(await processDeedPdf(mkEnv(b), msg(d.id), NOW, clock)).toBe("adopted");
    expect(b.pages).toHaveLength(0);
    expect((await deedRow(d.id))?.unsigned_r2_key).toBe(deedUnsignedKey(d.id, d.sha));
  });

  it("refuses a tampered snapshot (its SHA-256 is not the sealed one): the owners' bell once, nothing rendered or stored", async () => {
    const d = await mkDeed({ badSeal: true });
    const b = browser();
    expect(await processDeedPdf(mkEnv(b), msg(d.id), NOW, clock)).toBe("refused");
    expect(await processDeedPdf(mkEnv(b), msg(d.id), NOW, clock)).toBe("refused");
    expect(b.pages).toHaveLength(0);
    expect((await deedRow(d.id))?.unsigned_r2_key).toBeNull();
    const bells = await all<{ title: string; link: string }>(
      "SELECT title, link FROM notifications WHERE kind = 'pdf.refused' AND entity_type = 'deed' AND entity_id = ? AND user_id = ?",
      d.id,
      d.owner.id,
    );
    expect(bells).toEqual([
      { title: `[Placeholder] pdf.refused ${d.number}`, link: `/projects/${d.projectId}` },
    ]);
  });

  it("skips a draft, an unknown deed and an erased client's deed", async () => {
    const b = browser();
    const draft = await mkDeed({ status: "draft" });
    expect(await processDeedPdf(mkEnv(b), msg(draft.id), NOW, clock)).toBe("skipped");
    expect(await processDeedPdf(mkEnv(b), msg("deed_none"), NOW, clock)).toBe("skipped");
    const gone = await mkDeed();
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", gone.clientId);
    expect(await processDeedPdf(mkEnv(b), msg(gone.id), NOW, clock)).toBe("skipped");
    expect(b.pages).toHaveLength(0);
  });

  it("renders on staging too, now that the layout is the designed one (DEED_LAYOUT_PLACEHOLDER is false)", async () => {
    const b = browser();
    const staging = await mkDeed();
    expect(await processDeedPdf(mkEnv(b, { ENVIRONMENT: "staging" }), msg(staging.id), NOW, clock)).toBe(
      "rendered",
    );
    expect(b.pages).toHaveLength(1);
    expect(b.pages[0]).not.toContain("[Placeholder]");
  });

  it("the PDF queue routes pdf.deed to its consumer and acknowledges it", async () => {
    const d = await mkDeed();
    const out: string[] = [];
    await handleQueue(
      {
        queue: "techaust-local-pdf",
        messages: [
          {
            id: uuidv7(),
            body: msg(d.id),
            attempts: 1,
            ack: () => out.push("ack"),
            retry: () => out.push("retry"),
          },
        ],
      } as never,
      mkEnv(),
    );
    expect(out).toEqual(["ack"]);
    expect((await deedRow(d.id))?.unsigned_r2_key).not.toBeNull();
  });
});

describe("deed.signed [T11 L4, POR-05]", () => {
  const transport: Transport = { send: async () => ({ kind: "sent", messageId: "m-1" }) };

  it("one email per live portal contact, naming the deed and linking the proposal's portal page; sent once per deed and person", async () => {
    const d = await mkDeed({ status: "signed" });
    const asha = await mkContact(d.clientId, { name: "Asha Rao" });
    const ravi = await mkContact(d.clientId, { name: "Ravi Sen" });
    await mkContact(d.clientId, { portal: false });
    await mkContact(d.clientId, { anonymised: true });
    const env = makeEnv();
    expect(await processDeedSigned(env, { kind: "deed.signed", deedId: d.id })).toEqual({
      outcome: "queued",
      queued: 2,
    });
    const mails = emailsQueued();
    expect(mails.map((m) => m.to).sort()).toEqual([asha.email, ravi.email].sort());
    expect(mails[0]).toMatchObject({
      template: "deed.signed",
      entity: { type: "deed", id: d.id },
      data: {
        number: d.number,
        offer_type: "proposal",
        offer_number: d.proposal.numberDisplay,
        offer_version: "1",
        url: `${PORTAL.replace(/\/$/, "")}/proposals/${d.proposal.id}`,
      },
    });
    // A redelivered expansion queues the same emails again; the email consumer sends each once.
    await processDeedSigned(env, { kind: "deed.signed", deedId: d.id });
    const results = [];
    for (const m of emailsQueued()) results.push(await processEmail(env, m, transport, NOW));
    expect(results.sort()).toEqual(["duplicate", "duplicate", "sent", "sent"]);
    expect(
      (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM email_log WHERE template = 'deed.signed' AND entity_id = ?",
          d.id,
        )
      )?.n,
    ).toBe(2);
  });

  it("nothing for a deed that is not signed, an erased client, or a malformed body; the email queue routes the family", async () => {
    const final = await mkDeed();
    await mkContact(final.clientId);
    expect((await processDeedSigned(makeEnv(), { kind: "deed.signed", deedId: final.id })).outcome).toBe(
      "skipped",
    );
    const gone = await mkDeed({ status: "signed" });
    await mkContact(gone.clientId);
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", gone.clientId);
    expect((await processDeedSigned(makeEnv(), { kind: "deed.signed", deedId: gone.id })).outcome).toBe(
      "skipped",
    );
    expect((await processDeedSigned(makeEnv(), { kind: "deed.signed" })).outcome).toBe("invalid");
    expect(fakes.email).toHaveLength(0);

    const signed = await mkDeed({ status: "signed" });
    await mkContact(signed.clientId);
    const out: string[] = [];
    await handleQueue(
      {
        queue: "techaust-local-email",
        messages: [
          {
            id: uuidv7(),
            body: { kind: "deed.signed", deedId: signed.id },
            attempts: 1,
            ack: () => out.push("ack"),
            retry: () => out.push("retry"),
          },
        ],
      } as never,
      makeEnv(),
    );
    expect(out).toEqual(["ack"]);
    expect(emailsQueued().filter((m) => m.template === "deed.signed")).toHaveLength(1);
  });
});
