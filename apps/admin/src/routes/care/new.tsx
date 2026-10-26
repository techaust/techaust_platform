// A new care plan (M3.5, ADM-CARE-01): the client (searched, or set by the client page's link `?client=`), then the terms with the
// catalogue's prefill for the tier from GET /care-plans/defaults (S16 lines by tier, S18, S17), and the billing: start date and
// billing day 1 to 28. Nothing undecided is invented: the hours of the larger tiers and the overage rate stay empty until someone
// types them. The currency is the client's (shown, not chosen). Owner and staff may set any terms here (owner's Q6); later
// changes are the owner's. On success the plan's page opens.
import { istDate, toIsoDate } from "@techaust/core/dates";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, type CareDefaults, type ClientView, errorText, RequestError } from "../../api.ts";
import { DateField } from "../../components/date-field.tsx";
import { PageHeader } from "../../components/display.tsx";
import { ErrorSummary, FormField, type SummaryError } from "../../components/form.tsx";
import { Lock } from "../../components/icons.tsx";
import { NoAccess, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { allowed } from "../../lib/access.ts";
import {
  CARE_COPY,
  CARE_TOASTS,
  careErrorText,
  type PlanErrors,
  type PlanForm,
  planFormFor,
  planInput,
} from "../../lib/care.ts";
import { PENDING } from "../../lib/projects.ts";
import { useUser } from "../../session.tsx";
import { ClientPicker } from "../projects/new.tsx";
import { CARE_CRUMBS, CareGate } from "./parts.tsx";
import { TermsFields } from "./terms-fields.tsx";

export function Component() {
  const user = useUser();
  return (
    <CareGate>
      {allowed(user.role, "carePlans.write") ? (
        <NewCarePlan />
      ) : (
        <NoAccess what="New care plan" crumbs={CARE_CRUMBS} />
      )}
    </CareGate>
  );
}

const P = "ncp";
const today = () => toIsoDate(istDate(Date.now()));

function NewCarePlan() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const preset = params.get("client");
  const [client, setClient] = useState<ClientView | null>(null);
  const [picking, setPicking] = useState(!preset);
  const [f, setF] = useState<PlanForm | null>(null);
  const [touched, setTouched] = useState(false);
  const [errors, setErrors] = useState<SummaryError[]>([]);
  const [fieldErrors, setFieldErrors] = useState<PlanErrors>({});
  const [submits, setSubmits] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const presetLoad = useLoad(() => (preset ? api.client(preset) : Promise.resolve(null)), preset ?? "");
  const [presetSeen, setPresetSeen] = useState(false);
  if (!presetSeen && presetLoad.state === "ready") {
    setPresetSeen(true);
    if (presetLoad.data) setClient(presetLoad.data.client);
    else setPicking(true);
  }
  if (!presetSeen && presetLoad.state === "failed") {
    setPresetSeen(true);
    setPicking(true);
  }

  // The prefill for the chosen client: its currency and the catalogue's prices by tier.
  const defaults = useLoad<CareDefaults | null>(
    () => (client ? api.careDefaults(client.id) : Promise.resolve(null)),
    client?.id ?? "",
  );
  const d = defaults.state === "ready" ? defaults.data : null;
  const [seenDefaults, setSeenDefaults] = useState<CareDefaults | null>(null);
  if (d && d !== seenDefaults) {
    setSeenDefaults(d);
    // A new client: keep what was typed for the billing, refill the terms in the new currency.
    setF((x) =>
      planFormFor(x?.tier ?? "essential", d, {
        startDate: x?.startDate ?? today(),
        billingDay: x?.billingDay ?? "1",
        aiOps: x?.aiOps ?? false,
      }),
    );
  }

  const dirty = !saved && (client !== null || touched);
  const errorOf = (id: string) => errors.find((e) => e.id === id)?.text;
  useEffect(() => {
    if (saved) navigate(`/care-plans/${saved}`, { replace: true });
  }, [saved, navigate]);

  function patch(p: Partial<PlanForm>) {
    setTouched(true);
    setF((x) => (x ? { ...x, ...p } : x));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const list: SummaryError[] = [];
    if (!client) list.push({ id: `${P}-client-q`, text: PENDING.chooseClient });
    let body: ReturnType<typeof planInput> | null = null;
    if (client && f && d) {
      body = planInput(f, client.id, d.currency);
      if (!body.ok) {
        setFieldErrors(body.errors);
        for (const [k, v] of Object.entries(body.errors)) if (v) list.push({ id: `${P}-${k}`, text: v });
      } else setFieldErrors({});
    }
    setErrors(list);
    setSubmits((n) => n + 1);
    if (list.length || !body?.ok) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.createCarePlan(body.body);
      toast("success", CARE_TOASTS.added);
      setSaved(r.id);
    } catch (err) {
      setFailure(err instanceof RequestError ? careErrorText(err) : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const anonymised = d?.clientAnonymised === true;

  return (
    <>
      <UnsavedChangesGuard dirty={dirty} what="this care plan" />
      <PageHeader title="New care plan" crumbs={CARE_CRUMBS} />
      <form className="settings-form client-new care-new" onSubmit={submit} noValidate>
        <p className="hint form-intro">All fields are needed unless marked optional.</p>
        <ErrorSummary errors={errors} focusKey={submits} />
        {failure && <Notice tone="error">{failure}</Notice>}

        <fieldset className="form-section">
          <legend>Client</legend>
          {client && !picking ? (
            <div className="chosen-client">
              <p className="chosen-client__name">
                <span>{client.displayName}</span>
                <span className="docno client-code">{client.code}</span>
              </p>
              <button
                type="button"
                className="btn btn--text"
                onClick={() => {
                  setPicking(true);
                  requestAnimationFrame(() => document.getElementById(`${P}-client-q`)?.focus());
                }}
              >
                Change<span className="visually-hidden"> the client</span>
              </button>
            </div>
          ) : (
            <ClientPicker
              prefix={P}
              chosen={client}
              error={errorOf(`${P}-client-q`)}
              onChoose={(c) => {
                setClient(c);
                setErrors((x) => x.filter((e) => e.id !== `${P}-client-q`));
              }}
            />
          )}
          <div className="field">
            <span className="label-like">Currency</span>
            <p className="locked-value">
              {client ? (
                <span className="locked-inline">
                  <Lock size={16} />
                  <span className="docno">{client.currency}</span>
                </span>
              ) : (
                <span className="muted">Set by the client</span>
              )}
            </p>
            <p className="hint">{CARE_COPY.currencyLine}</p>
          </div>
          {anonymised && <Notice tone="info">{CARE_COPY.clientAnonymised}</Notice>}
        </fieldset>

        {client && defaults.state === "failed" && (
          <Notice tone="error">{careErrorText(defaults.error)}</Notice>
        )}
        {client && f && d && (
          <>
            <fieldset className="form-section">
              <legend>Terms</legend>
              <TermsFields
                prefix={P}
                value={f}
                currency={d.currency}
                errors={fieldErrors}
                onChange={patch}
                onTier={(tier) => {
                  setTouched(true);
                  setF((x) =>
                    planFormFor(tier, d, {
                      startDate: x?.startDate,
                      billingDay: x?.billingDay,
                      aiOps: x?.aiOps,
                      aiOpsPrice: x?.aiOpsPrice,
                      overageRate: x?.overageRate,
                    }),
                  );
                }}
              />
            </fieldset>
            <fieldset className="form-section">
              <legend>Billing</legend>
              <div className="form-grid">
                <FormField id={`${P}-startDate`} label="Start date" error={errorOf(`${P}-startDate`)}>
                  {(a) => <DateField {...a} value={f.startDate} onChange={(v) => patch({ startDate: v })} />}
                </FormField>
                <FormField
                  id={`${P}-billingDay`}
                  label="Billing day"
                  hint={CARE_COPY.billingDayHint}
                  error={errorOf(`${P}-billingDay`)}
                >
                  {(a) => (
                    <input
                      {...a}
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={2}
                      value={f.billingDay}
                      onChange={(e) => patch({ billingDay: e.target.value })}
                    />
                  )}
                </FormField>
              </div>
            </fieldset>
          </>
        )}
        {client && defaults.state === "loading" && (
          <p className="hint" role="status">
            Loading…
          </p>
        )}

        <div className="actions-row client-new__actions">
          <button type="button" className="btn btn--secondary" onClick={() => navigate(-1)} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || anonymised}
            aria-busy={busy || undefined}
          >
            {busy ? "Adding…" : "Add care plan"}
          </button>
        </div>
      </form>
    </>
  );
}
