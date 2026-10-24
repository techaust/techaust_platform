// SAMPLE DATA for the M3.1 design preview only (dev server, /preview/*). Every person, company, address, account
// and number here is made up: names on example.test, IP addresses from the documentation range 203.0.113.0/24,
// a GSTIN built from the textbook PAN "ABCDE1234F" with a computed check character, and bank codes starting
// "SMPL". This file is never imported by the production build (main.tsx loads /preview only in `vite dev`).
import { gstinCheckChar } from "@techaust/core";
import type { Role } from "@techaust/core/permissions";

export const NOW = Date.now();
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

export const ME = { name: "Meera Iyer", email: "meera@example.test", role: "owner" as Role };

export type Status = "active" | "invited" | "deactivated";
export type SampleUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: Status;
  lastSignIn: number | null;
  you?: boolean;
};

const BASE: SampleUser[] = [
  {
    id: "u01",
    name: "Meera Iyer",
    email: "meera@example.test",
    role: "owner",
    status: "active",
    lastSignIn: NOW - 4 * MIN,
    you: true,
  },
  {
    id: "u02",
    name: "Arjun Menon",
    email: "arjun@example.test",
    role: "staff",
    status: "active",
    lastSignIn: NOW - 3 * H,
  },
  {
    id: "u03",
    name: "Kavya Rao",
    email: "kavya@example.test",
    role: "sales",
    status: "active",
    lastSignIn: NOW - 26 * H,
  },
  {
    id: "u04",
    name: "Dev Banerjee",
    email: "dev@example.test",
    role: "accountant",
    status: "active",
    lastSignIn: NOW - 5 * D,
  },
  {
    id: "u05",
    name: "Nisha Kapoor",
    email: "nisha@example.test",
    role: "staff",
    status: "invited",
    lastSignIn: null,
  },
  {
    id: "u06",
    name: "Sana Qureshi",
    email: "sana@example.test",
    role: "staff",
    status: "active",
    lastSignIn: NOW - 9 * D,
  },
  {
    id: "u07",
    name: "Rahul Dutta",
    email: "rahul@example.test",
    role: "sales",
    status: "deactivated",
    lastSignIn: NOW - 41 * D,
  },
  {
    id: "u08",
    name: "",
    email: "tom.ellis@example.test",
    role: "accountant",
    status: "invited",
    lastSignIn: null,
  },
];

const FIRST = [
  "Aditi",
  "Bina",
  "Chetan",
  "Diya",
  "Eshan",
  "Farah",
  "Gautam",
  "Hema",
  "Ishaan",
  "Jaya",
  "Kiran",
  "Lata",
  "Manav",
];
const LAST = ["Bose", "Chopra", "Das", "Ghosh"];
const ROLES: Role[] = ["staff", "sales", "accountant", "staff"];
const STATUSES: Status[] = ["active", "active", "invited", "active", "deactivated"];

