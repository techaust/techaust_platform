// The admin's left navigation, in the order of ADM-G-01. Sections that a later milestone builds carry what arrives
// and when (by milestone, never a date), for their "coming soon" screen.
import type { Role } from "@techaust/core/permissions";
import type { ReactNode } from "react";
import { canSee, type NavKey } from "../../lib/access.ts";
import {
  BarChart,
  Building,
  Calculator,
  ClipboardCheck,
  Clock,
  FileText,
  FolderKanban,
  History,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Package,
  Receipt,
  Settings,
  Wallet,
} from "../icons.tsx";

export type { NavKey };

export type NavItem = {
  key: NavKey;
  label: string;
  path: string;
  icon: ReactNode;
  /** Items are drawn in groups with a hairline between them: the day's work, documents and money, oversight. */
  group: 0 | 1 | 2 | 3 | 4;
  /** For sections a later milestone builds. */
  arrives?: { milestone: string; what: string };
};

export const NAV: NavItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    path: "/",
    icon: <LayoutDashboard />,
    group: 0,
    arrives: {
      milestone: "M3.5",
      what: "Tiles for new leads, active projects, care plans and the time logged this week.",
    },
  },
  {
    key: "leads",
    label: "Leads",
    path: "/leads",
    icon: <Inbox />,
    group: 1,
  },
  {
    key: "clients",
    label: "Clients",
    path: "/clients",
    icon: <Building />,
    group: 1,
  },
  {
    key: "projects",
    label: "Projects",
    path: "/projects",
    icon: <FolderKanban />,
    group: 1,
    arrives: {
      milestone: "M3.4",
      what: "Projects with milestones, notes and files, shared with the client or kept internal.",
    },
  },
  {
    key: "care-plans",
    label: "Care plans",
    path: "/care-plans",
    icon: <LifeBuoy />,
    group: 1,
    arrives: { milestone: "M3.5", what: "Care plans with their included hours, renewals and overage." },
  },
  {
    key: "time",
    label: "Time",
    path: "/time",
    icon: <Clock />,
    group: 1,
    arrives: {
      milestone: "M3.5",
      what: "Time logged against projects and care plans, locked after 7 days.",
    },
  },
  {
    key: "catalogue",
    label: "Catalogue",
    path: "/catalogue",
    icon: <Package />,
    group: 2,
    arrives: {
      milestone: "M4.1",
      what: "The service catalogue and its prices, and publishing them to the website.",
    },
  },
  {
    key: "proposals",
    label: "Proposals",
    path: "/proposals",
    icon: <FileText />,
    group: 2,
    arrives: {
      milestone: "M4.3",
      what: "Proposals with line items, payment schedules and versions, which clients accept online.",
    },
  },
  {
    key: "estimates",
    label: "Estimates",
    path: "/estimates",
    icon: <Calculator />,
    group: 2,
    arrives: { milestone: "M4.3", what: "Estimates for smaller jobs, built like proposals." },
  },
  {
    key: "invoices",
    label: "Invoices",
    path: "/invoices",
    icon: <Receipt />,
    group: 2,
    arrives: {
      milestone: "M5.1–M5.5",
      what: "Tax and export invoices, proformas, credit and debit notes, with gap-free numbers.",
    },
  },
  {
    key: "payments",
    label: "Payments",
    path: "/payments",
    icon: <Wallet />,
    group: 2,
    arrives: {
      milestone: "M6.1–M6.5",
      what: "Payments by Razorpay, Stripe, PayPal and bank transfer, with receipts and refunds.",
    },
  },
  {
    key: "reports",
    label: "Reports",
    path: "/reports",
    icon: <BarChart />,
    group: 3,
    arrives: { milestone: "M7.3", what: "Sales, receivables and GST reports, and exports for your CA." },
  },
  {
    key: "approvals",
    label: "Approvals",
    path: "/approvals",
    icon: <ClipboardCheck />,
    group: 3,
    arrives: {
      milestone: "M4.3",
      what: "Requests that need the owner, such as a proposal discount over 10 % or an invoice to issue.",
    },
  },
  { key: "audit", label: "Audit log", path: "/audit", icon: <History />, group: 3 },
  { key: "settings", label: "Settings", path: "/settings", icon: <Settings />, group: 4 },
];

export const navItem = (key: NavKey) => NAV.find((n) => n.key === key) as NavItem;

/** The rail for one role, in the PRD order (lib/access.ts says who sees what). */
export const navFor = (role: Role) => NAV.filter((n) => canSee(role, n.key));
