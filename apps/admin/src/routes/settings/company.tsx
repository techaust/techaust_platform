// Company profile (ADM-SET-01): names, the GSTIN with its live check and the PAN taken from it, the state (fixed by a
// valid GSTIN), the address and contact printed on documents, and the two logos, picked from the generated brand files
// (lead decision L7 of M4.4: never uploaded). After the form, the signature image (M4.4), which is uploaded and saves on its own.
// Changes apply to new documents only (GST fields: Researched 2026-10-28, Rule 46 CGST, 08-C RA-05).
// T10 (rt2): the Udyam registration number and enterprise category (07-ZC lines 4 and 5), beside the GST registration because both print on the tax invoice
// under the supplier's name; the form always sends `udyam` (the block, or null for none: L8), so a later save never keeps a number that was cleared here.
import { STATE_CODES, type StateCode, selectableStates, validateGstin } from "@techaust/core";
import type { UdyamCategory } from "@techaust/core/invoices";
import { BRAND_LOGOS, type Settings } from "@techaust/core/settings";
import primaryBlack from "@techaust/ui/brand/logo-primary-black.svg?url";
import primaryColor from "@techaust/ui/brand/logo-primary-color.svg?url";
import primaryDark from "@techaust/ui/brand/logo-primary-dark.svg?url";
import primaryInk from "@techaust/ui/brand/logo-primary-ink.svg?url";
import primaryWhite from "@techaust/ui/brand/logo-primary-white.svg?url";
import stackedBlack from "@techaust/ui/brand/logo-stacked-black.svg?url";
import stackedColor from "@techaust/ui/brand/logo-stacked-color.svg?url";
import stackedDark from "@techaust/ui/brand/logo-stacked-dark.svg?url";
import stackedInk from "@techaust/ui/brand/logo-stacked-ink.svg?url";
import stackedWhite from "@techaust/ui/brand/logo-stacked-white.svg?url";
import { useState } from "react";
import { StatusPill } from "../../components/display.tsx";
import { FormField } from "../../components/form.tsx";
import { type FieldErrors, fieldId, looksLikeEmail, orNull } from "../../lib/settings-form.ts";
import { normaliseUdyam, UDYAM_FORM_COPY, UDYAM_OPTIONS, udyamCategoryOf, udyamOf } from "../../lib/udyam.ts";
import { type Built, GroupForm, type GroupSpec } from "./kit.tsx";
import { SignatureControl } from "./signature.tsx";

type Logo = (typeof BRAND_LOGOS)[number];

/** The generated brand files a document may use, with what each one is. */
const LOGOS: Record<Logo, { url: string; label: string; ground: "light" | "dark" }> = {
  "logo-primary-color.svg": { url: primaryColor, label: "Primary, colour", ground: "light" },
  "logo-primary-ink.svg": { url: primaryInk, label: "Primary, ink", ground: "light" },
  "logo-primary-black.svg": { url: primaryBlack, label: "Primary, black", ground: "light" },
  "logo-primary-dark.svg": { url: primaryDark, label: "Primary, for dark grounds", ground: "dark" },
  "logo-primary-white.svg": { url: primaryWhite, label: "Primary, white", ground: "dark" },
  "logo-stacked-color.svg": { url: stackedColor, label: "Stacked, colour", ground: "light" },
  "logo-stacked-ink.svg": { url: stackedInk, label: "Stacked, ink", ground: "light" },
  "logo-stacked-black.svg": { url: stackedBlack, label: "Stacked, black", ground: "light" },
  "logo-stacked-dark.svg": { url: stackedDark, label: "Stacked, for dark grounds", ground: "dark" },
  "logo-stacked-white.svg": { url: stackedWhite, label: "Stacked, white", ground: "dark" },
};

type Form = {
  tradeName: string;
  legalName: string;
  gstin: string;
  stateCode: StateCode;
  address: string;
  principalPlace: string;
  documentsEmail: string;
  documentsPhone: string;
  logoLight: Logo;
  logoDark: Logo;
  udyamNumber: string;
  udyamCategory: UdyamCategory;
};

const ID = {
  tradeName: fieldId("tradeName"),
  legalName: fieldId("legalName"),
  gstin: fieldId("gstin"),
  pan: "f-pan",
  stateCode: fieldId("stateCode"),
  address: fieldId("address"),
  principalPlace: fieldId("principalPlace"),
  documentsEmail: fieldId("documentsEmail"),
  documentsPhone: fieldId("documentsPhone"),
  logoLight: fieldId("logoLight"),
  logoDark: fieldId("logoDark"),
  // the schema's paths (`udyam.number`, `udyam.category`), so a refusal from the API lands on its field
  udyamNumber: fieldId("udyam.number"),
  udyamCategory: fieldId("udyam.category"),
};

