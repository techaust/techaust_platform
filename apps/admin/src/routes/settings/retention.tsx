// Data retention (ADM-SET-09; Researched 2026-10-28, DPDP Rule 8 and Rule 56 CGST, 08-C RB-09, RB-10, RA-25): how long unconverted leads, email logs, security logs and the
// financial records with the audit log are kept, each with its legal minimum (the shared schema refuses less, and so
// does the API). Legal hold and the nightly deletion job arrive in M7.4; the API's note says so.
import { NumberUnit, SettingRow } from "../../components/form.tsx";
import {
  buildRetention,
  RETENTION_ROWS,
  type RetentionForm,
  retentionRowError,
  retentionToForm,
} from "../../lib/retention-form.ts";
import { type Built, ctl, GroupForm, type GroupSpec, RowError } from "./kit.tsx";

const spec: GroupSpec<"retention", RetentionForm> = {
  group: "retention",
  what: "the data retention settings",
  savedText: "Data retention saved.",
  toForm: retentionToForm,
  build: (f): Built<"retention"> => buildRetention(f),
};

export function Retention() {
  return (
    <GroupForm spec={spec} readOnly={false}>
      {({ form: f, set, error, doc }) => (
        <>
          <div className="settings-rows">
            {RETENTION_ROWS.map((r) => {
              // The minimum is checked as soon as a whole number is typed, not only on save; a refusal of the field (the schema's or the server's) shows the row's own line, never the validator's text.
              const err = retentionRowError(r, f[r.key], error(r.id));
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
                    onChange={(v) => set({ [r.key]: v } as Partial<RetentionForm>)}
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
