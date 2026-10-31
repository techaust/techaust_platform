// The deed of assignment's pure rules (T11; run file docs/runs/t11-deed.md, L2, L4, L5, L6): the status flow, full payment (property tests: partial payment,
// a credit note after payment, TDS, an advance counted once, USD, a voided invoice, a proforma ignored, care plan, anonymised), the values and 07-ZE's text
// filled word for word (docs/07-content-appendix/ZE-terms-offers-deed.md). Names and amounts are invented test data. [RB-38(a), RB-21, ADM-PRJ-04, POR-05]
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fromIst } from "../src/dates.ts";
import {
  blankSchedules,
  canMoveDeed,
  DEED_LAYOUT_ID,
  DEED_SCHEDULE_FIELDS,
  DEED_STAMP_NOTE,
  DEED_STATUSES,
  type DeedDocFact,
  type DeedFacts,
  type DeedInputs,
  type DeedSnapshot,
  deedAddressLine,
  deedBlockersOf,
  deedEligibility,
  deedFactsOf,
  deedOneLine,
  deedSignatureLine,
  deedSignedKey,
  deedSnapshotJson,
  deedSnapshotOf,
  deedSnapshotSha256,
  deedText,
  deedUnsignedKey,
  eligibilityOfSums,
  esignMomentIst,
  isLivePayable,
  parseDeedSnapshot,
  parseEsignMoment,
  settledOf,
} from "../src/deeds.ts";

const doc = (o: Partial<DeedDocFact> = {}): DeedDocFact => {
  const total = o.totalMinor ?? 100_000;
  const paid = o.paidMinor ?? 0;
  const credited = o.creditedMinor ?? 0;
  const tds = o.tdsMinor ?? 0;
  return {
    type: "tax_invoice",
    frozen: true,
    status: "issued",
    currency: "INR",
    totalMinor: total,
    paidMinor: paid,
    creditedMinor: credited,
    tdsMinor: tds,
    balanceMinor: o.balanceMinor ?? Math.max(0, total - paid - credited - tds),
    carePlan: false,
    ...o,
  };
};

const facts = (documents: DeedDocFact[], o: Partial<DeedFacts> = {}): DeedFacts => ({
  projectStatus: "completed",
  source: {
    type: "proposal",
    status: "accepted",
    frozen: true,
    sameClient: true,
    currency: "INR",
    totalMinor: 100_000,
  },
  clientAnonymised: false,
  carePlanFromSource: false,
  documents,
  ...o,
});

describe("the status flow (L4)", () => {
  it("draft to final or cancelled, final to signed, nothing else", () => {
    const allowed = DEED_STATUSES.flatMap((a) =>
      DEED_STATUSES.filter((b) => canMoveDeed(a, b)).map((b) => `${a}>${b}`),
    );
    expect(allowed).toEqual(["draft>final", "draft>cancelled", "final>signed"]);
  });

  it("names the blank Schedule fields; 'None' typed counts as filled in", () => {
    const s = {
      deliverables: "Site",
      location: " ",
      deliveredDates: null,
      tools: "None",
      thirdParty: "None",
    };
    expect(blankSchedules(s)).toEqual(["location", "deliveredDates"]);
    expect(DEED_SCHEDULE_FIELDS).toHaveLength(5);
  });
});