const spec: GroupSpec<"company", Form> = {
  group: "company",
  what: "the company profile",
  forDocuments: true,
  savedText: "Company profile saved. New documents use it from now on.",
  toForm: (v) => ({
    tradeName: v.tradeName,
    legalName: v.legalName ?? "",
    gstin: v.gstin ?? "",
    stateCode: v.stateCode,
    address: v.address ?? "",
    principalPlace: v.principalPlace ?? "",
    documentsEmail: v.documentsEmail ?? "",
    documentsPhone: v.documentsPhone ?? "",
    logoLight: v.logoLight,
    logoDark: v.logoDark,
    udyamNumber: v.udyam?.number ?? "",
    udyamCategory: udyamCategoryOf(v.udyam),
  }),
  build: (f): Built<"company"> => {
    const e: FieldErrors = {};
    if (!f.tradeName.trim()) e[ID.tradeName] = "Enter the trade name.";
    if (!f.legalName.trim()) e[ID.legalName] = "Enter the legal name: the proprietor's name.";
    const g = f.gstin.trim() ? validateGstin(f.gstin) : null;
    if (!g) e[ID.gstin] = "Enter the GSTIN. It prints on every tax invoice.";
    else if (!g.ok) e[ID.gstin] = `${g.error}.`;
    if (!f.address.trim()) e[ID.address] = "Enter the address printed on documents.";
    if (!looksLikeEmail(f.documentsEmail))
      e[ID.documentsEmail] = "Enter an email address, like accounts@example.com.";
    const udyam = udyamOf(f.udyamNumber, f.udyamCategory);
    if (!udyam.ok) e[ID.udyamNumber] = udyam.error;
    if (Object.keys(e).length || !g?.ok || !udyam.ok) return { errors: e };
    const value: Settings["company"] = {
      tradeName: f.tradeName.trim(),
      legalName: f.legalName.trim(),
      gstin: g.gstin,
      stateCode: g.stateCode as StateCode,
      address: f.address.trim(),
      principalPlace: orNull(f.principalPlace),
      documentsEmail: f.documentsEmail.trim(),
      documentsPhone: orNull(f.documentsPhone),
      logoLight: f.logoLight,
      logoDark: f.logoDark,
      udyam: udyam.value,
    };
    return { value };
  },
  // Without a number the category isn't saved (`udyamOf` gives null), so changing it alone is no change (rt2 second review 4).
  dirtyOf: (f) => (normaliseUdyam(f.udyamNumber) === "" ? { ...f, udyamCategory: null } : f),
};

export function CompanyProfile() {
  return (
    <GroupForm
      spec={spec}
      readOnly={false}
      after={({ doc, adopt }) => <SignatureControl initial={doc.value.signature ?? null} adopt={adopt} />}
    >
      {({ form: f, set, error }) => <Fields f={f} set={set} error={error} />}
    </GroupForm>
  );
}

