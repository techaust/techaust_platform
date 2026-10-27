// Shared fixtures for the GST core tests (M5.5a): register-row builders and the ~18-document golden fixture. All names,
// numbers and addresses are invented test data (never client data). Amounts are INR minor units unless a name says otherwise.
import type { CalendarDate } from "../../src/dates.ts";
import type {
  GstDocKind,
  Gstr1Params,
  NoteParent,
  RecipientStatus,
  RegisterRate,
  RegisterRow,
  StateCode,
  SupplyType,
} from "../../src/gst/index.ts";

// GSTINs with valid check characters (made with gstinCheckChar on a test PAN; same as test/tax/fixtures.ts).
export const GSTIN_19 = "19ABCDE1234F1ZX";
export const GSTIN_27 = "27ABCDE1234F1Z0";
export const GSTIN_29 = "29ABCDE1234F1ZW";

export const d = (year: number, month: number, day: number): CalendarDate => ({ year, month, day });

export const PARAMS: Gstr1Params = {
  b2clThresholdInrMinor: 1_00_000_00,
  supplierStateCode: "19",
  sacDescriptions: { "998314": "IT support services", "998313": "IT design services" },
};

/** The rate lines of a document: heads follow the supply (intra: CGST + SGST; inter or export with IGST: IGST; LUT: none). */
export function rate(sac: string | null, bp: number, taxable: number, supply: SupplyType): RegisterRate {
  const intra = supply === "intra";
  const none = supply === "export_lut";
  const half = Math.trunc((taxable * bp + 10_000) / 20_000);
  const full = Math.trunc((taxable * bp + 5_000) / 10_000);
  return {
    sac,
    rateBp: none ? 0 : bp,
    taxableMinor: taxable,
    igstMinor: intra || none ? 0 : full,
    cgstMinor: intra ? half : 0,
    sgstMinor: intra ? half : 0,
  };
}

export const sumOf = (rates: readonly RegisterRate[]): number =>
  rates.reduce((s, r) => s + r.taxableMinor + r.igstMinor + r.cgstMinor + r.sgstMinor, 0);

export type RowSpec = {
  id: string;
  kind?: GstDocKind;
  number?: string;
  date?: CalendarDate;
  voided?: boolean;
  supply?: SupplyType;
  pos?: StateCode | "96";
  status?: RecipientStatus;
  gstin?: string | null;
  name?: string;
  address?: string | null;
  country?: string | null;
  stateCode?: StateCode | null;
  rates?: readonly RegisterRate[];
  roundOff?: number;
  /** A USD invoice: its amount in cents and the INR micros per USD. */
  usd?: { totalMinor: number; fxMicros: number } | undefined;
  noteOf?: NoteParent | null;
  outstandingMinor?: number;
  purposeCode?: string | null;
  reverseCharge?: boolean;
  /** Overrides, to break a row on purpose. */
  override?: Partial<RegisterRow>;
};

/** A register row from a short spec; the total is the sum of the rates plus the round-off, so a row reconciles. */
export function row(spec: RowSpec): RegisterRow {
  const supply = spec.supply ?? "intra";
  const rates = spec.rates ?? [rate("998314", 1800, 1_000_000, supply)];
  const roundOff = spec.roundOff ?? 0;
  const totalInr = sumOf(rates) + roundOff;
  const kind = spec.kind ?? "tax_invoice";
  const exportLike = supply === "export_lut" || supply === "export_igst";
  return {
    id: spec.id,
    kind,
    voided: spec.voided ?? false,
    number: spec.number ?? spec.id.toUpperCase(),
    issueDate: spec.date ?? d(2026, 10, 5),
    currency: spec.usd ? "USD" : "INR",
    totalMinor: spec.usd ? spec.usd.totalMinor : totalInr,
    totalInrMinor: totalInr,
    roundOffInrMinor: roundOff,
    fxRateMicros: spec.usd ? spec.usd.fxMicros : null,
    supplyType: supply,
    placeOfSupplyCode: spec.pos ?? (exportLike ? "96" : "19"),
    reverseCharge: spec.reverseCharge ?? false,
    recipient: {
      status: spec.status ?? (exportLike ? "overseas" : "registered"),
      gstin: spec.gstin === undefined ? (exportLike ? null : GSTIN_19) : spec.gstin,
      name: spec.name ?? `Test Client ${spec.id}`,
      address: spec.address === undefined ? null : spec.address,
      stateCode: spec.stateCode ?? null,
      countryCode: spec.country === undefined ? null : spec.country,
    },
    rates,
    noteOf: spec.noteOf ?? null,
    outstandingMinor: spec.outstandingMinor ?? (spec.usd ? spec.usd.totalMinor : totalInr),
    purposeCode: spec.purposeCode ?? null,
    ...spec.override,
  };
}