describe("L2: full payment [RB-38(a)]", () => {
  it("a paid invoice of the accepted total is eligible", () => {
    expect(deedEligibility(facts([doc({ paidMinor: 100_000 })]))).toEqual({
      eligible: true,
      blockers: [],
      settledMinor: 100_000,
      acceptedTotalMinor: 100_000,
      creditedMinor: 0,
      targetMinor: 100_000,
      shortfallMinor: 0,
      currency: "INR",
    });
  });

  it("every blocker, in order", () => {
    const r = deedEligibility(
      facts([doc({ paidMinor: 10, carePlan: true })], {
        projectStatus: "active",
        source: {
          type: "proposal",
          status: "sent",
          frozen: true,
          sameClient: true,
          currency: "INR",
          totalMinor: 100_000,
        },
        clientAnonymised: true,
      }),
    );
    expect(r.blockers).toEqual([
      "not_completed",
      "no_accepted_source",
      "client_anonymised",
      "care_plan",
      "balance_due",
      "short_paid",
    ]);
    expect(deedEligibility(facts([])).blockers).toEqual(["no_invoices", "short_paid", "nothing_paid"]);
    expect(deedEligibility(facts([], { source: null })).blockers).toEqual([
      "no_accepted_source",
      "no_invoices",
      "nothing_paid",
    ]);
    expect(
      deedEligibility(facts([doc({ paidMinor: 100_000 })], { carePlanFromSource: true })).blockers,
    ).toEqual(["care_plan"]);
    for (const bad of [{ sameClient: false }, { frozen: false }, { type: "proforma" }] as const) {
      const source = {
        type: "proposal",
        status: "accepted",
        frozen: true,
        sameClient: true,
        currency: "INR",
        totalMinor: 100_000,
        ...bad,
      };
      expect(deedEligibility(facts([doc({ paidMinor: 100_000 })], { source })).blockers).toEqual([
        "no_accepted_source",
      ]);
    }
    expect(
      deedEligibility(
        facts([doc({ paidMinor: 100_000 })], {
          source: {
            type: "estimate",
            status: "accepted",
            frozen: true,
            sameClient: true,
            currency: "INR",
            totalMinor: 100_000,
          },
        }),
      ).eligible,
    ).toBe(true);
  });

  it("partial payment is short and due; TDS settles like money", () => {
    expect(deedEligibility(facts([doc({ paidMinor: 60_000 })]))).toMatchObject({
      blockers: ["balance_due", "short_paid"],
      targetMinor: 100_000,
      shortfallMinor: 40_000,
    });
    expect(deedEligibility(facts([doc({ paidMinor: 90_000, tdsMinor: 10_000 })])).eligible).toBe(true);
  });

  it("a credit note lowers the target (owner, 2026-11-01): a discount still gets a deed; the deed's amount is what was paid", () => {
    // A 20 % discount by credit note, the rest paid.
    expect(deedEligibility(facts([doc({ paidMinor: 80_000, creditedMinor: 20_000 })]))).toEqual({
      eligible: true,
      blockers: [],
      settledMinor: 80_000,
      acceptedTotalMinor: 100_000,
      creditedMinor: 20_000,
      targetMinor: 80_000,
      shortfallMinor: 0,
      currency: "INR",
    });
    // A credit note after full payment (an overpayment left as credit): still eligible, the money settles only what is owed.
    expect(deedEligibility(facts([doc({ paidMinor: 100_000, creditedMinor: 10_000 })]))).toMatchObject({
      eligible: true,
      settledMinor: 90_000,
      targetMinor: 90_000,
    });
    // Short of the lowered target.
    expect(
      deedEligibility(facts([doc({ paidMinor: 70_000, creditedMinor: 20_000, balanceMinor: 10_000 })])),
    ).toMatchObject({ blockers: ["balance_due", "short_paid"], shortfallMinor: 10_000 });
    // A credit note larger than the accepted total never makes a negative target.
    expect(
      eligibilityOfSums({
        projectStatus: "completed",
        sourceOk: true,
        acceptedCurrency: "INR",
        acceptedTotalMinor: 100,
        clientAnonymised: false,
        carePlan: false,
        payables: 1,
        unpaid: 0,
        settledMinor: 5,
        creditedMinor: 500,
      }),
    ).toMatchObject({ eligible: true, targetMinor: 0, shortfallMinor: 0 });
  });

  it("a project credited in full gets no deed (lead decision (a)): nothing was paid", () => {
    expect(deedEligibility(facts([doc({ creditedMinor: 100_000 })]))).toMatchObject({
      eligible: false,
      blockers: ["nothing_paid"],
      settledMinor: 0,
      targetMinor: 0,
    });
  });

  it("a proforma and a voided or draft invoice are never counted; a debit note is a payable", () => {
    const proforma = doc({ type: "proforma", paidMinor: 100_000 });
    expect(isLivePayable(proforma)).toBe(false);
    expect(deedEligibility(facts([proforma])).blockers).toEqual([
      "no_invoices",
      "short_paid",
      "nothing_paid",
    ]);
    const voided = doc({ status: "void", totalMinor: 50_000 });
    const draft = doc({ frozen: false, status: "draft" });
    expect(deedEligibility(facts([doc({ paidMinor: 100_000 }), voided, draft])).eligible).toBe(true);
    const debit = doc({ type: "debit_note", totalMinor: 5_000 });
    expect(deedEligibility(facts([doc({ paidMinor: 100_000 }), debit])).blockers).toEqual(["balance_due"]);
    const credit = doc({ type: "credit_note", totalMinor: 5_000 });
    expect(isLivePayable(credit)).toBe(false);
  });

  it("an advance counted once: two advance invoices against a proforma, each settled by its own money, and the proforma ignored", () => {
    const proforma = doc({ type: "proforma", totalMinor: 100_000, paidMinor: 100_000 });
    const a1 = doc({ totalMinor: 40_000, paidMinor: 40_000 });
    const a2 = doc({ totalMinor: 60_000, paidMinor: 60_000 });
    const r = deedEligibility(facts([proforma, a1, a2]));
    expect(r).toMatchObject({ eligible: true, settledMinor: 100_000 });
  });

  it("USD: only documents in the accepted currency count", () => {
    const usdSource = {
      type: "proposal",
      status: "accepted",
      frozen: true,
      sameClient: true,
      currency: "USD",
      totalMinor: 2_000_00,
    };
    expect(
      deedEligibility(
        facts([doc({ currency: "USD", type: "export_invoice", totalMinor: 2_000_00, paidMinor: 2_000_00 })], {
          source: usdSource,
        }),
      ).eligible,
    ).toBe(true);
    expect(
      deedEligibility(
        facts([doc({ currency: "INR", totalMinor: 2_000_00, paidMinor: 2_000_00 })], { source: usdSource }),
      ).blockers,
    ).toEqual(["short_paid", "nothing_paid"]);
    // A credit note in another currency never lowers the target.
    expect(
      deedEligibility(
        facts(
          [
            doc({
              currency: "USD",
              type: "export_invoice",
              totalMinor: 2_000_00,
              paidMinor: 1_000_00,
              creditedMinor: 0,
              balanceMinor: 0,
            }),
            doc({ currency: "INR", totalMinor: 2_000_00, paidMinor: 1_000_00, creditedMinor: 1_000_00 }),
          ],
          { source: usdSource },
        ),
      ),
    ).toMatchObject({ creditedMinor: 0, targetMinor: 2_000_00, blockers: ["short_paid"] });
  });

  it("property: eligible exactly when completed, live, not care, at least one live payable, none due, something settled and settled plus credited reaches the total", () => {
    const arbDoc = fc
      .record({
        type: fc.constantFrom("tax_invoice", "export_invoice", "debit_note", "proforma", "credit_note"),
        frozen: fc.boolean(),
        voided: fc.boolean(),
        currency: fc.constantFrom("INR", "USD"),
        total: fc.integer({ min: 1, max: 200_000 }),
        paidPct: fc.integer({ min: 0, max: 120 }),
        creditPct: fc.integer({ min: 0, max: 100 }),
        tdsPct: fc.integer({ min: 0, max: 20 }),
        carePlan: fc.boolean(),
      })
      .map((r) => {
        const paid = Math.floor((r.total * r.paidPct) / 100);
        const credited = Math.floor((r.total * r.creditPct) / 100);
        const tds = Math.floor((r.total * r.tdsPct) / 100);
        return doc({
          type: r.type,
          frozen: r.frozen,
          status: r.voided ? "void" : r.frozen ? "issued" : "draft",
          currency: r.currency,
          totalMinor: r.total,
          paidMinor: paid,
          creditedMinor: credited,
          tdsMinor: tds,
          carePlan: r.carePlan && r.type !== "proforma",
        });
      });
    fc.assert(
      fc.property(
        fc.array(arbDoc, { maxLength: 6 }),
        fc.integer({ min: 1, max: 300_000 }),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom("completed", "active"),
        (docs, total, anonymised, careSource, status) => {
          const f = facts(docs, {
            projectStatus: status,
            clientAnonymised: anonymised,
            carePlanFromSource: careSource,
            source: {
              type: "proposal",
              status: "accepted",
              frozen: true,
              sameClient: true,
              currency: "INR",
              totalMinor: total,
            },
          });
          const live = docs.filter(
            (d) =>
              d.frozen &&
              d.status !== "void" &&
              ["tax_invoice", "export_invoice", "debit_note"].includes(d.type),
          );
          const settled = live
            .filter((d) => d.currency === "INR")
            .reduce(
              (a, d) => a + Math.max(0, Math.min(d.paidMinor + d.tdsMinor, d.totalMinor - d.creditedMinor)),
              0,
            );
          const credited = live.filter((d) => d.currency === "INR").reduce((a, d) => a + d.creditedMinor, 0);
          const expected =
            status === "completed" &&
            !anonymised &&
            !careSource &&
            !docs.some((d) => d.carePlan) &&
            live.length > 0 &&
            live.every((d) => d.balanceMinor === 0) &&
            settled > 0 &&
            settled + credited >= total;
          const r = deedEligibility(f);
          expect(r.eligible).toBe(expected);
          expect(r.settledMinor).toBe(settled);
          expect(r.creditedMinor).toBe(credited);
          expect(r.targetMinor).toBe(Math.max(0, total - credited));
          // The sums path decides the same way (the admin's read of `deedFactsSql`).
          expect(eligibilityOfSums(deedFactsOf(f)).eligible).toBe(expected);
        },
      ),
    );
  });

  it("settledOf never goes below zero or above what is owed, and refuses a float", () => {
    expect(settledOf({ totalMinor: 100, paidMinor: 150, creditedMinor: 0, tdsMinor: 0 })).toBe(100);
    expect(settledOf({ totalMinor: 100, paidMinor: 50, creditedMinor: 100, tdsMinor: 0 })).toBe(0);
    expect(() => settledOf({ totalMinor: 1.5, paidMinor: 0, creditedMinor: 0, tdsMinor: 0 })).toThrow(
      RangeError,
    );
    expect(
      deedBlockersOf({
        projectStatus: "completed",
        sourceOk: true,
        acceptedCurrency: "INR",
        acceptedTotalMinor: 10,
        clientAnonymised: false,
        carePlan: false,
        payables: 1,
        unpaid: 0,
        settledMinor: 10,
        creditedMinor: 0,
      }),
    ).toEqual([]);
  });
});

