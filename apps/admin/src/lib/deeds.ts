// The project's Deed tab (T11; run file docs/runs/t11-deed.md, L2 to L8; ADM-PRJ-04; 08-C RB-38(a), RB-21): the shape the API answers
// (GET /api/v1/projects/:id/deed, apps/admin/worker/deeds.ts `deedView`), the words of 07-ZJ sections D and E (staff-only, marked until the lead approves
// them) and the pure rules the screen follows: which stage the deed is at, what the Schedules form checks, the delivered dates as a list of DateFields and
// back, and the eSign moment as the API wants it. Every figure is the server's, formatted by core money; nothing is added up here. No I/O.
import { type CalendarDate, formatDate, isValidDate, parseIsoDate, toIsoDate } from "@techaust/core";
import type { DeedScheduleField } from "@techaust/core/deeds";
import { DEED_SCHEDULE_LIMITS } from "@techaust/core/deeds";
import { type Currency, formatMoney, isCurrency, money } from "@techaust/core/money";
import { ZJ } from "./copy-zj.ts";

// ---- the API's answer ----------------------------------------------------------------------------------------------------------------------------------------

export type DeedStatus = "draft" | "final" | "signed" | "cancelled";
export type DeedBlocker =
  | "not_completed"
  | "no_accepted_source"
  | "client_anonymised"
  | "care_plan"
  | "no_invoices"
  | "balance_due"
  | "short_paid"
  | "nothing_paid";
export type DeedProblem =
  | "company_principal_place_missing"
  | "company_gstin_missing"
  | "offer_unreadable"
  | "schedules_blank"
  | "made_on_invalid";
export type DeedSchedules = Record<DeedScheduleField, string | null>;

/** Core `DeedText` as JSON (07-ZE filled; the server's words). */
export type DeedTextView = {
  title: string;
  parties: { text: string; bold?: true }[];
  clauses: { n: number; heading: string; body: string }[];
  signatureLead: string;
  schedule1: { heading: string; deliverables: string; location: string; deliveredDates: string };
  schedule2: { heading: string; tools: string; thirdParty: string };
  footer: string;
};

export type DeedDocument = {
  id: string;
  number: string | null;
  type: string;
  currency: string;
  counted: boolean;
  totalMinor: number;
  paidMinor: number;
  tdsMinor: number;
  creditedMinor: number;
  balanceMinor: number;
  settledMinor: number;
};

export type DeedRecord = {
  id: string;
  status: DeedStatus;
  number: string | null;
  fy: string | null;
  madeOn: string | null;
  schedules: DeedSchedules;
  blankSchedules: DeedScheduleField[];
  preview: { ok: true } | { ok: false; problems: DeedProblem[]; blankFields: DeedScheduleField[] } | null;
  text: DeedTextView | null;
  sealed: { ok: boolean; sha256: string | null } | null;
  notFullyPaid: boolean;
  unsignedPdf: boolean;
  signed: {
    size: number | null;
    sha256: string | null;
    esignAt: number;
    esignMoment: string;
    esignTxn: string;
    signatureLine: string | null;
    signedAt: number | null;
    signedByName: string | null;
  } | null;
  finalisedAt: number | null;
  finalisedByName: string | null;
  cancelled: { at: number | null; byName: string | null; reason: string | null } | null;
  createdAt: number;
  updatedAt: number;
};

export type DeedPage = {
  project: { id: string; code: string; status: string; sourceDocumentId: string | null };
  clientAnonymised: boolean;
  eligibility: {
    eligible: boolean;
    blockers: DeedBlocker[];
    settledMinor: number;
    acceptedTotalMinor: number | null;
    creditedMinor: number;
    targetMinor: number | null;
    shortfallMinor: number | null;
    currency: string | null;
  };
  documents: DeedDocument[];
  deed: DeedRecord | null;
  history: {
    id: string;
    createdAt: number;
    cancelledAt: number | null;
    cancelledByName: string | null;
    reason: string | null;
  }[];
  can: {
    editSchedules: boolean;
    finalise: boolean;
    uploadSigned: boolean;
    cancel: boolean;
    recheck: boolean;
    renderPdf: boolean;
  };
};

// ---- the words (07-ZJ D and E) -------------------------------------------------------------------------------------------------------------------------------

export type OfferKind = "proposal" | "estimate";

