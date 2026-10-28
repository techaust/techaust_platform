// The frame every JSON settings group uses (ADM-SET-01, -03..-05, -07, -09, -10; ADM-G-04, ADM-G-06): load the group,
// keep a draft, validate on submit (the form's own checks, then the shared schema from @techaust/core), save with the
// version that was read, and say plainly when someone else saved first (409 `stale_version`: reload, then try again).
// The unsaved-changes guard and the save bar come with it. Read-only roles (the accountant on tax and numbering) see the
// same page without the controls that change anything.
import { SETTINGS_SCHEMAS, type Settings } from "@techaust/core/settings";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { api, errorText, type GroupMeta, type JsonGroup, RequestError, type SettingsDoc } from "../../api.ts";
import { Skeleton } from "../../components/display.tsx";
import {
  ErrorSummary,
  researchedSettingsText,
  SaveBar,
  type SummaryError,
  VerifyNote,
} from "../../components/form.tsx";
import { LoadFailed, StaleNotice, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { adoptVersion } from "../../lib/pdf.ts";
import { type FieldErrors, fieldId, nearestField } from "../../lib/settings-form.ts";

export type Built<K extends JsonGroup> =
  | { value: Settings[K]; extra?: Record<string, unknown> }
  | { errors: FieldErrors };

export type GroupSpec<K extends JsonGroup, F> = {
  group: K;
  /** "the company profile": for the leave-without-saving dialog. */
  what: string;
  /** The toast after a save. */
  savedText: string;
  /** The group feeds documents (company, tax, payment terms): say that changes apply to new ones only. */
  forDocuments?: boolean;
  toForm: (value: Settings[K], meta: GroupMeta) => F;
  /** The form's own checks, in the order the fields appear; the value to save when there are none. */
  build: (form: F, doc: SettingsDoc<K>) => Built<K>;
};

/** What a control beside the form gets (the signature image on Company): it changes the same settings row on its own, so the form
 * takes on the row's new version when that is the very next one (`adopt`, see `adoptVersion`); a later save then never reads as stale. */
export type AfterCtx<K extends JsonGroup> = {
  readOnly: boolean;
  doc: SettingsDoc<K>;
  adopt: (next: number) => void;
};

export type FormCtx<K extends JsonGroup, F> = {
  form: F;
  set: (patch: Partial<F>) => void;
  /** The message for a field id, if it failed. */
  error: (id: string) => string | undefined;
  readOnly: boolean;
  doc: SettingsDoc<K>;
};

const GENERIC = "Check this value.";

/** The validator's own default texts ("Too small: expected number to be >=12", "Invalid input: expected string, received number"): never shown to a person. */
const RAW_VALIDATOR_TEXT =
  /^(Invalid (input|option|string|number|type|value)|Too (small|big)|Unrecognized key)/;

/** Schema issues → field errors (the zod/mini default text is replaced by a plain one). */
function schemaErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const i of issues) {
    const path = i.path.map(String).join(".");
    const id = nearestField(path, (x) => document.getElementById(x) !== null) ?? fieldId(path);
    out[id] ??= i.message && !RAW_VALIDATOR_TEXT.test(i.message) ? i.message : GENERIC;
  }
  return out;
}

export function GroupForm<K extends JsonGroup, F>(props: {
  spec: GroupSpec<K, F>;
  readOnly: boolean;
  /** A note under the verify box (e.g. what the group affects). */
  intro?: ReactNode;
  children: (ctx: FormCtx<K, F>) => ReactNode;
  /** A control after the form that saves on its own (outside the form and its save bar). */
  after?: (ctx: AfterCtx<K>) => ReactNode;
}) {
  const { spec } = props;
  const loaded = useLoad(() => api.settingsGroup(spec.group), spec.group);
  if (loaded.state === "loading") return <FormSkeleton />;
  if (loaded.state === "failed") return <LoadFailed error={loaded.error} onRetry={() => loaded.reload()} />;
  return (
    <GroupFormBody
      key={`${loaded.data.version}`}
      spec={spec}
      doc={loaded.data}
      readOnly={props.readOnly}
      intro={props.intro}
      reload={() => loaded.reload(true)}
      after={props.after}
    >
      {props.children}
    </GroupFormBody>
  );
}