const inputs = (o: Partial<DeedInputs> = {}): DeedInputs => ({
  madeOn: "2026-11-01",
  company: { principalPlace: "12 Example Road,\n Balurghat, West Bengal 733101", gstin: "19ABCDE1234F1Z5" },
  client: {
    legalName: "Example Traders Private Limited",
    address: {
      line1: "4 Sample Street",
      city: "Kolkata",
      state: "West Bengal",
      postalCode: "700001",
      country: "IN",
    },
    gstin: "19AAAAA0000A1Z5",
  },
  countryName: (c) => (c === "IN" ? "India" : c),
  offer: {
    type: "proposal",
    numberDisplay: "TH/PRP/2627/0007",
    version: 2,
    decidedAt: fromIst({ year: 2026, month: 10, day: 5 }, 23, 30),
    currency: "INR",
  },
  documents: [
    { ...doc({ totalMinor: 60_000, paidMinor: 60_000 }), numberDisplay: "TH/INV/2627/0010" },
    { ...doc({ totalMinor: 40_000, paidMinor: 40_000 }), numberDisplay: "TH/INV/2627/0009" },
    {
      ...doc({ type: "proforma", totalMinor: 100_000, paidMinor: 100_000 }),
      numberDisplay: "TH/PI/2627/0001",
    },
  ],
  schedules: {
    deliverables: "Website source code, design files",
    location: "Git repository handed over",
    deliveredDates: "28 Oct 2026",
    tools: "None",
    thirdParty: "Astro (MIT licence)",
  },
  ...o,
});