/** The parent block of a note, taken from the parent's own row. */
export const parentOf = (r: RegisterRow): NoteParent => ({
  number: r.number,
  issueDate: r.issueDate,
  supplyType: r.supplyType,
  recipientStatus: r.recipient.status,
  placeOfSupplyCode: r.placeOfSupplyCode,
  totalInrMinor: r.totalInrMinor,
});

// ---- the golden fixture: quarter Q3 of FY 2026-27 (October to December 2026) ----------------------------------------------
const inv01 = row({
  id: "inv01",
  number: "TH/INV/2627/0001",
  date: d(2026, 10, 5),
  name: "Test Client One",
  gstin: GSTIN_19,
  rates: [rate("998314", 1800, 1_000_000, "intra")],
});
const inv02 = row({
  id: "inv02",
  number: "TH/INV/2627/0002",
  date: d(2026, 10, 12),
  supply: "inter",
  pos: "27",
  name: "Test Client Two",
  gstin: GSTIN_27,
  rates: [rate("998314", 1800, 5_000_000, "inter"), rate("998313", 500, 2_000_000, "inter")],
});
const inv03 = row({
  id: "inv03",
  number: "TH/INV/2627/0003",
  date: d(2026, 10, 15),
  status: "unregistered",
  gstin: null,
  stateCode: "19",
  name: "Test Person Three",
  rates: [rate("998314", 1800, 20_000_000, "intra")],
});
// Exactly Rs 1,00,000.00: 8,474,576 + 18 % IGST 1,525,424 = 10,000,000. Not above the threshold, so B2CS.
const inv04 = row({
  id: "inv04",
  number: "TH/INV/2627/0004",
  date: d(2026, 10, 18),
  supply: "inter",
  pos: "29",
  status: "unregistered",
  gstin: null,
  stateCode: "29",
  name: "Test Person Four",
  rates: [rate("998314", 1800, 8_474_576, "inter")],
});
// One paisa more, Rs 1,00,000.01: B2CL.
const inv05 = row({
  id: "inv05",
  number: "TH/INV/2627/0005",
  date: d(2026, 10, 19),
  supply: "inter",
  pos: "29",
  status: "unregistered",
  gstin: null,
  stateCode: "29",
  name: "Test Person Five",
  roundOff: 1,
  rates: [rate("998314", 1800, 8_474_576, "inter")],
});
const exp01 = row({
  id: "exp01",
  kind: "export_invoice",
  number: "TH/EXP/2627/0001",
  date: d(2026, 11, 3),
  supply: "export_lut",
  name: "Test Overseas One",
  address: "1 Example Street, Testville",
  country: "US",
  usd: { totalMinor: 100_000, fxMicros: 83_500_000 },
  purposeCode: "P0802",
  rates: [rate("998314", 1800, 8_350_000, "export_lut")],
});
const exp02 = row({
  id: "exp02",
  kind: "export_invoice",
  number: "TH/EXP/2627/0002",
  date: d(2026, 11, 8),
  supply: "export_igst",
  name: "Test Overseas Two",
  country: "GB",
  usd: { totalMinor: 59_000, fxMicros: 84_000_000 },
  rates: [rate("998313", 1800, 4_200_000, "export_igst")],
});
const exp03 = row({
  id: "exp03",
  kind: "export_invoice",
  number: "TH/EXP/2627/0003",
  date: d(2026, 11, 20),
  supply: "export_lut",
  name: "Test Overseas Three",
  country: "AE",
  rates: [rate("998314", 1800, 3_000_000, "export_lut")],
});
const cn01 = row({
  id: "cn01",
  kind: "credit_note",
  number: "TH/CN/2627/0001",
  date: d(2026, 11, 10),
  name: "Test Client One",
  gstin: GSTIN_19,
  rates: [rate("998314", 1800, 200_000, "intra")],
  noteOf: parentOf(inv01),
});
const cn02 = row({
  id: "cn02",
  kind: "credit_note",
  number: "TH/CN/2627/0002",
  date: d(2026, 11, 11),
  supply: "inter",
  pos: "29",
  status: "unregistered",
  gstin: null,
  name: "Test Person Five",
  rates: [rate("998314", 1800, 847_457, "inter")],
  noteOf: parentOf(inv05),
});
const cn03 = row({
  id: "cn03",
  kind: "credit_note",
  number: "TH/CN/2627/0003",
  date: d(2026, 11, 25),
  supply: "export_lut",
  name: "Test Overseas One",
  usd: { totalMinor: 10_000, fxMicros: 83_500_000 },
  rates: [rate("998314", 1800, 835_000, "export_lut")],
  noteOf: parentOf(exp01),
});
const dn01 = row({
  id: "dn01",
  kind: "debit_note",
  number: "TH/DN/2627/0001",
  date: d(2026, 11, 12),
  status: "unregistered",
  gstin: null,
  name: "Test Person Three",
  rates: [rate("998314", 1800, 1_000_000, "intra")],
  noteOf: parentOf(inv03),
});
const cn04 = row({
  id: "cn04",
  kind: "credit_note",
  number: "TH/CN/2627/0004",
  date: d(2026, 12, 2),
  supply: "inter",
  pos: "27",
  status: "unregistered",
  gstin: null,
  name: "Test Person Seven",
  rates: [rate("998314", 1800, 500_000, "inter")],
  // The invoice it corrects was issued in the previous quarter and is not in this return.
  noteOf: {
    number: "TH/INV/2627/0100",
    issueDate: d(2026, 9, 20),
    supplyType: "inter",
    recipientStatus: "unregistered",
    placeOfSupplyCode: "27",
    totalInrMinor: 590_000,
  },
});
const inv06 = row({ id: "inv06", number: "TH/INV/2627/0006", date: d(2026, 11, 14), voided: true });
const inv07 = row({ id: "inv07", number: "TH/INV/2627/0100", date: d(2026, 9, 20) });
// Receiver names that a spreadsheet could read as formulas or that need quoting.
const inv08 = row({
  id: "inv08",
  number: "TH/INV/2627/0007",
  date: d(2026, 12, 4),
  name: '=HYPERLINK("x","y")',
  gstin: GSTIN_19,
  rates: [rate("998315", 500, 400_000, "intra")],
});
const inv09 = row({
  id: "inv09",
  number: "TH/INV/2627/0008",
  date: d(2026, 12, 5),
  supply: "inter",
  pos: "29",
  name: "-Acme, Ltd",
  gstin: GSTIN_29,
  rates: [rate("998314", 1800, 600_000, "inter")],
});
const inv10 = row({
  id: "inv10",
  number: "TH/INV/2627/0009",
  date: d(2026, 12, 6),
  status: "unregistered",
  gstin: null,
  name: "Line One\nLine Two",
  rates: [rate("998314", 1800, 300_000, "intra")],
});

export const GOLDEN_REGISTER: readonly RegisterRow[] = [
  inv10,
  inv01,
  exp03,
  cn01,
  inv02,
  inv03,
  inv04,
  inv05,
  exp01,
  exp02,
  cn02,
  cn03,
  dn01,
  cn04,
  inv06,
  inv07,
  inv08,
  inv09,
];

/** The quarter of the golden fixture. */
export const Q3 = { kind: "quarter", fyStartYear: 2026, quarter: 3 } as const;

/**
 * True when a CSV has a line break that is not CRLF outside quoted fields (a quoted field keeps its own inner breaks).
 * Vitest normalises a CRLF file snapshot when the received text is LF, so the file snapshots alone do not prove CRLF.
 */
export const hasBareLineBreak = (csv: string): boolean =>
  /(?<!\r)\n|\r(?!\n)/.test(csv.replace(/"(?:[^"]|"")*"/g, '""'));
