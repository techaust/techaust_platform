// The frozen TEXT of a sent proposal or estimate after its client or contact was anonymised (M4.3 re-check 2, finding 1; the owner's rule
// of 2026-10-26, VERIFY WITH CA/LEGAL). The seed templates write `{{client.name}}` and `{{client.contact}}` into the sections at draft time,
// and that text is frozen at send. The staff view takes every exact occurrence of the frozen names and email out of the section texts, the
// section titles and the document title; the stored rows and their hash stay as sent, byte for byte.
import { env } from "cloudflare:workers";
import { seedStatements } from "@techaust/db";
import { beforeAll, describe, expect, it } from "vitest";
import { ANONYMISED_LABEL, redactionNames, redactor, viewRecipient } from "./document-view.ts";
import { putPaymentTerms } from "./test-catalogue.ts";
import { rows, sessionFor } from "./test-helpers.ts";
import {
  getDoc,
  type J,
  json,
  mkDraft,
  mkQuoteClient,
  mkService,
  mkTerms,
  patchDoc,
  sendDoc,
} from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
  await env.DB.batch(
    seedStatements()
      .filter((s) => s.startsWith("INSERT INTO `templates`"))
      .map((s) => env.DB.prepare(s)),
  );
});

const plain = (x: J, over: J = {}) => ({
  id: x.id,
  kind: x.kind,
  title: x.title,
  bodyMd: x.bodyMd,
  hidden: x.hidden,
  ...over,
});

/** A draft from the seeded template for `type`, titled with the client's name, the empty sections hidden, sent. */
async function sentFromTemplate(type: "proposal" | "estimate") {
  const o = await owner();
  const names = { legal: "Acme Studio Pvt Ltd", display: "Acme Studio" };
  const client = await mkQuoteClient({ legal_name: names.legal, display_name: names.display });
  const made = await mkDraft(o, {
    type,
    clientId: client.clientId,
    contactId: client.contactId,
    item: await mkService(500_000, {
      short: "A new website",
      deliverables_md: "- Five pages",
      assumptions_md: "- Content supplied",
      exclusions_md: "- Hosting",
    }),
  });
  let view = await getDoc(o, made.id);
  const empty = view.blockers.find((b: J) => b.code === "section_empty");
  const hide = new Set<string>(empty?.sections ?? []);
  const saved = await patchDoc(o, made.id, {
    expectedUpdatedAt: view.updatedAt,
    fields: { title: `Website for ${names.display} (${names.legal})` },
    sections: view.sections.map((x: J) => plain(x, hide.has(x.id) ? { bodyMd: "", hidden: true } : {})),
  });
  expect(saved.status, await saved.clone().text()).toBe(200);
  view = await getDoc(o, made.id);
  const res = await sendDoc(o, made.id, view.updatedAt);
  expect(res.status, await res.clone().text()).toBe(200);
  await json(res);
  return { o, made, names, contactName: "Asha Rao", contactEmail: client.email };
}

const stored = async (id: string) => ({
  document: await rows("SELECT * FROM documents WHERE id = ?", id),
  sections: await rows("SELECT * FROM document_sections WHERE document_id = ? ORDER BY position", id),
});

/** Everything the view prints as text: the title, each section's title and text. */
const printed = (v: J) =>
  [v.title, ...v.sections.flatMap((s: J) => [s.title, s.bodyMd])].filter(Boolean).join("\n");

for (const type of ["proposal", "estimate"] as const) {
  describe(`a sent ${type} made from the seed template`, () => {
    it("client anonymised: no section text, section title or title holds the names or the email; the stored rows are byte-identical", async () => {
      const { o, made, names, contactName, contactEmail } = await sentFromTemplate(type);
      const before = JSON.stringify(await stored(made.id));
      const sent = await getDoc(o, made.id);
      // as sent, the frozen text does name the client
      expect(printed(sent)).toContain(names.display);
      expect(printed(sent)).toContain(names.legal);
      if (type === "proposal") expect(printed(sent)).toContain(`Prepared for ${contactName}.`);

      await env.DB.prepare("UPDATE clients SET anonymised_at = ? WHERE id = ?")
        .bind(Date.now(), made.clientId)
        .run();
      const view = await getDoc(o, made.id);
      const text = printed(view);
      for (const secret of [names.display, names.legal, contactName, contactEmail])
        expect(text, secret).not.toContain(secret);
      expect(text).toContain(ANONYMISED_LABEL);
      expect(view.title).toBe(`Website for ${ANONYMISED_LABEL} (${ANONYMISED_LABEL})`);
      if (type === "proposal") {
        const acceptance = view.sections.find((s: J) => s.kind === "acceptance");
        expect(acceptance.bodyMd).toMatch(new RegExp(`^Prepared for ${ANONYMISED_LABEL}\\.`));
      }
      // the stored text, the hash and the sections are exactly as sent
      expect(JSON.stringify(await stored(made.id))).toBe(before);
      expect(view.contentSha256).toBe(sent.contentSha256);
    });

    it("only the contact anonymised: the contact's name and email go, the business name in the text stays", async () => {
      const { o, made, names, contactName, contactEmail } = await sentFromTemplate(type);
      const before = JSON.stringify(await stored(made.id));
      await env.DB.prepare(
        "UPDATE contacts SET anonymised_at = ?, name = 'Removed contact', email = 'removed-9@invalid.example' WHERE id = ?",
      )
        .bind(Date.now(), made.contactId)
        .run();
      const view = await getDoc(o, made.id);
      const text = printed(view);
      expect(text).not.toContain(contactName);
      expect(text).not.toContain(contactEmail);
      expect(text).toContain(names.display);
      expect(text).toContain(names.legal);
      expect(view.client.name).toBe(names.display);
      expect(view.title).toBe(`Website for ${names.display} (${names.legal})`);
      if (type === "proposal") {
        const acceptance = view.sections.find((s: J) => s.kind === "acceptance");
        expect(acceptance.bodyMd).toMatch(new RegExp(`^Prepared for ${ANONYMISED_LABEL}\\.`));
      }
      expect(JSON.stringify(await stored(made.id))).toBe(before);
    });
  });
}

