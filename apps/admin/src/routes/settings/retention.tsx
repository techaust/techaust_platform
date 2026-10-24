// Data retention (ADM-SET-09, VERIFY WITH CA/LEGAL): how long unconverted leads, email logs, security logs and the
// financial records with the audit log are kept, each with its legal minimum (the shared schema refuses less, and so
// does the API). Legal hold and the nightly deletion job arrive in M7.4; the API's note says so.
import { NumberUnit, SettingRow } from "../../components/form.tsx";
import { type FieldErrors, intIn } from "../../lib/settings-form.ts";
import { type Built, ctl, GroupForm, type GroupSpec, RowError } from "./kit.tsx";

type Form = { leads: string; email: string; security: string; financial: string };

const ROWS = [
  {
    key: "leads",
    id: "f-leadsMonths",
    label: "Unconverted leads",
    unit: "months",
    min: 12,
    desc: "Deleted this long after their last activity. Never below 12 months (DPDP Rule 8(3)).",
    error: "Keep unconverted leads at least 12 months (DPDP Rule 8(3)).",
  },
  {
    key: "email",
    id: "f-emailLogMonths",
    label: "Email logs",
    unit: "months",
    min: 1,
    desc: "The record of each email sent: to whom, which template, delivered or not.",
    error: "Keep email logs at least 1 month.",
  },
  {
    key: "security",
    id: "f-securityLogMonths",
    label: "Security and access logs",
    unit: "months",
    min: 13,
    desc: "Sign-ins and requests. Never below 13 months (DPDP Rule 6 asks for a year, CERT-In for 180 days).",
    error: "Keep security and access logs at least 13 months.",
  },
  {
    key: "financial",
    id: "f-financialYears",
    label: "Audit log and financial records",
    unit: "years",
    min: 8,
    desc: "Never below 8 years from the end of the financial year. Financial records are never deleted, only archived.",
    error: "Keep the audit log and financial records at least 8 years.",
  },
] as const;

const spec: GroupSpec<"retention", Form> = {
  group: "retention",
  what: "the data retention settings",
  savedText: "Data retention saved.",
  toForm: (v) => ({
    leads: String(v.leadsMonths),
    email: String(v.emailLogMonths),
    security: String(v.securityLogMonths),
    financial: String(v.financialYears),
  }),
  build: (f): Built<"retention"> => {
    const e: FieldErrors = {};
    const n = Object.fromEntries(
      ROWS.map((r) => {
        const v = intIn(f[r.key], r.min);
        if (v === null) e[r.id] = r.error;
        return [r.key, v];
      }),
    ) as Record<keyof Form, number | null>;
    if (
      Object.keys(e).length ||
      n.leads === null ||
      n.email === null ||
      n.security === null ||
      n.financial === null
    )
      return { errors: e };
    return {
      value: {
        leadsMonths: n.leads,
        emailLogMonths: n.email,
        securityLogMonths: n.security,
        financialYears: n.financial,
      },
    };
  },
};

export function Retention() {
  return (
    <GroupForm spec={spec} readOnly={false}>
      {({ form: f, set, error, doc }) => (
        <>
          <div className="settings-rows">
            {ROWS.map((r) => {
              // The minimum is checked as soon as a whole number is typed, not only on save.
              const typed = intIn(f[r.key], 0);
              const live = typed !== null && typed < r.min ? r.error : undefined;
              const err = error(r.id) ?? live;
              return (
                <SettingRow
                  key={r.key}
                  id={`rt-${r.key}`}
                  label={r.label}
                  labelFor={r.id}
                  description={r.desc}
                >
                  <NumberUnit
                    a11y={ctl(r.id, err, `rt-${r.key}-desc`)}
                    value={f[r.key]}
                    onChange={(v) => set({ [r.key]: v } as Partial<Form>)}
                    unit={r.unit}
                  />
                  <RowError id={r.id} error={err} />
                </SettingRow>
              );
            })}
          </div>
          {doc.meta.notes && <p className="hint">{doc.meta.notes}</p>}
        </>
      )}
    </GroupForm>
  );
}
