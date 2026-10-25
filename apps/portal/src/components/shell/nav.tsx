// The portal's five sections, in the brief's order (M4.5 Screens 1). Invoices arrive in M5 to M7, projects and the
// profile in M7.1; until then their screens show a calm "coming soon" state.
import type { ReactNode } from "react";
import { WORDS } from "../../copy-documents.ts";
import { FileText, FolderKanban, Home, Receipt, User } from "../icons.tsx";

export type NavKey = "home" | "documents" | "invoices" | "projects" | "profile";

export const NAV: { key: NavKey; label: string; icon: ReactNode }[] = [
  { key: "home", label: WORDS.nav.home, icon: <Home /> },
  { key: "documents", label: WORDS.nav.documents, icon: <FileText /> },
  { key: "invoices", label: WORDS.nav.invoices, icon: <Receipt /> },
  { key: "projects", label: WORDS.nav.projects, icon: <FolderKanban /> },
  { key: "profile", label: WORDS.nav.profile, icon: <User /> },
];
