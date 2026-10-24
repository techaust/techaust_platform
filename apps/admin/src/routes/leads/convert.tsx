// Convert to client (M3.2, ADM-LEAD-04): the client fields a lead doesn't carry, pre-filled from it, then one request
// that makes the client, its primary contact and a draft proposal together (the API's one batch). The GSTIN gets the
// same live check as Settings > Company. The API's refusals land on the field they are about: `country_mismatch` on the
// country, `gstin_invalid` and `gstin_in_use` on the GSTIN; `already_converted` says so and offers the latest.
// VERIFY WITH CA/LEGAL: GST status and place of supply are confirmed at proposal and invoice time (M4).
import { validateGstin } from "@techaust/core/gstin";
import { type FormEvent, useState } from "react";
import { api, type ConvertInput, errorText, type LeadDetail, RequestError } from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { StatusPill } from "../../components/display.tsx";
import { FormField, VerifyNote } from "../../components/form.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { countryOptions } from "../../lib/leads.ts";

type Form = Required<Omit<ConvertInput, "gstin">> & { gstin: string };

function initial(lead: LeadDetail): Form {
  const country = lead.country ?? "IN";
  return {
    type: lead.company ? "business" : "individual",
    country,
    gstStatus: country === "IN" ? "unregistered" : "overseas",
    gstin: "",
    currency: lead.currency ?? (country === "IN" ? "INR" : "USD"),
    legalName: lead.company ?? lead.name,
    displayName: lead.company ?? lead.name,
  };
}

const GST_STATUS = [
  { value: "registered", label: "Registered" },
  { value: "unregistered", label: "Unregistered" },
  { value: "overseas", label: "Overseas" },
] as const;

type Errors = Partial<Record<"country" | "gstin" | "legalName" | "displayName", string | undefined>>;

