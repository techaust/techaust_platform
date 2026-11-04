// The portal's sections, in the brief's order (M4.5 Screens 1; M7.1 G.1: Receipts after Invoices, for a contact who can see finance; the "coming soon"
// states of Projects and Profile are gone).
import type { ReactNode } from "react";
import { WORDS } from "../../copy-documents.ts";
import { ZP } from "../../copy-zp.ts";
import { FileCheck, FileText, FolderKanban, Home, Receipt, User } from "../icons.tsx";

export type NavKey = "home" | "documents" | "invoices" | "receipts" | "projects" | "profile";

export const NAV: { key: NavKey; label: string; icon: ReactNode }[] = [
  { key: "home", label: WORDS.nav.home, icon: <Home /> },
  { key: "documents", label: WORDS.nav.documents, icon: <FileText /> },
  { key: "invoices", label: WORDS.nav.invoices, icon: <Receipt /> },
  { key: "receipts", label: ZP.navReceipts, icon: <FileCheck /> },
  { key: "projects", label: WORDS.nav.projects, icon: <FolderKanban /> },
  { key: "profile", label: WORDS.nav.profile, icon: <User /> },
];
