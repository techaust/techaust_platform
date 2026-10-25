// Offer links, send rows and certificates at the database (M4.5; ADM-PROP-07, ADM-PROP-08, POR-05): the `offer_triggers`
// set (0034) and the columns of 0033. Failure paths first.
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { first, insertClient, rejects, run } from "./helpers.ts";
import { mkQuote, staffId } from "./quotes.ts";

async function setup() {
  const q = await mkQuote();
  const contact = uuidv7();
  await run(
    "INSERT INTO contacts (id, client_id, name, email, portal_access) VALUES (?1, ?2, 'A Contact', ?3, 1)",
    contact,
    q.clientId,
    `${contact}@example.test`,
  );
  const send = uuidv7();
  await run(
    "INSERT INTO document_sends (id, document_id, version_group_id, client_id, contact_id, email, attach_pdf, kind, created_by) VALUES (?1, ?2, ?3, ?4, ?5, 'a@example.test', 1, 'send', ?6)",
    send,
    q.id,
    q.groupId,
    q.clientId,
    contact,
    await staffId(),
  );
  const hash = `h-${uuidv7()}`;
  await run(
    "INSERT INTO offer_links (token_hash, send_id, document_id, version_group_id, client_id, contact_id, email, purpose, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'a@example.test', 'offer', 9999999999999)",
    hash,
    send,
    q.id,
    q.groupId,
    q.clientId,
    contact,
  );
  return { q, contact, send, hash };
}

describe("offer_links (0033, 0034)", () => {
  it("refuses an unknown purpose on insert and on update; accepts offer and confirmation", async () => {
    const s = await setup();
    await rejects(
      run(
        "INSERT INTO offer_links (token_hash, document_id, version_group_id, client_id, contact_id, email, purpose, expires_at) VALUES ('p1', ?1, ?2, ?3, ?4, 'a@example.test', 'view_pay', 1)",
        s.q.id,
        s.q.groupId,
        s.q.clientId,
        s.contact,
      ),
      /offer_links_purpose/,
    );
    await rejects(
      run("UPDATE offer_links SET purpose = 'x' WHERE token_hash = ?", s.hash),
      /offer_links_(purpose|fixed)/,
    );
    await run(
      "INSERT INTO offer_links (token_hash, document_id, version_group_id, client_id, contact_id, email, purpose, expires_at) VALUES ('p2', ?1, ?2, ?3, ?4, 'a@example.test', 'confirmation', 1)",
      s.q.id,
      s.q.groupId,
      s.q.clientId,
      s.contact,
    );
  });

  it("only revoked_at may change, and only once from NULL", async () => {
    const s = await setup();
    await rejects(
      run("UPDATE offer_links SET expires_at = 1 WHERE token_hash = ?", s.hash),
      /offer_links_fixed/,
    );
    await rejects(
      run("UPDATE offer_links SET email = 'b@example.test' WHERE token_hash = ?", s.hash),
      /offer_links_fixed/,
    );
    await run("UPDATE offer_links SET revoked_at = 5 WHERE token_hash = ? AND revoked_at IS NULL", s.hash);
    await rejects(
      run("UPDATE offer_links SET revoked_at = 6 WHERE token_hash = ?", s.hash),
      /offer_links_fixed/,
    );
    await rejects(
      run("UPDATE offer_links SET revoked_at = NULL WHERE token_hash = ?", s.hash),
      /offer_links_fixed/,
    );
    expect(
      (await first<{ revoked_at: number }>("SELECT revoked_at FROM offer_links WHERE token_hash = ?", s.hash))
        ?.revoked_at,
    ).toBe(5);
  });

  it("a link can be deleted (erase removes a contact's links)", async () => {
    const s = await setup();
    await run("DELETE FROM offer_links WHERE contact_id = ?", s.contact);
    expect(await first("SELECT 1 FROM offer_links WHERE token_hash = ?", s.hash)).toBeNull();
  });

  it("foreign keys hold: a link needs a real contact", async () => {
    const s = await setup();
    await rejects(
      run(
        "INSERT INTO offer_links (token_hash, document_id, version_group_id, client_id, contact_id, email, purpose, expires_at) VALUES ('p3', ?1, ?2, ?3, 'nobody', 'a@example.test', 'offer', 1)",
        s.q.id,
        s.q.groupId,
        s.q.clientId,
      ),
      /FOREIGN KEY/,
    );
  });
});