export const DEED_COPY = {
  tab: ZJ("Deed"),
  heading: ZJ("Deed of assignment"),
  loading: ZJ("Loading the deed"),
  states: {
    draft: ZJ("Draft"),
    final: ZJ("Final"),
    signed: ZJ("Signed"),
    cancelled: ZJ("Cancelled"),
    none: ZJ("No deed yet"),
  },
  lede: {
    waiting: ZJ("A draft deed is prepared when the project is completed and paid in full."),
    qualifies: ZJ("This project qualifies. Check again to prepare the draft deed."),
    draft: ZJ("Fill in both Schedules, read the deed, then finalise it."),
    final: ZJ("Sign the PDF on your eSign provider's website, then upload the signed copy here."),
    signed: (kind: OfferKind | null) =>
      ZJ(`Signed. The client can download it from the ${kind ?? "proposal"}'s page in the portal.`),
    cancelled: ZJ(
      "The draft was cancelled. Check again to prepare a new one if the project still qualifies.",
    ),
  },
  paid: {
    heading: ZJ("Paid in full"),
    accepted: (kind: OfferKind | null) => ZJ(`Accepted ${kind ?? "proposal"} total`),
    credited: ZJ("Credit notes"),
    owed: ZJ("Owed"),
    settled: ZJ("Paid, including TDS"),
    short: ZJ("Still to pay"),
    yes: ZJ("Paid in full"),
    no: ZJ("Not paid in full yet"),
  },
  blockers: {
    not_completed: ZJ("The project isn't marked Completed."),
    no_accepted_source: ZJ("The project wasn't started from an accepted proposal or estimate."),
    client_anonymised: ZJ("This client's details were erased."),
    care_plan: ZJ("Care-plan work doesn't get a deed."),
    no_invoices: ZJ("No issued invoice is linked to this project yet."),
    balance_due: ZJ("An invoice still has a balance to pay."),
    short_paid: ZJ("The payments haven't reached the amount owed yet."),
    nothing_paid: ZJ("Nothing has been paid on this project's invoices."),
  } satisfies Record<DeedBlocker, string>,
  docs: {
    heading: ZJ("Invoices counted"),
    invoice: ZJ("Invoice"),
    total: ZJ("Total"),
    paid: ZJ("Paid"),
    credited: ZJ("Credit notes"),
    balance: ZJ("Balance"),
    notCounted: (currency: string) => ZJ(`Not counted: in ${currency}`),
    note: ZJ("Only invoices issued against this project's milestones are counted."),
  },
  schedules: {
    s1: "Schedule 1, the work",
    s2: "Schedule 2, not assigned",
    deliverables: ZJ("Deliverables"),
    deliverablesHint: ZJ("One per line, as the client will read them."),
    location: ZJ("Where it was delivered"),
    locationHint: ZJ("For example a repository, a server or a handover."),
    dates: ZJ("Delivered on"),
    datesHint: ZJ("Add a date for each delivery."),
    addDate: ZJ("Add another date"),
    removeDate: (date: string) => ZJ(`Remove ${date}`),
    tools: ZJ("Pre-existing tools"),
    toolsHint: ZJ("Your own tools, libraries or templates used in the work."),
    thirdParty: ZJ("Third-party and open-source parts"),
    thirdPartyHint: ZJ("Each with its licence, for example Astro (MIT licence)."),
    none: ZJ("None"),
    noneHint: ZJ("If there are none, choose None: a blank field can't be finalised."),
    save: ZJ("Save Schedules"),
    saved: ZJ("Schedules saved."),
    blankS1: ZJ("Fill in this field."),
    blankS2: ZJ("Fill in this field, or choose None."),
    tooLong: (max: number) => ZJ(`Use at most ${max.toLocaleString("en-IN")} characters.`),
    allNeeded: "All fields are needed unless marked optional",
  },
  read: {
    heading: ZJ("Read the deed"),
    draftNote: ZJ("This is how the deed reads today. Its values are fixed when you finalise it."),
    cannot: ZJ("The deed can be read once these are fixed:"),
  },
  problems: {
    company_principal_place_missing: ZJ("Add the principal place of business in Settings › Company."),
    company_gstin_missing: ZJ("Add the GSTIN in Settings › Company."),
    offer_unreadable: ZJ("The accepted proposal or estimate can't be read. A developer needs to look at it."),
    schedules_blank: ZJ("Fill in every Schedule field."),
    made_on_invalid: ZJ("Today's date couldn't be read. Reload the page and try again."),
  } satisfies Record<DeedProblem, string>,
  finalise: {
    button: ZJ("Finalise deed"),
    title: ZJ("Finalise the deed"),
    body: ZJ(
      "This gives the deed its number, fixes its text and makes the PDF. A final deed can't be changed or cancelled.",
    ),
    done: (number: string) => ZJ(`Deed ${number} finalised. The PDF is being made.`),
  },
  pdf: {
    heading: ZJ("Unsigned PDF"),
    download: ZJ("Download unsigned PDF"),
    making: "Making the PDF…",
    again: ZJ("Make the PDF again"),
    retried: "We'll make the PDF again.",
    done: ZJ("This deed already has its PDF."),
  },
  upload: {
    heading: ZJ("Upload the signed copy"),
    file: ZJ("Signed PDF"),
    fileHint: ZJ("The PDF your eSign provider gave you, up to 10 MB."),
    date: ZJ("eSign date"),
    time: ZJ("eSign time (IST)"),
    timeHint: ZJ("24-hour, as the provider shows it, for example 14:05."),
    txn: ZJ("Transaction ID"),
    txnHint: ZJ("As the provider shows it."),
    button: ZJ("Upload signed deed"),
    noFile: ZJ("Choose the signed PDF."),
    badTime: ZJ("Enter the time as HH:MM, for example 14:05."),
    noTxn: ZJ("Enter the transaction ID."),
    noDate: ZJ("Enter the eSign date."),
    done: ZJ("Signed deed uploaded. The client's portal contacts are being emailed."),
  },
  signed: {
    heading: ZJ("Signed copy"),
    download: ZJ("Download signed PDF"),
    on: (moment: string) => ZJ(`Signed with Aadhaar eSign on ${moment}`),
    txn: ZJ("Transaction ID"),
    uploadedBy: (name: string, date: string) => ZJ(`Uploaded by ${name} on ${date}`),
    finalisedBy: (name: string, date: string) => ZJ(`Finalised by ${name} on ${date}`),
    fingerprint: "Fingerprint",
  },
  cancel: {
    button: ZJ("Cancel draft"),
    title: ZJ("Cancel the draft deed"),
    body: ZJ(
      "The draft stays in this project's history with your reason. Check again can prepare a new one.",
    ),
    reason: "Reason",
    noReason: ZJ("Enter a reason for cancelling."),
    done: ZJ("Draft deed cancelled."),
  },
  recheck: {
    button: ZJ("Check again"),
    made: ZJ("Draft deed prepared."),
    none: ZJ("The project doesn't qualify for a deed yet."),
  },
  notFullyPaid: ZJ(
    "This project is no longer paid in full. The deed hasn't changed; check the project's payments.",
  ),
  history: {
    heading: ZJ("Cancelled drafts"),
    row: (date: string, name: string) => ZJ(`Cancelled on ${date} by ${name}`),
  },
  stale: ZJ("Someone changed this deed since you opened it. Reload to see the latest."),
} as const;