function Fields({
  f,
  set,
  error,
}: {
  f: Form;
  set: (p: Partial<Form>) => void;
  error: (id: string) => string | undefined;
}) {
  // The GSTIN is checked once it is complete or the field is left, never while the first characters go in.
  const [checked, setChecked] = useState(f.gstin.trim() !== "");
  const gst = f.gstin.trim() ? validateGstin(f.gstin) : null;
  const liveError = checked && gst && !gst.ok ? `${gst.error}.` : null;
  const lockedState = gst?.ok ? (gst.stateCode as StateCode) : null;
  const states = selectableStates();
  // The Udyam number, like the GSTIN, is checked once the field is left (or the save is tried), never while it is typed.
  const [udyamLeft, setUdyamLeft] = useState(false);
  const udyamCheck = udyamOf(f.udyamNumber, f.udyamCategory);
  const udyamLive = udyamLeft && !udyamCheck.ok ? udyamCheck.error : null;
  const hasUdyam = normaliseUdyam(f.udyamNumber) !== "";

  return (
    <>
      <fieldset className="form-section">
        <legend>Names</legend>
        <div className="form-grid">
          <FormField
            id={ID.tradeName}
            label="Trade name"
            hint="As it appears on documents."
            error={error(ID.tradeName)}
          >
            {(a) => (
              <input
                {...a}
                autoComplete="organization"
                value={f.tradeName}
                onChange={(e) => set({ tradeName: e.target.value })}
              />
            )}
          </FormField>
          <FormField
            id={ID.legalName}
            label="Legal name"
            hint="The proprietor's name, as registered for GST."
            error={error(ID.legalName)}
          >
            {(a) => (
              <input
                {...a}
                autoComplete="name"
                value={f.legalName}
                onChange={(e) => set({ legalName: e.target.value })}
              />
            )}
          </FormField>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>GST registration</legend>
        <div className="form-grid">
          <FormField
            id={ID.gstin}
            label="GSTIN"
            className="field--gstin"
            hint="15 characters, checked when you finish typing."
            error={error(ID.gstin) ?? liveError}
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
                  // Kept as typed, so the caret stays where it is (rt2 second review 2); the field shows capitals (`.field--gstin`), the check
                  // reads any case, and leaving the field stores the capitals.
                  const v = e.target.value;
                  set({ gstin: v });
                  setChecked(v.replace(/\s/g, "").length >= 15);
                }}
                onBlur={() => {
                  const n = f.gstin.toUpperCase();
                  if (n !== f.gstin) set({ gstin: n });
                  setChecked(true);
                }}
              />
            )}
          </FormField>
          <FormField id={ID.pan} label="PAN" hint="Taken from the GSTIN (characters 3 to 12).">
            {(a) => (
              <input
                {...a}
                readOnly
                value={gst?.ok ? gst.pan : ""}
                placeholder="Appears with a valid GSTIN"
              />
            )}
          </FormField>
          <FormField
            id={ID.stateCode}
            label="State and code"
            hint={
              lockedState
                ? "Set by the GSTIN's first two digits."
                : "Pick the state of your principal place of business."
            }
          >
            {(a) =>
              lockedState ? (
                <input {...a} readOnly value={`${STATE_CODES[lockedState].name} (${lockedState})`} />
              ) : (
                <select
                  {...a}
                  value={f.stateCode}
                  onChange={(e) => set({ stateCode: e.target.value as StateCode })}
                >
                  {states.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              )
            }
          </FormField>
        </div>
        <div className="form-grid form-grid--udyam">
          <FormField
            id={ID.udyamNumber}
            label={UDYAM_FORM_COPY.label}
            className="field--gstin"
            optional
            hint={UDYAM_FORM_COPY.hint}
            error={error(ID.udyamNumber) ?? udyamLive}
          >
            {(a) => (
              <input
                {...a}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
                maxLength={30}
                value={f.udyamNumber}
                onChange={(e) => {
                  // As typed (the caret stays put, rt2 second review 2): shown in capitals by `.field--gstin`, stored in capitals on leaving.
                  set({ udyamNumber: e.target.value });
                  if (udyamLeft && e.target.value.trim() === "") setUdyamLeft(false);
                }}
                onBlur={() => {
                  const n = normaliseUdyam(f.udyamNumber);
                  if (n !== f.udyamNumber) set({ udyamNumber: n });
                  setUdyamLeft(n !== "");
                }}
              />
            )}
          </FormField>
          <FormField id={ID.udyamCategory} label={UDYAM_FORM_COPY.categoryLabel}>
            {(a) => (
              <select
                {...a}
                // A category belongs to a number: with none there is nothing to print it beside (rt2 second review 4).
                disabled={!hasUdyam}
                value={f.udyamCategory}
                onChange={(e) => set({ udyamCategory: e.target.value as UdyamCategory })}
              >
                {UDYAM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Address and contact on documents</legend>
        <FormField id={ID.address} label="Address on documents" error={error(ID.address)}>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              autoComplete="street-address"
              value={f.address}
              onChange={(e) => set({ address: e.target.value })}
            />
          )}
        </FormField>
        <FormField
          id={ID.principalPlace}
          label="Principal place of business"
          optional
          hint="As on your GST registration, if it differs from the address above."
          error={error(ID.principalPlace)}
        >
          {(a) => (
            <textarea
              {...a}
              rows={2}
              value={f.principalPlace}
              onChange={(e) => set({ principalPlace: e.target.value })}
            />
          )}
        </FormField>
        <div className="form-grid">
          <FormField id={ID.documentsEmail} label="Email on documents" error={error(ID.documentsEmail)}>
            {(a) => (
              <input
                {...a}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={f.documentsEmail}
                onChange={(e) => set({ documentsEmail: e.target.value })}
              />
            )}
          </FormField>
          <FormField
            id={ID.documentsPhone}
            label="Phone on documents"
            optional
            error={error(ID.documentsPhone)}
          >
            {(a) => (
              <input
                {...a}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={f.documentsPhone}
                onChange={(e) => set({ documentsPhone: e.target.value })}
              />
            )}
          </FormField>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Logos</legend>
        <p className="hint">Picked from the brand files, so documents always carry the real logo.</p>
        <div className="logo-tiles">
          <LogoPick
            id={ID.logoLight}
            label="On light paper and screens"
            value={f.logoLight}
            ground="light"
            onChange={(logoLight) => set({ logoLight })}
          />
          <LogoPick
            id={ID.logoDark}
            label="On dark screens"
            value={f.logoDark}
            ground="dark"
            onChange={(logoDark) => set({ logoDark })}
          />
        </div>
      </fieldset>
    </>
  );
}

function LogoPick(props: {
  id: string;
  label: string;
  value: Logo;
  ground: "light" | "dark";
  onChange: (l: Logo) => void;
}) {
  const logo = LOGOS[props.value];
  const options = BRAND_LOGOS.filter((l) => LOGOS[l].ground === props.ground || l === props.value);
  return (
    <figure className="logo-tile">
      <div className={`logo-tile__art logo-tile__art--${logo.ground}`}>
        <img src={logo.url} alt="" className="logo-tile__img" />
      </div>
      <figcaption className="logo-tile__cap logo-tile__cap--pick">
        <label htmlFor={props.id}>{props.label}</label>
        <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value as Logo)}>
          {options.map((l) => (
            <option key={l} value={l}>
              {LOGOS[l].label}
            </option>
          ))}
        </select>
      </figcaption>
    </figure>
  );
}