function GroupFormBody<K extends JsonGroup, F>(props: {
  spec: GroupSpec<K, F>;
  doc: SettingsDoc<K>;
  readOnly: boolean;
  intro?: ReactNode;
  reload: () => void;
  children: (ctx: FormCtx<K, F>) => ReactNode;
  after?: ((ctx: AfterCtx<K>) => ReactNode) | undefined;
}) {
  const { spec, doc, readOnly } = props;
  // The version the next save sends: the one read, or the next one a control after the form saved (nobody else saved between).
  const [version, setVersion] = useState(doc.version);
  const toast = useToast();
  const [initial] = useState(() => spec.toForm(doc.value, doc.meta));
  const [form, setForm] = useState<F>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submits, setSubmits] = useState(0);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dirty = !readOnly && JSON.stringify(form) !== JSON.stringify(initial);
  const id = `form-${spec.group}`;

  const set = (patch: Partial<F>) => {
    setForm((f) => ({ ...f, ...patch }));
    setFailure(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (readOnly || busy) return;
    setFailure(null);
    const built = spec.build(form, doc);
    if ("errors" in built && Object.keys(built.errors).length) {
      setErrors(built.errors);
      setSubmits((n) => n + 1);
      return;
    }
    if (!("value" in built)) return;
    const parsed = SETTINGS_SCHEMAS[spec.group].safeParse(built.value);
    if (!parsed.success) {
      setErrors(schemaErrors(parsed.error.issues));
      setSubmits((n) => n + 1);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await api.saveSettingsGroup(spec.group, version, built.value, built.extra);
      toast("success", r.changed ? spec.savedText : "No change: these settings were already saved.");
      props.reload();
    } catch (err) {
      if (err instanceof RequestError && (err.code === "stale_version" || err.code === "version_clash")) {
        setStale(true);
      } else if (err instanceof RequestError && err.fields.length) {
        setErrors(schemaErrors(err.fields.map((f) => ({ path: f.path.split("."), message: f.message }))));
        setSubmits((n) => n + 1);
      } else {
        setFailure(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const summary: SummaryError[] = Object.entries(errors).map(([fid, text]) => ({ id: fid, text }));
  const verify = doc.meta.verify;

  return (
    <>
      {stale && <StaleNotice onReload={props.reload} />}
      {verify && (
        // The meta string names whose list holds the open questions (the CA's, or the CA's and a lawyer's).
        <VerifyNote>{researchedSettingsText(/legal|lawyer/i.test(verify))}</VerifyNote>
      )}
      {props.intro}
      {readOnly && <Notice tone="info">You can read these settings. Only the owner can change them.</Notice>}
      <form id={id} className="settings-form" onSubmit={submit} noValidate>
        <ErrorSummary errors={summary} focusKey={submits} />
        {failure && <Notice tone="error">{failure}</Notice>}
        {!readOnly && (
          <p className="hint">
            All fields are needed unless marked optional.
            {spec.forDocuments ? " Changes apply to new documents only." : ""}
          </p>
        )}
        <fieldset className="settings-form__body" disabled={readOnly || busy}>
          {props.children({ form, set, error: (fid) => errors[fid], readOnly, doc })}
        </fieldset>
      </form>
      {props.after?.({ readOnly, doc, adopt: (next) => setVersion((v) => adoptVersion(v, next)) })}
      <SaveBar
        dirty={dirty}
        busy={busy}
        form={id}
        onDiscard={() => {
          setForm(initial);
          setErrors({});
          setFailure(null);
        }}
      />
      <UnsavedChangesGuard dirty={dirty && !busy} what={spec.what} />
    </>
  );
}

/** 409: someone saved first. Reloading shows their version (the draft here is dropped). */
/** The 409 notice (moved to components/states.tsx so the lead page shares it). */
export { StaleNotice };

export function FormSkeleton() {
  return (
    <div className="settings-form" aria-busy="true">
      <p className="visually-hidden" role="status">
        Loading settings
      </p>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton-field" aria-hidden="true">
          <Skeleton width="30%" />
          <Skeleton width="70%" />
        </div>
      ))}
    </div>
  );
}

/** Keep focus sensible when a field list grows: focus the new row's first input. */
export function useFocusNew(id: string | null) {
  useEffect(() => {
    if (id) document.getElementById(id)?.focus();
  }, [id]);
}

/** The accessibility props of a control inside a SettingRow: its description (`<row>-desc`) and its error. */
export function ctl(id: string, error: string | undefined, descId?: string) {
  const describedBy = [descId, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return {
    id,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(error ? { "aria-invalid": true as const } : {}),
  };
}

/** A money amount typed in rupees or dollars (the symbol drawn before it); the form turns it into minor units. */
export function MoneyIn(props: {
  a11y: ReturnType<typeof ctl>;
  currency: "INR" | "USD";
  value: string;
  onChange: (v: string) => void;
  /** When the visible label doesn't say the currency. */
  label?: string;
}) {
  return (
    <div className="money-in">
      <span aria-hidden="true">{props.currency === "INR" ? "₹" : "$"}</span>
      <input
        {...props.a11y}
        aria-label={props.label}
        inputMode="decimal"
        autoComplete="off"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

/** The error line under a control in a SettingRow. */
export function RowError({ id, error }: { id: string; error: string | undefined }) {
  return error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null;
}