/** The "long list" preview: 60 made-up people, to show keyset paging. */
export const LONG: SampleUser[] = [
  ...BASE,
  ...Array.from({ length: 52 }, (_, i) => {
    const first = FIRST[i % FIRST.length] as string;
    const last = LAST[Math.floor(i / FIRST.length) % LAST.length] as string;
    const status = STATUSES[i % STATUSES.length] as Status;
    return {
      id: `u${String(i + 9).padStart(2, "0")}`,
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@example.test`,
      role: ROLES[i % ROLES.length] as Role,
      status,
      lastSignIn: status === "invited" ? null : NOW - (i + 2) * 7 * H,
    };
  }),
];

export const USERS = BASE;

// ---------- Search ----------
export type SampleHit = {
  type: "Leads" | "Clients" | "Contacts" | "Projects" | "Documents";
  title: string;
  sub: string;
  section: string;
};
export const SEARCH: SampleHit[] = [
  {
    type: "Leads",
    title: "Riverside Dental Clinic",
    sub: "New lead, quote form, 12 minutes ago",
    section: "leads",
  },
  { type: "Leads", title: "Asha Patel", sub: "New lead, contact form, 2 hours ago", section: "leads" },
  { type: "Leads", title: "Harbour Freight Co", sub: "Proposal sent, 6 days ago", section: "leads" },
  { type: "Clients", title: "Northwind Traders", sub: "Client since Apr 2026, INR", section: "clients" },
  { type: "Clients", title: "Bluefin Logistics", sub: "Client since Aug 2026, USD", section: "clients" },
  { type: "Contacts", title: "Ravi Shah", sub: "Northwind Traders, ravi@example.test", section: "clients" },
  { type: "Contacts", title: "Riya Sen", sub: "Bluefin Logistics, riya@example.test", section: "clients" },
  {
    type: "Projects",
    title: "Northwind order portal",
    sub: "Northwind Traders, in progress",
    section: "projects",
  },
  {
    type: "Projects",
    title: "Riverside booking automation",
    sub: "Riverside Dental Clinic, draft",
    section: "projects",
  },
  {
    type: "Documents",
    title: "TH/INV/2627/0042",
    sub: "Tax invoice, Northwind Traders",
    section: "invoices",
  },
  {
    type: "Documents",
    title: "TH/PRP/2627/0007 v2",
    sub: "Proposal, Riverside Dental Clinic",
    section: "proposals",
  },
  { type: "Documents", title: "TH/EST/2627/0003", sub: "Estimate, Harbour Freight Co", section: "estimates" },
];

// ---------- Notifications ----------
export const NOTIFICATIONS = [
  {
    id: "n1",
    title: "New lead: Riverside Dental Clinic",
    detail: "Quote form, website rebuild",
    at: NOW - 12 * MIN,
    section: "leads",
    unread: true,
  },
  {
    id: "n2",
    title: "New lead: Asha Patel",
    detail: "Contact form, asks about a care plan",
    at: NOW - 2 * H,
    section: "leads",
    unread: true,
  },
  {
    id: "n3",
    title: "Invite accepted",
    detail: "Sana Qureshi joined as Staff",
    at: NOW - 30 * H,
    section: "users",
    unread: false,
  },
  {
    id: "n4",
    title: "Job failed: nightly backup",
    detail: "It retries tonight. Nothing was lost.",
    at: NOW - 3 * D,
    section: "audit",
    unread: false,
  },
];

// ---------- Company and bank (sample values) ----------
const PAN = "ABCDE1234F";
export const SAMPLE_GSTIN = `19${PAN}1Z${gstinCheckChar(`19${PAN}1Z`)}`;
/** Same GSTIN with its last character changed, to show the check-character error. */
export const SAMPLE_GSTIN_BAD_CHECK = `${SAMPLE_GSTIN.slice(0, 14)}${SAMPLE_GSTIN.endsWith("A") ? "B" : "A"}`;
export const SAMPLE_GSTIN_BAD_FORMAT = "19ABCDE12341Z5X";

export const COMPANY = {
  tradeName: "TecHaust Technologies",
  legalName: "Meera Iyer",
  gstin: SAMPLE_GSTIN,
  address: "1 Sample Street, Sample Town, West Bengal 700000",
  stateCode: "19",
  documentsEmail: "accounts@example.test",
  documentsPhone: "+91 00000 00000",
};

export const BANK = {
  inr: {
    accountName: "TecHaust Technologies",
    last4: "4821",
    ifsc: "SMPL0000001",
    bank: "Sample Bank",
    branch: "Sample Town branch",
  },
  usd: {
    swift: "SMPLINBBXXX",
    bankAddress: "Sample Bank, 1 Sample Street, Sample Town, India",
    intermediary: "Sample Correspondent Bank, New York (SMPLUS33XXX)",
    last4: "4821",
  },
};

// ---------- Audit log ----------
export type AuditKind = "settings" | "security" | "users";
export type AuditEntry = {
  id: string;
  at: number;
  actor: string;
  role: string;
  kind: AuditKind;
  action: string;
  target: string;
  ip: string;
  device: string;
  diff?: { field: string; before: string; after: string; masked?: boolean }[];
};

export const AUDIT: AuditEntry[] = [
  {
    id: "a01",
    at: NOW - 18 * MIN,
    actor: "Meera Iyer",
    role: "Owner",
    kind: "settings",
    action: "changed bank details",
    target: "Settings, bank details",
    ip: "203.0.113.24",
    device: "Edge on Windows",
    diff: [
      { field: "INR account number", before: "•••• 1177", after: "•••• 4821", masked: true },
      { field: "IFSC", before: "SMPL0000009", after: "SMPL0000001" },
    ],
  },
  {
    id: "a02",
    at: NOW - 22 * MIN,
    actor: "Meera Iyer",
    role: "Owner",
    kind: "security",
    action: "confirmed it's them (step-up)",
    target: "Own account",
    ip: "203.0.113.24",
    device: "Edge on Windows",
  },
  {
    id: "a03",
    at: NOW - 47 * MIN,
    actor: "Meera Iyer",
    role: "Owner",
    kind: "settings",
    action: "changed the company profile",
    target: "Settings, company profile",
    ip: "203.0.113.24",
    device: "Edge on Windows",
    diff: [
      { field: "Email on documents", before: "contact@example.test", after: "accounts@example.test" },
      { field: "Phone on documents", before: "Not set", after: "+91 00000 00000" },
    ],
  },
  {
    id: "a04",
    at: NOW - 3 * H,
    actor: "Arjun Menon",
    role: "Staff",
    kind: "security",
    action: "signed in",
    target: "Own account",
    ip: "203.0.113.51",
    device: "Chrome on Android",
  },
  {
    id: "a05",
    at: NOW - 26 * H,
    actor: "Meera Iyer",
    role: "Owner",
    kind: "users",
    action: "invited tom.ellis@example.test as Accountant",
    target: "Users",
    ip: "203.0.113.24",
    device: "Edge on Windows",
  },
  {
    id: "a06",
    at: NOW - 30 * H,
    actor: "Sana Qureshi",
    role: "Staff",
    kind: "users",
    action: "accepted an invite and set up two-step sign-in",
    target: "Users",
    ip: "203.0.113.77",
    device: "Safari on iPhone",
  },
  {
    id: "a07",
    at: NOW - 31 * H,
    actor: "Meera Iyer",
    role: "Owner",
    kind: "settings",
    action: "changed tax settings",
    target: "Settings, tax",
    ip: "203.0.113.24",
    device: "Edge on Windows",
    diff: [{ field: "Export mode by default", before: "IGST paid", after: "Under LUT (0 % IGST)" }],
  },
  {
    id: "a08",
    at: NOW - 2 * D - 2 * H,
    actor: "Meera Iyer",
    role: "Owner",
    kind: "users",
    action: "changed Kavya Rao's role",
    target: "Users",
    ip: "203.0.113.24",
    device: "Edge on Windows",
    diff: [{ field: "Role", before: "Staff", after: "Sales" }],
  },
  {
    id: "a09",
    at: NOW - 2 * D - 5 * H,
    actor: "System",
    role: "",
    kind: "security",
    action: "locked sign-in for 15 minutes after 10 wrong codes",
    target: "rahul@example.test",
    ip: "203.0.113.90",
    device: "Firefox on Linux",
  },
  {
    id: "a10",
    at: NOW - 2 * D - 6 * H,
    actor: "Meera Iyer",
    role: "Owner",
    kind: "users",
    action: "deactivated Rahul Dutta",
    target: "Users",
    ip: "203.0.113.24",
    device: "Edge on Windows",
    diff: [{ field: "Status", before: "Active", after: "Deactivated" }],
  },
  {
    id: "a11",
    at: NOW - 3 * D,
    actor: "Meera Iyer",
    role: "Owner",
    kind: "settings",
    action: "turned on a feature flag",
    target: "Settings, feature flags",
    ip: "203.0.113.24",
    device: "Edge on Windows",
    diff: [{ field: "Blog", before: "Off", after: "On" }],
  },
  {
    id: "a12",
    at: NOW - 3 * D - 4 * H,
    actor: "Dev Banerjee",
    role: "Accountant",
    kind: "security",
    action: "signed in",
    target: "Own account",
    ip: "203.0.113.12",
    device: "Chrome on macOS",
  },
];