/** The blockers in the order the server gives them, as sentences. */
export const blockerLines = (bs: readonly DeedBlocker[]): string[] =>
  bs.map((b) => (Object.hasOwn(DEED_COPY.blockers, b) ? DEED_COPY.blockers[b] : b));

/** The value problems as sentences (a problem the screen has no words for reads as its code: never hidden). */
export const problemLines = (ps: readonly DeedProblem[]): string[] =>
  ps.map((p) => (Object.hasOwn(DEED_COPY.problems, p) ? DEED_COPY.problems[p] : p));

// ---- the stage -----------------------------------------------------------------------------------------------------------------------------------------------

/** Where the deed is: no deed (waiting or qualifying), its own status, or only cancelled drafts. */
export type DeedStage = "waiting" | "qualifies" | "draft" | "final" | "signed" | "cancelled";

export function stageOf(page: Pick<DeedPage, "deed" | "eligibility">): DeedStage {
  const d = page.deed;
  if (d === null) return page.eligibility.eligible ? "qualifies" : "waiting";
  return d.status;
}

/** The three steps of the rail (a real sequence: draft, final, signed) and how far the deed has come (-1: none yet; a cancelled draft stops at 0). */
export const RAIL: readonly Exclude<DeedStatus, "cancelled">[] = ["draft", "final", "signed"];
export const railIndex = (stage: DeedStage): number =>
  stage === "signed" ? 2 : stage === "final" ? 1 : stage === "draft" || stage === "cancelled" ? 0 : -1;

/** The kind of the accepted offer, read from the sealed or would-be text's clause 1 ("… under proposal TH/PRP/…"); null when there is no text. */
export function offerKindOf(text: DeedTextView | null): OfferKind | null {
  const body = text?.clauses.find((c) => c.n === 1)?.body ?? "";
  const m = / under (proposal|estimate) /.exec(body);
  return m ? (m[1] as OfferKind) : null;
}

// ---- money and dates as the screen writes them ----------------------------------------------------------------------------------------------------------------

