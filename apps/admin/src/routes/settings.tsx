// Settings (ADM-SET-01..10): the overview of the groups this role may open, with what needs attention (from
// GET /settings), and each group's page inside the settings frame (the group list beside it on wide screens). The
// owner sees every group and Users; the accountant reads tax, numbering and the masked bank details.
import type { ReactNode } from "react";
import { Link, NavLink, useParams } from "react-router";
import { api, type GroupKey } from "../api.ts";
import { PageHeader, Skeleton, StatusPill } from "../components/display.tsx";
import {
  Archive,
  ArrowLeft,
  Building,
  Calendar,
  ChevronRight,
  CreditCard,
  FileText,
  Flag,
  Hash,
  Landmark,
  Mail,
  Percent,
  Users,
} from "../components/icons.tsx";
import { LoadFailed, NoAccess, NotFound, useLoad } from "../components/states.tsx";
import { allowed, canManageUsers, type SettingsGroupKey, settingsFor, settingsPage } from "../lib/access.ts";
import { useUser } from "../session.tsx";
import { BankDetails } from "./settings/bank.tsx";
import { CompanyProfile } from "./settings/company.tsx";
import { EmailSettings } from "./settings/email.tsx";
import { FeatureFlags } from "./settings/flags.tsx";
import { Gateways } from "./settings/gateways.tsx";
import { NumberingSettings } from "./settings/numbering.tsx";
import { PaymentTerms } from "./settings/payment-terms.tsx";
import { Retention } from "./settings/retention.tsx";
import { TaxSettings } from "./settings/tax.tsx";
import { DocumentTerms } from "./settings/terms.tsx";

const ABOUT: Record<SettingsGroupKey, { label: string; icon: ReactNode; desc: string }> = {
  company: {
    label: "Company profile",
    icon: <Building />,
    desc: "Names, GSTIN, address and logos on your documents.",
  },
  bank: {
    label: "Bank details",
    icon: <Landmark />,
    desc: "The INR and USD accounts printed on invoices.",
  },
  tax: { label: "Tax", icon: <Percent />, desc: "GST rate, SAC codes, rounding and exports under LUT." },
  numbering: {
    label: "Numbering",
    icon: <Hash />,
    desc: "Number formats and the next number for each document type.",
  },
  payment_terms: {
    label: "Payment terms",
    icon: <Calendar />,
    desc: "Due days, reminders, schedules and the small-job threshold.",
  },
  gateways: {
    label: "Gateways",
    icon: <CreditCard />,
    desc: "Razorpay, Stripe and PayPal: test or live, and whether keys are set.",
  },
  email: {
    label: "Email",
    icon: <Mail />,
    desc: "Sender addresses, reply-to, copies to you and the footer.",
  },
  terms: {
    label: "Document terms",
    icon: <FileText />,
    desc: "Standard terms, proposal terms and invoice notes, with versions.",
  },
  retention: {
    label: "Data retention",
    icon: <Archive />,
    desc: "How long leads, logs and records are kept.",
  },
  flags: { label: "Feature flags", icon: <Flag />, desc: "Switches for the website and the admin." },
};

export const groupLabel = (g: SettingsGroupKey) => ABOUT[g].label;

export function SettingsIndex() {
  const user = useUser();
  return allowed(user.role, "settings.read") ? <Overview /> : <NoAccess what="Settings" />;
}

function Overview() {
  const user = useUser();
  const overview = useLoad(() => api.settingsOverview(), "");
  const attention = new Map<GroupKey, string[]>(
    overview.state === "ready" ? overview.data.groups.map((g) => [g.group, g.attention]) : [],
  );
  const pages = settingsFor(user.role);
  return (
    <>
      <PageHeader
        title="Settings"
        lede={
          canManageUsers(user.role)
            ? "How TecHaust appears on documents, how money and tax work, and who can sign in."
            : "The tax, numbering and bank settings your role can read."
        }
      />
      {overview.state === "failed" ? (
        <LoadFailed error={overview.error} onRetry={() => overview.reload()} />
      ) : (
        <div className="settings-index">
          {canManageUsers(user.role) && (
            <section aria-labelledby="set-people">
              <h2 id="set-people" className="settings-index__h">
                People
              </h2>
              <ul className="setlist">
                <SetLink
                  to="/settings/users"
                  icon={<Users />}
                  label="Users"
                  desc="Who can sign in, their roles and invites."
                />
              </ul>
            </section>
          )}
          <section aria-labelledby="set-business">
            <h2 id="set-business" className="settings-index__h">
              Business
            </h2>
            <ul className="setlist">
              {pages.map((p) => (
                <SetLink
                  key={p.group}
                  to={`/settings/${p.slug}`}
                  icon={ABOUT[p.group].icon}
                  label={ABOUT[p.group].label}
                  desc={ABOUT[p.group].desc}
                  attention={
                    overview.state === "loading"
                      ? null
                      : (attention.get(p.group as GroupKey) ?? []).join(". ")
                  }
                />
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}

function SetLink(props: {
  to: string;
  icon: ReactNode;
  label: string;
  desc: string;
  /** null while the overview loads (a placeholder keeps the row still). */
  attention?: string | null;
}) {
  return (
    <li>
      <Link to={props.to} className="setlist__link">
        <span className="setlist__icon">{props.icon}</span>
        <span className="setlist__text">
          <span className="setlist__label">{props.label}</span>
          <span className="setlist__desc">{props.desc}</span>
        </span>
        {props.attention === null ? (
          <span aria-hidden="true" className="setlist__wait">
            <Skeleton width="5rem" />
          </span>
        ) : (
          props.attention && (
            <StatusPill tone="warning" icon="clock">
              {props.attention}
            </StatusPill>
          )
        )}
        <ChevronRight />
      </Link>
    </li>
  );
}

const CRUMBS = [{ label: "Settings", to: "/settings" }];

export function SettingsGroup() {
  const { group: slug } = useParams();
  const user = useUser();
  const page = settingsPage(slug);
  if (!page) return <NotFound />;
  if (!allowed(user.role, page.read)) return <NoAccess what={ABOUT[page.group].label} crumbs={CRUMBS} />;
  const readOnly = !allowed(user.role, page.write);
  const about = ABOUT[page.group];
  const body: Record<SettingsGroupKey, ReactNode> = {
    company: <CompanyProfile />,
    bank: <BankDetails readOnly={readOnly} />,
    tax: <TaxSettings readOnly={readOnly} />,
    numbering: <NumberingSettings readOnly={readOnly} />,
    payment_terms: <PaymentTerms />,
    gateways: <Gateways />,
    email: <EmailSettings />,
    terms: <DocumentTerms />,
    retention: <Retention />,
    flags: <FeatureFlags />,
  };
  return (
    <div className="settings">
      <nav className="settings__nav" aria-label="Settings">
        <ul>
          {canManageUsers(user.role) && (
            <li>
              <NavLink to="/settings/users" className="settings__link">
                Users
              </NavLink>
            </li>
          )}
          {settingsFor(user.role).map((p) => (
            <li key={p.slug}>
              <NavLink to={`/settings/${p.slug}`} className="settings__link">
                {ABOUT[p.group].label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="settings__body">
        <Link to="/settings" className="back settings__back">
          <ArrowLeft size={16} />
          All settings
        </Link>
        <PageHeader title={about.label} crumbs={CRUMBS} lede={about.desc} />
        {body[page.group]}
      </div>
    </div>
  );
}