export function ConvertDialog(props: {
  open: boolean;
  lead: LeadDetail;
  onClose: () => void;
  onConverted: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState<Form>(() => initial(props.lead));
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [shown, setShown] = useState(false);
  if (props.open !== shown) {
    setShown(props.open);
    if (props.open) {
      setF(initial(props.lead));
      setErrors({});
      setFailure(null);
      setDone(false);
      setChecked(false);
    }
  }

  const set = (patch: Partial<Form>) => {
    setF((x) => ({ ...x, ...patch }));
    setFailure(null);
  };
  const registered = f.gstStatus === "registered";
  const gst = registered && f.gstin.trim() ? validateGstin(f.gstin) : null;
  const liveError = checked && gst && !gst.ok ? `${gst.error}.` : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Errors = {};
    if (!f.legalName.trim()) errs.legalName = "Enter the legal name.";
    if (!f.displayName.trim()) errs.displayName = "Enter the display name.";
    if (registered) {
      const g = validateGstin(f.gstin);
      if (!f.gstin.trim()) errs.gstin = "Enter the GSTIN.";
      else if (!g.ok) errs.gstin = `${g.error}.`;
    }
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) {
      document.getElementById(`cv-${first}`)?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.convertLead(props.lead.id, {
        type: f.type,
        country: f.country,
        gstStatus: f.gstStatus,
        ...(registered ? { gstin: f.gstin.replace(/\s/g, "").toUpperCase() } : {}),
        currency: f.currency,
        legalName: f.legalName.trim(),
        displayName: f.displayName.trim(),
      });
      toast("success", `Converted to client ${r.clientCode}.`);
      props.onConverted();
    } catch (err) {
      if (err instanceof RequestError && err.code === "country_mismatch") {
        setErrors({ country: `${err.message}.` });
        document.getElementById("cv-country")?.focus();
      } else if (
        err instanceof RequestError &&
        (err.code === "gstin_invalid" || err.code === "gstin_in_use")
      ) {
        setErrors({ gstin: `${err.message.replace(/\.$/, "")}.` });
        document.getElementById("cv-gstin")?.focus();
      } else if (err instanceof RequestError && err.code === "already_converted") {
        setDone(true);
        setFailure(`${err.message}.`);
      } else {
        setFailure(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={props.open} title="Convert to client" onClose={props.onClose} busy={busy}>
      {done ? (
        <>
          <div className="dialog__body">
            <Notice tone="info">{failure}</Notice>
          </div>
          <div className="dialog__actions">
            <button type="button" className="btn btn--primary" onClick={props.onConverted}>
              Reload the latest
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="dialog__body convert">
            <p className="hint">
              This makes a client and its primary contact from this lead, and a draft proposal for the service
              it asked for, all at once. The lead keeps its stage and links to both.
            </p>
            {failure && <Notice tone="error">{failure}</Notice>}
            <fieldset className="radios">
              <legend>Client type</legend>
              <div className="segmented">
                {(["business", "individual"] as const).map((t) => (
                  <label key={t} className="segmented__opt">
                    <input
                      type="radio"
                      name="cv-type"
                      value={t}
                      checked={f.type === t}
                      onChange={() => set({ type: t })}
                    />
                    {t === "business" ? "Business" : "Individual"}
                  </label>
                ))}
              </div>
            </fieldset>
            <FormField id="cv-legalName" label="Legal name" error={errors.legalName}>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  maxLength={200}
                  value={f.legalName}
                  onChange={(e) => set({ legalName: e.target.value })}
                />
              )}
            </FormField>
            <FormField id="cv-displayName" label="Display name" error={errors.displayName}>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  maxLength={120}
                  value={f.displayName}
                  onChange={(e) => set({ displayName: e.target.value })}
                />
              )}
            </FormField>
            <FormField id="cv-country" label="Country" error={errors.country}>
              {(a) => (
                <select
                  {...a}
                  value={f.country}
                  onChange={(e) => {
                    const country = e.target.value;
                    // A new country brings its usual GST status and currency; both stay changeable.
                    set({
                      country,
                      gstStatus:
                        country === "IN"
                          ? f.gstStatus === "overseas"
                            ? "unregistered"
                            : f.gstStatus
                          : "overseas",
                      currency: country === "IN" ? "INR" : "USD",
                    });
                    setErrors((x) => ({ ...x, country: undefined }));
                  }}
                >
                  {countryOptions().map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <fieldset className="radios">
              <legend>GST status</legend>
              <div className="segmented">
                {GST_STATUS.map((s) => (
                  <label key={s.value} className="segmented__opt">
                    <input
                      type="radio"
                      name="cv-gst"
                      value={s.value}
                      checked={f.gstStatus === s.value}
                      onChange={() => {
                        set({ gstStatus: s.value });
                        setErrors((x) => ({ ...x, country: undefined, gstin: undefined }));
                      }}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <VerifyNote legal>The GST treatment is confirmed on the proposal and the invoice.</VerifyNote>
            {registered && (
              <FormField
                id="cv-gstin"
                label="GSTIN"
                className="field--gstin"
                hint="15 characters, checked when you finish typing."
                error={errors.gstin ?? liveError}
                status={
                  gst?.ok ? (
                    <>
                      <StatusPill tone="success" icon="check">
                        Valid
                      </StatusPill>
                      <span>
                        Registered in {gst.state} ({gst.stateCode})
                      </span>
                    </>
                  ) : undefined
                }
              >
                {(a) => (
                  <input
                    {...a}
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="characters"
                    maxLength={18}
                    value={f.gstin}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase();
                      set({ gstin: v });
                      setErrors((x) => ({ ...x, gstin: undefined }));
                      setChecked(v.replace(/\s/g, "").length >= 15);
                    }}
                    onBlur={() => setChecked(true)}
                  />
                )}
              </FormField>
            )}
            <fieldset className="radios">
              <legend>Currency</legend>
              <div className="segmented">
                {(["INR", "USD"] as const).map((c) => (
                  <label key={c} className="segmented__opt">
                    <input
                      type="radio"
                      name="cv-currency"
                      value={c}
                      checked={f.currency === c}
                      onChange={() => set({ currency: c })}
                    />
                    {c === "INR" ? "Indian rupee (INR)" : "US dollar (USD)"}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="dialog__actions">
            <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
              {busy ? "Converting…" : "Convert to client"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