describe("L6: the values", () => {
  it("assembles every value; the proforma is left out and the invoices are in issue order; the acceptance day is the IST day", () => {
    const r = deedSnapshotOf(inputs());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot).toEqual({
      layout: DEED_LAYOUT_ID,
      madeOn: "2026-11-01",
      supplier: { address: "12 Example Road, Balurghat, West Bengal 733101", gstin: "19ABCDE1234F1Z5" },
      client: {
        legalName: "Example Traders Private Limited",
        address: "4 Sample Street, Kolkata, West Bengal, 700001, India",
        reg: "19AAAAA0000A1Z5",
      },
      offer: { docType: "proposal", number: "TH/PRP/2627/0007", version: 2, acceptedOn: "2026-10-05" },
      payment: {
        invoiceNumbers: ["TH/INV/2627/0009", "TH/INV/2627/0010"],
        amountPaidMinor: 100_000,
        currency: "INR",
      },
      schedule1: {
        deliverables: "Website source code, design files",
        location: "Git repository handed over",
        deliveredDates: "28 Oct 2026",
      },
      schedule2: { tools: "None", thirdParty: "Astro (MIT licence)" },
    });
  });

  it("refuses, never guesses: no company address or GSTIN, an unreadable offer, a blank Schedule, a bad date", () => {
    const r = deedSnapshotOf(
      inputs({
        company: { principalPlace: " \n ", gstin: " " },
        offer: { type: "proforma", numberDisplay: null, version: 1, decidedAt: null, currency: "INR" },
        schedules: { deliverables: "x", location: "", deliveredDates: "x", tools: "x", thirdParty: null },
        madeOn: "2026-13-01",
      }),
    );
    expect(r).toEqual({
      ok: false,
      problems: [
        "company_principal_place_missing",
        "company_gstin_missing",
        "offer_unreadable",
        "schedules_blank",
        "made_on_invalid",
      ],
      blankFields: ["location", "thirdParty"],
    });
  });

  it("the principal place prints on one line (triage 4)", () => {
    expect(deedOneLine("1 Sample Road,\r\n\r\n  Balurghat,  West Bengal\n733101 ")).toBe(
      "1 Sample Road, Balurghat, West Bengal, 733101",
    );
    expect(deedOneLine(" \n ")).toBeNull();
    expect(deedOneLine(null)).toBeNull();
  });

  it("an address with no country name function keeps the code; none is null", () => {
    expect(deedAddressLine({ line1: "1 Main St", city: "Austin", country: "US" })).toBe(
      "1 Main St, Austin, US",
    );
    expect(deedAddressLine(null)).toBeNull();
  });

  it("the canonical JSON is key-sorted and its hash stable; a stored snapshot reads back, a damaged one is refused", async () => {
    const r = deedSnapshotOf(inputs());
    if (!r.ok) throw new Error("no snapshot");
    const json = deedSnapshotJson(r.snapshot);
    expect(json.startsWith('{"client":')).toBe(true);
    expect(await deedSnapshotSha256(r.snapshot)).toMatch(/^[0-9a-f]{64}$/);
    expect(parseDeedSnapshot(json)).toEqual(r.snapshot);
    expect(parseDeedSnapshot(null)).toBeNull();
    expect(parseDeedSnapshot("not json")).toBeNull();
    expect(parseDeedSnapshot(JSON.stringify({ ...r.snapshot, layout: "deed-v0" }))).toBeNull();
    for (const k of ["supplier", "client", "offer", "payment", "schedule1", "schedule2"] as const)
      expect(parseDeedSnapshot(JSON.stringify({ ...r.snapshot, [k]: { broken: true } })), k).toBeNull();
    expect(parseDeedSnapshot(JSON.stringify({ ...r.snapshot, madeOn: "x" }))).toBeNull();
  });
});