describe("document_sends (0033, 0034)", () => {
  it("queued_at is set once; identity columns never change", async () => {
    const s = await setup();
    await rejects(
      run("UPDATE document_sends SET kind = 'resend' WHERE id = ?", s.send),
      /document_sends_fixed/,
    );
    await rejects(
      run("UPDATE document_sends SET attach_pdf = 0 WHERE id = ?", s.send),
      /document_sends_fixed/,
    );
    await rejects(
      run("UPDATE document_sends SET email = 'b@example.test' WHERE id = ?", s.send),
      /document_sends_fixed/,
    );
    await run("UPDATE document_sends SET queued_at = 10 WHERE id = ?", s.send);
    await rejects(
      run("UPDATE document_sends SET queued_at = 11 WHERE id = ?", s.send),
      /document_sends_fixed/,
    );
    await rejects(
      run("UPDATE document_sends SET queued_at = NULL WHERE id = ?", s.send),
      /document_sends_fixed/,
    );
  });

  it("contact_id and email can be cleared (erase, anonymise) but never re-pointed", async () => {
    const s = await setup();
    const other = await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`);
    await rejects(
      run("UPDATE document_sends SET client_id = ? WHERE id = ?", other, s.send),
      /document_sends_fixed/,
    );
    await run("UPDATE document_sends SET contact_id = NULL, email = NULL WHERE id = ?", s.send);
    const row = await first<{ contact_id: string | null; email: string | null }>(
      "SELECT contact_id, email FROM document_sends WHERE id = ?",
      s.send,
    );
    expect(row).toEqual({ contact_id: null, email: null });
    await rejects(
      run("UPDATE document_sends SET email = 'x@example.test' WHERE id = ?", s.send),
      /document_sends_fixed/,
    );
  });

  it("the waiting-rows index is partial and the sweep reads use it", async () => {
    const plan = await first<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT id FROM document_sends WHERE document_id = ?1 AND queued_at IS NULL",
      "x",
    );
    expect(plan?.detail).toMatch(/document_sends_(waiting|document)/);
  });
});

describe("acceptances (0033) and acceptance_certificates (0034)", () => {
  async function accepted() {
    const s = await setup();
    const acc = uuidv7();
    await run(
      "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256, via, offer_link_hash, snapshot_sha256) VALUES (?1, ?2, ?3, 'A Contact', 'a@example.test', 1000, 'pdfsha', 'link', ?4, 'snapsha')",
      acc,
      s.q.id,
      s.contact,
      s.hash,
    );
    return { ...s, acc };
  }

  it("stores the M4.5 evidence columns, and stays append-only", async () => {
    const a = await accepted();
    const row = await first<{ via: string; offer_link_hash: string; snapshot_sha256: string }>(
      "SELECT via, offer_link_hash, snapshot_sha256 FROM acceptances WHERE id = ?",
      a.acc,
    );
    expect(row).toEqual({ via: "link", offer_link_hash: a.hash, snapshot_sha256: "snapsha" });
    await rejects(run("UPDATE acceptances SET via = 'session' WHERE id = ?", a.acc), /append-only/);
  });

  it("certificates are append-only, one per acceptance, and need a real acceptance", async () => {
    const a = await accepted();
    await rejects(
      run(
        "INSERT INTO acceptance_certificates (acceptance_id, r2_key, sha256, rendered_at) VALUES ('nope', 'k', 's', 1)",
      ),
      /FOREIGN KEY/,
    );
    await run(
      "INSERT INTO acceptance_certificates (acceptance_id, r2_key, sha256, rendered_at) VALUES (?, 'docs/proposal/2627/0001-v1-certificate.pdf', 's', 1)",
      a.acc,
    );
    await rejects(
      run(
        "INSERT INTO acceptance_certificates (acceptance_id, r2_key, sha256, rendered_at) VALUES (?, 'k2', 's', 2)",
        a.acc,
      ),
      /UNIQUE|PRIMARY/,
    );
    await rejects(
      run("UPDATE acceptance_certificates SET r2_key = 'x' WHERE acceptance_id = ?", a.acc),
      /append-only/,
    );
    await rejects(run("DELETE FROM acceptance_certificates WHERE acceptance_id = ?", a.acc), /append-only/);
  });

  it("the sweep's lookup uses acceptances_accepted_at", async () => {
    const plan = await first<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT a.id FROM acceptances a WHERE a.accepted_at < ?1 AND NOT EXISTS (SELECT 1 FROM acceptance_certificates c WHERE c.acceptance_id = a.id) ORDER BY a.accepted_at LIMIT 20",
      1,
    );
    expect(plan?.detail).toMatch(/acceptances_accepted_at/);
  });
});
