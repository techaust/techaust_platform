// The reports section (M5.5b; ADM-REP-04, ADM-REP-07, ADM-INV-17): GST exports, the sales register, the EDF list and export realisation, for the
// Owner and the Accountant (`reports.finance`; the GST files need `exports.gst`, a fresh code on every page the server reads). One lazy chunk: the gst
// core (`@techaust/core/gst`, SPA only, LD16) is fetched only when a report opens. Staff and Sales see the reports that arrive with M7.3 as before.
//
// Design: the four reports share one frame, a row of links under the title (the section's own index, the rail's 45° cut on the current one), and one
// device from the accounts they serve: a figure that closes a list stands on a double rule, as a ledger's total does. Nothing else is decorated.
import "../reports.css";
import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router";
import { ComingSoon, NoAccess, NotFound } from "../components/states.tsx";
import { allowed, canSee } from "../lib/access.ts";
import { REPORTS_COPY, type ReportKey } from "../lib/reports.ts";
import { useUser } from "../session.tsx";
import { EdfReport } from "./reports/edf.tsx";
import { GstExports } from "./reports/gst.tsx";
import { RealisationReport } from "./reports/realisation.tsx";
import { SalesRegister } from "./reports/sales-register.tsx";

export function Component() {
  const { report } = useParams();
  const user = useUser();
  if (!allowed(user.role, "reports.finance")) {
    // The delivery and pipeline reports arrive with M7.3 (the rail's "coming soon" for the roles that will have them).
    if (canSee(user.role, "reports")) return <ComingSoon section="reports" />;
    return <NoAccess what={REPORTS_COPY.group} />;
  }
  if (report === undefined) return <Navigate to="/reports/gst" replace />;
  const screens: Record<ReportKey, ReactNode> = {
    gst: <GstExports />,
    "sales-register": <SalesRegister />,
    edf: <EdfReport />,
    realisation: <RealisationReport />,
  };
  if (!Object.hasOwn(screens, report)) return <NotFound />;
  return screens[report as ReportKey];
}
