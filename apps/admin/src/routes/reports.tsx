// The reports section (M5.5b; ADM-REP-04, ADM-REP-07, ADM-INV-17): GST exports, the sales register, the EDF list and export realisation, for the
// Owner and the Accountant (`reports.finance`; the GST files need `exports.gst`, a fresh code on every page the server reads). One lazy chunk: the gst
// core (`@techaust/core/gst`, SPA only, LD16) is fetched only when a report opens.
// M7.3 (ADM-REP-01, -02, -03, -05, -06): the management reports, each for the roles of its matrix action: Revenue and collections and Outstanding and ageing
// (`reports.finance`: the Owner and the Accountant), Pipeline and win rate (`reports.pipeline`: the Owner and Sales), Care plan hours (`reports.delivery`: the
// Owner and Staff). `/reports` opens the first report the role may read. The charts are their own chunk (components/chart), loaded with these screens.
//
// Design: the reports share one frame, a row of links under the title (the section's own index, the rail's 45° cut on the current one), and one
// device from the accounts they serve: a figure that closes a list stands on a double rule, as a ledger's total does. Nothing else is decorated.
import "../reports.css";
import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router";
import { NoAccess, NotFound } from "../components/states.tsx";
import { allowed } from "../lib/access.ts";
import { REPORTS, REPORTS_COPY, type ReportKey } from "../lib/reports.ts";
import { useUser } from "../session.tsx";
import { AgeingReport } from "./reports/ageing.tsx";
import { CareHoursReport } from "./reports/care-hours.tsx";
import { EdfReport } from "./reports/edf.tsx";
import { GstExports } from "./reports/gst.tsx";
import { PaymentsRegister } from "./reports/payments.tsx";
import { PipelineReport } from "./reports/pipeline.tsx";
import { RealisationReport } from "./reports/realisation.tsx";
import { RefundsRegister } from "./reports/refunds.tsx";
import { RevenueReport } from "./reports/revenue.tsx";
import { SalesRegister } from "./reports/sales-register.tsx";

export function Component() {
  const { report } = useParams();
  const user = useUser();
  const mine = REPORTS.filter((r) => allowed(user.role, r.action));
  const first = mine[0];
  if (!first) return <NoAccess what={REPORTS_COPY.group} />;
  if (report === undefined) return <Navigate to={first.path} replace />;
  const entry = REPORTS.find((r) => r.key === report);
  if (!entry) return <NotFound />;
  if (!allowed(user.role, entry.action))
    return <NoAccess what={entry.label} crumbs={[{ label: REPORTS_COPY.group, to: "/reports" }]} />;
  const screens: Record<ReportKey, () => ReactNode> = {
    revenue: () => <RevenueReport />,
    ageing: () => <AgeingReport />,
    pipeline: () => <PipelineReport />,
    "care-hours": () => <CareHoursReport />,
    gst: () => <GstExports />,
    "sales-register": () => <SalesRegister />,
    edf: () => <EdfReport />,
    realisation: () => <RealisationReport />,
    payments: () => <PaymentsRegister />,
    refunds: () => <RefundsRegister />,
  };
  return screens[entry.key]();
}
