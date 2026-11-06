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
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  Mail,
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
  },
  {
    key: "care-plans",
    label: "Care plans",
    path: "/care-plans",
    icon: <LifeBuoy />,
    group: 1,
  },
  {
    key: "time",
    label: "Time",
    path: "/time",
    icon: <Clock />,
    group: 1,
  },
  {
    key: "catalogue",
    label: "Catalogue",
    path: "/catalogue",
    icon: <Package />,
    group: 2,
  },
  {
    key: "proposals",
    label: "Proposals",
    path: "/proposals",
    icon: <FileText />,
    group: 2,
  },
  {
    key: "estimates",
    label: "Estimates",
    path: "/estimates",
    icon: <Calculator />,
    group: 2,
  },
  {
    key: "invoices",
    label: "Invoices",
    path: "/invoices",
    icon: <Receipt />,
    group: 2,
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
    key: "reconciliation",
    label: "Reconciliation",
    path: "/reconciliation",
    icon: <Landmark />,
    group: 2,
  },
  {
    key: "reports",
    label: "Reports",
    path: "/reports",
    icon: <BarChart />,
    group: 3,
  },
  {
    key: "approvals",
    label: "Approvals",
    path: "/approvals",
    icon: <ClipboardCheck />,
    group: 3,
  },
  { key: "audit", label: "Audit log", path: "/audit", icon: <History />, group: 3 },
  // M7.2 review 1, finding 6: the email log (its page title, ZQ_UI.logTitle), with the other records of what happened
  { key: "emails", label: "Emails", path: "/emails", icon: <Mail />, group: 3 },
  { key: "settings", label: "Settings", path: "/settings", icon: <Settings />, group: 4 },
];

export const navItem = (key: NavKey) => NAV.find((n) => n.key === key) as NavItem;

/** The rail for one role, in the PRD order (lib/access.ts says who sees what). */
export const navFor = (role: Role) => NAV.filter((n) => canSee(role, n.key));