describe("a sent version nobody anonymised", () => {
  it("shows its text exactly as sent", async () => {
    const { o, made, names } = await sentFromTemplate("proposal");
    const view = await getDoc(o, made.id);
    const rowsNow = await rows<{ body_md: string | null }>(
      "SELECT body_md FROM document_sections WHERE document_id = ? ORDER BY position",
      made.id,
    );
    expect(view.sections.map((s: J) => s.bodyMd)).toEqual(rowsNow.map((r) => r.body_md));
    expect(view.title).toBe(`Website for ${names.display} (${names.legal})`);
  });
});

describe("redactionNames and redactor", () => {
  const r = {
    legalName: "Acme Studio Pvt Ltd",
    displayName: "Acme Studio",
    email: "a+b@acme.example.test",
    country: "IN",
    contactId: "c1",
    contactName: "Asha (Ops) Rao",
    clientType: "business" as const,
    gstStatus: "unregistered" as const,
  };
  it("lists the names that apply, trimmed, without blanks or repeats", () => {
    expect(redactionNames(r, true, true)).toEqual([
      "Acme Studio Pvt Ltd",
      "Acme Studio",
      "Asha (Ops) Rao",
      "a+b@acme.example.test",
    ]);
    expect(redactionNames(r, false, true)).toEqual(["Asha (Ops) Rao", "a+b@acme.example.test"]);
    expect(redactionNames(r, false, false)).toEqual([]);
    const { contactName: _n, email: _e, ...noContact } = r;
    expect(redactionNames({ ...noContact, displayName: "   " }, true, false)).toEqual([
      "Acme Studio Pvt Ltd",
    ]);
    expect(redactionNames({ ...r, displayName: "Acme Studio Pvt Ltd" }, true, false)).toEqual([
      "Acme Studio Pvt Ltd",
      "Asha (Ops) Rao",
      "a+b@acme.example.test",
    ]);
  });
  it("replaces the longest name first, in one pass, treating the characters of a name as plain text", () => {
    const redact = redactor(redactionNames(r, true, true));
    expect(redact("Acme Studio Pvt Ltd and Acme Studio; Asha (Ops) Rao <a+b@acme.example.test>")).toBe(
      `${ANONYMISED_LABEL} and ${ANONYMISED_LABEL}; ${ANONYMISED_LABEL} <${ANONYMISED_LABEL}>`,
    );
    expect(redact("Asha (Ops) Rao. Asha Ops Rao")).toBe(`${ANONYMISED_LABEL}. Asha Ops Rao`);
    expect(redact(null)).toBeNull();
    expect(redactor([])("unchanged")).toBe("unchanged");
    // a name that is a part of the label is not searched for again in the replacement
    expect(redactor(["client"])("the client")).toBe(`the ${ANONYMISED_LABEL}`);
  });
  it("replaces a name only where it stands as a whole word", () => {
    expect(redactor(["Ram"])("Ramp-up for Ram, and Ram's plan")).toBe(
      `Ramp-up for ${ANONYMISED_LABEL}, and ${ANONYMISED_LABEL}'s plan`,
    );
    expect(redactor(["Data"])("Data migration for DataCo")).toBe(`${ANONYMISED_LABEL} migration for DataCo`);
    expect(redactor(["Asha"])("Ashaworks, Asha_1, Asha2 and Asha.")).toBe(
      `Ashaworks, Asha_1, Asha2 and ${ANONYMISED_LABEL}.`,
    );
    expect(redactor(["Élodie"])("Élodie and Élodies")).toBe(`${ANONYMISED_LABEL} and Élodies`);
  });
});

describe("viewRecipient: an email alone is not a contact (finding 3)", () => {
  it("adds no contact line to the view of a snapshot that names no contact, and still takes the email out", () => {
    const emailOnly = {
      legalName: "Solo Ltd",
      email: "solo@example.test",
      country: "IN",
      clientType: "business" as const,
      gstStatus: "unregistered" as const,
    };
    // contact gone alone needs a contactId (`snapshotContactGone`), so with no contact only the client-gone cases are reachable
    for (const [clientGone, contactGone] of [
      [true, false],
      [true, true],
    ] as const) {
      const v = viewRecipient(emailOnly, clientGone, contactGone);
      expect(v).not.toHaveProperty("contactName");
      expect(v.email).toBeNull();
    }
  });
});