describe("07-ZE's text, word for word", () => {
  const snap = (): DeedSnapshot => {
    const r = deedSnapshotOf(inputs());
    if (!r.ok) throw new Error("no snapshot");
    return r.snapshot;
  };
  const plain = (runs: readonly { text: string }[]) => runs.map((r) => r.text).join("");

  it("title, parties and every clause", () => {
    const t = deedText(snap(), "TH/DA/2627/0001");
    expect(t.title).toBe("Deed of assignment of copyright · No. TH/DA/2627/0001");
    expect(plain(t.parties)).toBe(
      "This deed is made on 01 Nov 2026 at Balurghat, West Bengal, India, by Rupak Sarkar, sole proprietor, trading as TecHaust Technologies, 12 Example Road, Balurghat, West Bengal 733101, GSTIN 19ABCDE1234F1Z5 (the assignor), in favour of Example Traders Private Limited, 4 Sample Street, Kolkata, West Bengal, 700001, India, GSTIN/registration 19AAAAA0000A1Z5 (the assignee).",
    );
    expect(t.parties.filter((r) => r.bold).map((r) => r.text)).toEqual([
      "Rupak Sarkar",
      "assignor",
      "Example Traders Private Limited",
      "assignee",
    ]);
    expect(t.clauses.map((c) => `${c.n}. ${c.heading} ${c.body}`)).toEqual([
      "1. The work. The software, designs and documentation the assignor made for the assignee under proposal TH/PRP/2627/0007 v2, accepted on 05 Oct 2026, and listed in Schedule 1.",
      "2. Price. The assignee has paid in full the fees under that proposal (TH/INV/2627/0009, TH/INV/2627/0010, total ₹1,000.00). The assignor acknowledges receipt. No royalty or other sum is payable for this assignment.",
      "3. What is assigned. The assignor assigns to the assignee, wholly, all copyright in the work: every right under section 14 of the Copyright Act, 1957, in every medium and mode of exploitation, including those not yet existing or in commercial use.",
      "4. Territory and duration. Worldwide, for the full term of copyright. Section 19(4) does not apply: the assignment does not lapse if the assignee does not use the rights.",
      "5. Not assigned. The assignor's pre-existing tools and the third-party or open-source parts listed in Schedule 2. The assignor grants the assignee a non-exclusive, perpetual, worldwide, royalty-free licence to use, copy and change those pre-existing tools as part of the work. Open-source parts stay under their own licences. The assignor keeps general know-how.",
      "6. Author's rights. Under section 57 the author keeps the right to be named as the author. The author agrees not to use section 57 to object to changes, adaptations or uses of the work that the assignee makes for its own purposes.",
      "7. Ownership. The assignor confirms that it owns the copyright assigned here. This deed gives no other warranty and asks nothing further of the assignee; the warranty in the proposal is unchanged.",
      "8. Law. Indian law governs this deed; disputes follow item 10 of the terms of the proposal.",
    ]);
    expect(t.footer).toBe(
      "Stamp duty: Not stamped at signing. Any stamp duty due will be paid before this deed is produced as evidence.",
    );
    expect(DEED_STAMP_NOTE.startsWith("Not stamped")).toBe(true);
    expect(t.schedule1).toEqual({
      heading: "Schedule 1, the work",
      deliverables: "Website source code, design files",
      location: "Git repository handed over",
      deliveredDates: "28 Oct 2026",
    });
    expect(t.schedule2.heading).toBe("Schedule 2, not assigned");
  });

  it("an overseas client with no GSTIN or address drops those parts; USD prints en-US; an estimate says estimate", () => {
    const r = deedSnapshotOf(
      inputs({
        client: { legalName: "Sample Corp", address: null, gstin: null },
        offer: {
          type: "estimate",
          numberDisplay: "TH/EST/2627/0003",
          version: 1,
          decidedAt: fromIst({ year: 2026, month: 9, day: 1 }),
          currency: "USD",
        },
        documents: [
          {
            ...doc({ type: "export_invoice", currency: "USD", totalMinor: 250_000, paidMinor: 250_000 }),
            numberDisplay: "TH/EXP/2627/0001",
          },
        ],
      }),
    );
    if (!r.ok) throw new Error("no snapshot");
    const t = deedText(r.snapshot, "TH/DA/2627/0002");
    expect(plain(t.parties)).toContain("in favour of Sample Corp (the assignee).");
    expect(t.clauses[1]?.body).toContain("under that estimate (TH/EXP/2627/0001, total $2,500.00)");
    expect(t.clauses[0]?.body).toContain("under estimate TH/EST/2627/0003 v1, accepted on 01 Sep 2026");
  });

  it("L5: the unsigned PDF's signature sentence stops at the name; screens add the eSign moment and transaction", () => {
    const t = deedText(snap(), "TH/DA/2627/0001");
    expect(t.signatureLead).toBe(
      "Signed by the assignor with an Aadhaar-based electronic signature (eSign): Rupak Sarkar, sole proprietor, TecHaust Technologies",
    );
    const at = fromIst({ year: 2026, month: 11, day: 3 }, 14, 5);
    expect(esignMomentIst(at)).toBe("03 Nov 2026, 14:05 IST");
    expect(deedSignatureLine(t.signatureLead, at, "ESIGN-42")).toBe(
      "Signed by the assignor with an Aadhaar-based electronic signature (eSign): Rupak Sarkar, sole proprietor, TecHaust Technologies · 03 Nov 2026, 14:05 IST · ESIGN-42.",
    );
  });

  it("the deed never says a lawyer reviewed it (07-ZE line 20)", () => {
    const t = deedText(snap(), "TH/DA/2627/0001");
    expect(JSON.stringify(t)).not.toMatch(/lawyer|advocate|legal review|reviewed by/i);
  });
});