/** An amount in its currency through core money (en-IN for INR, en-US for USD); "—" without a currency the screen knows. */
export const deedMoney = (minor: number | null, currency: string | null): string =>
  minor === null || currency === null || !isCurrency(currency)
    ? "—"
    : formatMoney(money(minor, currency as Currency));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * The delivered dates as the Schedule stores them ("14 Oct 2026, 28 Oct 2026", core `formatDate`, sorted, without repeats) from the DateFields' ISO values;
 * blank entries are skipped. "" when none.
 */
export function deliveredText(isos: readonly string[]): string {
  const days = [...new Set(isos.filter((v) => parseIsoDate(v) !== null))].sort();
  return days.map((v) => formatDate(parseIsoDate(v) as CalendarDate)).join(", ");
}

/**
 * The stored text back as the DateFields' ISO values. Null when any part isn't a "DD Mon YYYY" date (text typed some other way): the form then keeps the
 * text as it is and shows it, rather than guess.
 */
export function deliveredIsos(text: string | null): string[] | null {
  const t = (text ?? "").trim();
  if (t === "") return [];
  const out: string[] = [];
  for (const part of t.split(",")) {
    const m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(part.trim());
    if (!m) return null;
    const month = MONTHS.indexOf(m[2] as (typeof MONTHS)[number]) + 1;
    const d = { year: Number(m[3]), month, day: Number(m[1]) };
    if (month === 0 || !isValidDate(d)) return null;
    out.push(toIsoDate(d));
  }
  return out;
}

/** "14:05" or "14:05:30" (24-hour, as an eSign provider shows it); the seconds are optional. */
export const ESIGN_TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** The `X-Esign-At` value the API reads: "YYYY-MM-DDTHH:mm[:ss]", IST. Null when the date or the time can't be read. */
export function esignAtValue(dateIso: string, time: string): string | null {
  const t = time.trim();
  if (parseIsoDate(dateIso) === null || !ESIGN_TIME.test(t)) return null;
  return `${dateIso}T${t}`;
}

// ---- the Schedules form ------------------------------------------------------------------------------------------------------------------------------------

export type SchedulesForm = {
  deliverables: string;
  location: string;
  /** One ISO value per DateField ("" for a field left empty). */
  dates: string[];
  /** The stored text when it isn't a list of dates the fields can show (kept as it is until a date is chosen). */
  datesText: string | null;
  tools: string;
  thirdParty: string;
};

export function formOf(s: DeedSchedules): SchedulesForm {
  const isos = deliveredIsos(s.deliveredDates);
  return {
    deliverables: s.deliverables ?? "",
    location: s.location ?? "",
    dates: isos === null ? [""] : isos.length > 0 ? isos : [""],
    datesText: isos === null ? (s.deliveredDates ?? "") : null,
    tools: s.tools ?? "",
    thirdParty: s.thirdParty ?? "",
  };
}

/** The body of PUT /deeds/:id/schedules (an empty field is sent as null: it clears it). */
export function schedulesBody(f: SchedulesForm): Record<DeedScheduleField, string | null> {
  const dates = f.datesText ?? deliveredText(f.dates);
  const v = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    deliverables: v(f.deliverables),
    location: v(f.location),
    deliveredDates: v(dates),
    tools: v(f.tools),
    thirdParty: v(f.thirdParty),
  };
}

export type SchedulesErrors = Partial<Record<DeedScheduleField, string>>;

/**
 * The form's own check. Saving a part-filled draft is allowed (the Schedules are filled over time); `forFinalise` also asks for every field (L6: Schedule 2
 * may say "None", but must say it). A field longer than the database allows is refused either way.
 */
export function schedulesErrors(f: SchedulesForm, forFinalise: boolean): SchedulesErrors {
  const body = schedulesBody(f);
  const e: SchedulesErrors = {};
  for (const k of Object.keys(DEED_SCHEDULE_LIMITS) as DeedScheduleField[]) {
    const value = body[k];
    if (value !== null && value.length > DEED_SCHEDULE_LIMITS[k])
      e[k] = DEED_COPY.schedules.tooLong(DEED_SCHEDULE_LIMITS[k]);
    else if (forFinalise && value === null)
      e[k] = k === "tools" || k === "thirdParty" ? DEED_COPY.schedules.blankS2 : DEED_COPY.schedules.blankS1;
  }
  return e;
}

export const sameSchedules = (a: SchedulesForm, b: SchedulesForm): boolean =>
  JSON.stringify(schedulesBody(a)) === JSON.stringify(schedulesBody(b));