describe("the eSign moment and the R2 keys", () => {
  const now = fromIst({ year: 2026, month: 11, day: 5 }, 12, 0);
  const finalised = fromIst({ year: 2026, month: 11, day: 1 }, 10, 0);
  it("reads the IST moment the Owner types; refuses the future, before the finalise, and nonsense", () => {
    expect(parseEsignMoment("2026-11-03T14:05", { nowUtcMs: now, notBeforeUtcMs: finalised })).toBe(
      fromIst({ year: 2026, month: 11, day: 3 }, 14, 5),
    );
    expect(parseEsignMoment("2026-11-03T14:05:30", { nowUtcMs: now, notBeforeUtcMs: finalised })).toBe(
      fromIst({ year: 2026, month: 11, day: 3 }, 14, 5, 30),
    );
    expect(parseEsignMoment("2026-11-06T09:00", { nowUtcMs: now, notBeforeUtcMs: finalised })).toBeNull();
    expect(parseEsignMoment("2026-10-30T09:00", { nowUtcMs: now, notBeforeUtcMs: finalised })).toBeNull();
    expect(parseEsignMoment("2026-11-01T09:58", { nowUtcMs: now, notBeforeUtcMs: finalised })).toBeNull();
    expect(parseEsignMoment("2026-11-01T09:59:30", { nowUtcMs: now, notBeforeUtcMs: finalised })).toBe(
      finalised - 30_000,
    );
    for (const bad of [
      "2026-11-03 14:05",
      "2026-02-30T10:00",
      "2026-11-03T24:00",
      "2026-11-03T10:60",
      "2026-11-03T10:00:61",
      "",
    ])
      expect(parseEsignMoment(bad, { nowUtcMs: now, notBeforeUtcMs: finalised }), bad).toBeNull();
  });

  it("the keys", () => {
    expect(deedUnsignedKey("deed_1", "cd")).toBe("deeds/deed_1/unsigned-cd.pdf");
    expect(deedSignedKey("deed_1", "ab")).toBe("deeds/deed_1/signed-ab.pdf");
  });
});
