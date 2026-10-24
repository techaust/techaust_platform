// Preview: Settings (ADM-SET-01…10). The overview lists every group with what needs attention; company profile
// (SET-01) and bank details (SET-02) are designed in full; the other eight show their layout pattern with the
// seeded defaults from @techaust/core (VERIFY WITH CA/LEGAL where the PRD says so). Sample data only.
import {
  financialYear,
  formatDocumentNumber,
  formatMoney,
  money,
  SERIES,
  SETTINGS_DEFAULTS,
  type Series,
  STATE_CODES,
  selectableStates,
  validateGstin,
} from "@techaust/core";
import logoColor from "@techaust/ui/brand/logo-primary-color.svg?url";
import logoDark from "@techaust/ui/brand/logo-primary-dark.svg?url";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Link, NavLink, useParams } from "react-router";
import { EmptyState, PageHeader, StatusPill } from "../components/display.tsx";
import { FileDrop } from "../components/file-drop.tsx";
import {
  ErrorSummary,
  FormField,
  NumberUnit,
  SaveBar,
  SettingRow,
  type SummaryError,
  Switch,
  VerifyNote,
} from "../components/form.tsx";
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
  Lock,
  Mail,
  Percent,
  Send,
  Users,
} from "../components/icons.tsx";
import { StepUpPrompt } from "../components/step-up-auth.tsx";
import { useToast } from "../components/toast.tsx";
import { Notice } from "../components/ui.tsx";
import { UnsavedChangesGuard } from "../components/unsaved.tsx";
import { PreviewControls } from "./controls.tsx";
import { BANK, COMPANY, SAMPLE_GSTIN, SAMPLE_GSTIN_BAD_CHECK, SAMPLE_GSTIN_BAD_FORMAT } from "./sample.ts";

const S = "/preview/settings";

type Group = {
  key: string;
  label: string;
  id: string;
  icon: ReactNode;
  desc: string;
  attention?: string;
};

const GROUPS: Group[] = [
  {
    key: "company",
    id: "SET-01",
    label: "Company profile",
    icon: <Building />,
    desc: "Names, GSTIN, address and logos on your documents.",
  },
  {
    key: "bank",
    id: "SET-02",
    label: "Bank details",
    icon: <Landmark />,
    desc: "The INR and USD accounts printed on invoices. Owner only.",
  },
  {
    key: "tax",
    id: "SET-03",
    label: "Tax",
    icon: <Percent />,
    desc: "GST rate, SAC codes, rounding and exports under LUT.",
    attention: "LUT ARN missing",
  },
  {
    key: "numbering",
    id: "SET-04",
    label: "Numbering",
    icon: <Hash />,
    desc: "Number formats and the next number for each document type.",
  },
  {
    key: "payment-terms",
    id: "SET-05",
    label: "Payment terms",
    icon: <Calendar />,
    desc: "Due days, reminders, schedules and the small-job threshold.",
  },
  {
    key: "gateways",
    id: "SET-06",
    label: "Gateways",
    icon: <CreditCard />,
    desc: "Razorpay, Stripe and PayPal: test or live, and whether keys are set.",
    attention: "2 keys missing",
  },
  {
    key: "email",
    id: "SET-07",
    label: "Email",
    icon: <Mail />,
    desc: "Sender addresses, reply-to, copies to you and the footer.",
  },
  {
    key: "terms",
    id: "SET-08",
    label: "Document terms",
    icon: <FileText />,
    desc: "Standard terms, proposal terms and invoice notes, with versions.",
  },
  {
    key: "retention",
    id: "SET-09",
    label: "Data retention",
    icon: <Archive />,
    desc: "How long leads, logs and records are kept.",
  },
  {
    key: "flags",
    id: "SET-10",
    label: "Feature flags",
    icon: <Flag />,
    desc: "Switches for the website and the admin.",
  },
];

export function SettingsIndexPreview() {
  return (
    <>
      <PageHeader
        title="Settings"
        lede="How TecHaust appears on documents, how money and tax work, and who can sign in."
      />
      <div className="settings-index">
        <section aria-labelledby="set-people">
          <h2 id="set-people" className="settings-index__h">
            People
          </h2>
          <ul className="setlist">
            <SetLink
              to="/preview/users"
              icon={<Users />}
              label="Users"
              desc="Who can sign in, their roles and invites."
            />
          </ul>
        </section>
        <section aria-labelledby="set-business">
          <h2 id="set-business" className="settings-index__h">
            Business
          </h2>
          <ul className="setlist">
            {GROUPS.map((g) => (
              <SetLink
                key={g.key}
                to={`${S}/${g.key}`}
                icon={g.icon}
                label={g.label}
                desc={g.desc}
                attention={g.attention}
              />
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function SetLink(props: {
  to: string;
  icon: ReactNode;
  label: string;
  desc: string;
  attention?: string | undefined;
}) {
  return (
    <li>
      <Link to={props.to} className="setlist__link">
        <span className="setlist__icon">{props.icon}</span>
        <span className="setlist__text">
          <span className="setlist__label">{props.label}</span>
          <span className="setlist__desc">{props.desc}</span>
        </span>
        {props.attention && (
          <StatusPill tone="warning" icon="clock">
            {props.attention}
          </StatusPill>
        )}
        <ChevronRight />
      </Link>
    </li>
  );
}

export function SettingsGroupPreview() {
  const { group } = useParams();
  const g = GROUPS.find((x) => x.key === group);
  if (!g)
    return (
      <EmptyState
        title="There's no such settings page"
        action={
          <Link to={S} className="btn btn--secondary">
            All settings
          </Link>
        }
      >
        <p>Pick a group from the settings overview.</p>
      </EmptyState>
    );
  const body: Record<string, ReactNode> = {
    company: <CompanyProfile />,
    bank: <BankDetails />,
    tax: <TaxSettings />,
    numbering: <NumberingSettings />,
    "payment-terms": <PaymentTerms />,
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
          <li>
            <NavLink to="/preview/users" className="settings__link">
              Users
            </NavLink>
          </li>
          {GROUPS.map((x) => (
            <li key={x.key}>
              <NavLink to={`${S}/${x.key}`} className="settings__link">
                {x.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="settings__body">
        <Link to={S} className="back settings__back">
          <ArrowLeft size={16} />
          All settings
        </Link>
        <PageHeader title={g.label} crumbs={[{ label: "Settings", to: S }]} lede={g.desc} />
        {body[g.key]}
      </div>
    </div>
  );
}

function LayoutOnly() {
  return (
    <p className="pv-layout-only">
      Preview of the layout: the controls work on this page, and every field in the PRD arrives with the
      build.
    </p>
  );
}

// ---------------------------------------------------------------- Company profile (SET-01)

type Company = typeof COMPANY;

function CompanyProfile() {
  const toast = useToast();
  const [saved, setSaved] = useState<Company>(COMPANY);
  const [v, setV] = useState<Company>(COMPANY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [gstinChecked, setGstinChecked] = useState(true);
  const [submits, setSubmits] = useState(0);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  const states = selectableStates();

  const gst = v.gstin.trim() ? validateGstin(v.gstin) : null;
  const gstError = gstinChecked && gst && !gst.ok ? `${gst.error}.` : null;
  const lockedState = gst?.ok ? gst.stateCode : null;

  const setField = (k: keyof Company, value: string) => {
    setV((x) => ({ ...x, [k]: value }));
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest);
  };

  function validate(c: Company): Record<string, string> {
    const e: Record<string, string> = {};
    if (!c.tradeName.trim()) e.tradeName = "Enter the trade name.";
    if (!c.legalName.trim()) e.legalName = "Enter the legal name: the proprietor's name.";
    const g = c.gstin.trim() ? validateGstin(c.gstin) : null;
    if (!g) e.gstin = "Enter the GSTIN. It prints on every tax invoice.";
    else if (!g.ok) e.gstin = `${g.error}.`;
    if (!c.address.trim()) e.address = "Enter the principal place of business.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.documentsEmail.trim()))
      e.documentsEmail = "Enter an email address, like accounts@example.com.";
    return e;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = validate(v);
    setErrors(found);
    setGstinChecked(true);
    setSubmits((n) => n + 1);
    if (Object.keys(found).length) return;
    setBusy(true);
    setTimeout(() => {
      const next = { ...v, stateCode: lockedState ?? v.stateCode, gstin: gst?.ok ? gst.gstin : v.gstin };
      setSaved(next);
      setV(next);
      setBusy(false);
      toast("success", "Company profile saved. New documents use it from now on.");
    }, 600);
  }

  const order: [keyof Company | "gstin", string][] = [
    ["tradeName", "company-trade"],
    ["legalName", "company-legal"],
    ["gstin", "company-gstin"],
    ["address", "company-address"],
    ["documentsEmail", "company-email"],
  ];
  const summary: SummaryError[] = order
    .filter(([k]) => errors[k])
    .map(([k, id]) => ({ id, text: errors[k] as string }));

  return (
    <>
      <PreviewControls label="Try a GSTIN">
        {[
          { label: "Valid sample", value: SAMPLE_GSTIN },
          { label: "Wrong format", value: SAMPLE_GSTIN_BAD_FORMAT },
          { label: "Wrong check character", value: SAMPLE_GSTIN_BAD_CHECK },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              setField("gstin", o.value);
              setGstinChecked(true);
            }}
          >
            {o.label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => {
            const broken = { ...v, legalName: "", documentsEmail: "accounts@" };
            setV(broken);
            setErrors(validate(broken));
            setSubmits((n) => n + 1);
          }}
        >
          Submit with errors
        </button>
      </PreviewControls>

      <form id="company-form" className="settings-form" onSubmit={submit} noValidate>
        <ErrorSummary errors={summary} focusKey={submits} />
        <p className="hint">
          All fields are needed unless marked optional. Changes apply to new documents only.
        </p>

        <fieldset className="form-section">
          <legend>Names</legend>
          <div className="form-grid">
            <FormField
              id="company-trade"
              label="Trade name"
              error={errors.tradeName}
              hint="As it appears on documents."
            >
              {(a) => (
                <input
                  {...a}
                  autoComplete="organization"
                  value={v.tradeName}
                  onChange={(e) => setField("tradeName", e.target.value)}
                />
              )}
            </FormField>
            <FormField
              id="company-legal"
              label="Legal name"
              error={errors.legalName}
              hint="The proprietor's name, as registered for GST."
            >
              {(a) => (
                <input
                  {...a}
                  autoComplete="name"
                  value={v.legalName}
                  onChange={(e) => setField("legalName", e.target.value)}
                />
              )}
            </FormField>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>GST registration</legend>
          <div className="form-grid">
            <FormField
              id="company-gstin"
              label="GSTIN"
              className="field--gstin"
              hint="15 characters. Checked as you finish typing. This sample GSTIN is made up for the preview."
              error={errors.gstin ?? gstError}
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
                  value={v.gstin}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setField("gstin", val);
                    setGstinChecked(val.replace(/\s/g, "").length >= 15);
                  }}
                  onBlur={() => setGstinChecked(true)}
                />
              )}
            </FormField>
            <FormField id="company-pan" label="PAN" hint="Taken from the GSTIN (characters 3 to 12).">
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
              id="company-state"
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
                  <select {...a} value={v.stateCode} onChange={(e) => setField("stateCode", e.target.value)}>
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
        </fieldset>

        <fieldset className="form-section">
          <legend>Address and contact on documents</legend>
          <FormField id="company-address" label="Principal place of business" error={errors.address}>
            {(a) => (
              <textarea
                {...a}
                rows={3}
                autoComplete="street-address"
                value={v.address}
                onChange={(e) => setField("address", e.target.value)}
              />
            )}
          </FormField>
          <div className="form-grid">
            <FormField id="company-email" label="Email on documents" error={errors.documentsEmail}>
              {(a) => (
                <input
                  {...a}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={v.documentsEmail}
                  onChange={(e) => setField("documentsEmail", e.target.value)}
                />
              )}
            </FormField>
            <FormField id="company-phone" label="Phone on documents" optional>
              {(a) => (
                <input
                  {...a}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={v.documentsPhone}
                  onChange={(e) => setField("documentsPhone", e.target.value)}
                />
              )}
            </FormField>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Logos and signature</legend>
          <p className="hint">
            The logos come from the brand files. Replace them only with a new version of the brand.
          </p>
          <div className="logo-tiles">
            <LogoTile label="On light paper and screens" src={logoColor} tone="light" />
            <LogoTile label="On dark screens" src={logoDark} tone="dark" />
          </div>
          <FileDrop
            id="company-signature"
            label="Signature image"
            optional
            hint="Printed above “Authorised signatory” on invoices. PNG or SVG with a transparent background, up to 512 KB."
            accept={["image/png", "image/svg+xml"]}
            maxBytes={512 * 1024}
            onFile={() => toast("success", "Preview: uploads are switched off here.")}
          />
        </fieldset>
      </form>

      <SaveBar
        dirty={dirty}
        busy={busy}
        form="company-form"
        onDiscard={() => {
          setV(saved);
          setErrors({});
        }}
      />
      <UnsavedChangesGuard dirty={dirty} what="the company profile" />
    </>
  );
}

function LogoTile({ label, src, tone }: { label: string; src: string; tone: "light" | "dark" }) {
  const toast = useToast();
  const id = useId();
  return (
    <figure className="logo-tile">
      <div className={`logo-tile__art logo-tile__art--${tone}`}>
        <img src={src} alt="" width="180" height="25" />
      </div>
      <figcaption className="logo-tile__cap">
        <span id={id}>{label}</span>
        <button
          type="button"
          className="btn btn--text"
          aria-describedby={id}
          onClick={() => toast("success", "Preview: uploads are switched off here.")}
        >
          Replace
        </button>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- Bank details (SET-02)

function BankDetails() {
  const toast = useToast();
  const [mode, setMode] = useState<"view" | "stepup" | "edit">("view");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acct, setAcct] = useState("");
  const [acct2, setAcct2] = useState("");
  const [ifsc, setIfsc] = useState(BANK.inr.ifsc);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [submits, setSubmits] = useState(0);
  const dirty = mode === "edit" && (acct !== "" || ifsc !== BANK.inr.ifsc);

  function confirm(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      setCodeError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      if (code === "000000") {
        setCode("");
        setCodeError(
          "That code didn't work. It may be the one you signed in with, which can't be used again. Wait for the next code and enter it.",
        );
        return;
      }
      setCode("");
      setCodeError(null);
      setMode("edit");
    }, 500);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (acct && !/^\d{9,18}$/.test(acct)) found.acct = "An account number has 9 to 18 digits.";
    if (acct && acct !== acct2) found.acct2 = "The two account numbers don't match.";
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc))
      found.ifsc = "An IFSC has 11 characters: 4 letters, a zero, then 6 letters or digits.";
    setErrs(found);
    setSubmits((n) => n + 1);
    if (Object.keys(found).length) return;
    setMode("view");
    setAcct("");
    setAcct2("");
    toast("success", "Bank details saved. New invoices print them from now on.");
  }

  const summary = [
    errs.acct && { id: "bank-acct", text: errs.acct },
    errs.acct2 && { id: "bank-acct2", text: errs.acct2 },
    errs.ifsc && { id: "bank-ifsc", text: errs.ifsc },
  ].filter(Boolean) as SummaryError[];

  return (
    <>
      <Notice tone="info">
        Only the owner enters these, here and nowhere else. They print in full on invoices; in the admin,
        account numbers show only their last 4 digits, and the accountant sees them read-only.
      </Notice>

      {mode !== "edit" ? (
        <>
          <div className="bank-blocks">
            <section className="bank" aria-labelledby="bank-inr">
              <h2 id="bank-inr" className="bank__title">
                INR account
              </h2>
              <dl className="facts">
                <Fact k="Account name" v={BANK.inr.accountName} />
                <Fact k="Account number" v={<Masked last4={BANK.inr.last4} />} />
                <Fact k="IFSC" v={BANK.inr.ifsc} />
                <Fact k="Bank" v={BANK.inr.bank} />
                <Fact k="Branch" v={BANK.inr.branch} />
              </dl>
            </section>
            <section className="bank" aria-labelledby="bank-usd">
              <h2 id="bank-usd" className="bank__title">
                USD account (SWIFT)
              </h2>
              <dl className="facts">
                <Fact k="SWIFT / BIC" v={BANK.usd.swift} />
                <Fact k="Account number" v={<Masked last4={BANK.usd.last4} />} />
                <Fact k="Bank address" v={BANK.usd.bankAddress} />
                <Fact k="Intermediary bank" v={BANK.usd.intermediary} />
                <Fact k="Purpose code hint" v={<span className="muted">Not set</span>} />
              </dl>
            </section>
          </div>
          <div className="actions-row">
            <button type="button" className="btn btn--primary" onClick={() => setMode("stepup")}>
              <Lock size={20} />
              Edit bank details
            </button>
          </div>
          <p className="hint hint--below">Editing asks for a fresh code from your authenticator app first.</p>
        </>
      ) : (
        <form id="bank-form" className="settings-form" onSubmit={save} noValidate>
          <ErrorSummary errors={summary} focusKey={submits} />
          <Notice tone="success">
            Unlocked for 10 minutes. Account numbers are never shown again once saved.
          </Notice>
          <fieldset className="form-section">
            <legend>INR account</legend>
            <div className="form-grid">
              <FormField id="bank-name" label="Account name">
                {(a) => <input {...a} defaultValue={BANK.inr.accountName} autoComplete="off" />}
              </FormField>
              <FormField id="bank-ifsc" label="IFSC" error={errs.ifsc}>
                {(a) => (
                  <input
                    {...a}
                    value={ifsc}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={11}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                  />
                )}
              </FormField>
              <FormField
                id="bank-acct"
                label="Account number"
                optional
                hint={`Ends in ${BANK.inr.last4}. Leave it empty to keep it, or type the full new number.`}
                error={errs.acct}
              >
                {(a) => (
                  <input
                    {...a}
                    inputMode="numeric"
                    autoComplete="off"
                    value={acct}
                    onChange={(e) => setAcct(e.target.value.replace(/\D/g, ""))}
                  />
                )}
              </FormField>
              <FormField id="bank-acct2" label="Account number again" optional={!acct} error={errs.acct2}>
                {(a) => (
                  <input
                    {...a}
                    inputMode="numeric"
                    autoComplete="off"
                    value={acct2}
                    onChange={(e) => setAcct2(e.target.value.replace(/\D/g, ""))}
                    onPaste={(e) => e.preventDefault()}
                  />
                )}
              </FormField>
              <FormField id="bank-bank" label="Bank">
                {(a) => <input {...a} defaultValue={BANK.inr.bank} autoComplete="off" />}
              </FormField>
              <FormField id="bank-branch" label="Branch">
                {(a) => <input {...a} defaultValue={BANK.inr.branch} autoComplete="off" />}
              </FormField>
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend>USD account (SWIFT)</legend>
            <div className="form-grid">
              <FormField id="bank-swift" label="SWIFT / BIC">
                {(a) => <input {...a} defaultValue={BANK.usd.swift} autoComplete="off" spellCheck={false} />}
              </FormField>
              <FormField
                id="bank-purpose"
                label="Purpose code hint"
                optional
                hint="The code your bank asks payers to quote. Confirm it with your bank."
              >
                {(a) => <input {...a} autoComplete="off" />}
              </FormField>
            </div>
            <FormField id="bank-address" label="Bank address">
              {(a) => <textarea {...a} rows={2} defaultValue={BANK.usd.bankAddress} />}
            </FormField>
            <FormField id="bank-intermediary" label="Intermediary bank" optional>
              {(a) => <input {...a} defaultValue={BANK.usd.intermediary} autoComplete="off" />}
            </FormField>
          </fieldset>
          <div className="actions-row">
            <button type="submit" className="btn btn--primary">
              Save bank details
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setMode("view");
                setAcct("");
                setAcct2("");
                setErrs({});
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <StepUpPrompt
        open={mode === "stepup"}
        code={code}
        onCode={setCode}
        onSubmit={confirm}
        onCancel={() => {
          setMode("view");
          setCode("");
          setCodeError(null);
        }}
        busy={busy}
        error={codeError}
        intro={
          <p>
            Bank details need a fresh code from your authenticator app. In the preview any 6 digits work, and
            000000 shows the wrong-code message.
          </p>
        }
      />
      <UnsavedChangesGuard dirty={dirty} what="the bank details" />
    </>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Masked({ last4 }: { last4: string }) {
  return (
    <span className="masked">
      <span aria-hidden="true">•••• </span>
      <span className="visually-hidden">ending in </span>
      {last4}
    </span>
  );
}

// ---------------------------------------------------------------- Layout-only groups (SET-03…10)

function useDraft<T>(initial: T) {
  const [saved, setSaved] = useState(initial);
  const [v, setV] = useState(initial);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  return { v, setV, dirty, discard: () => setV(saved), commit: () => setSaved(v) };
}

function GroupForm<T>(props: {
  id: string;
  what: string;
  draft: ReturnType<typeof useDraft<T>>;
  children: ReactNode;
}) {
  const toast = useToast();
  const { draft } = props;
  return (
    <>
      <form
        id={props.id}
        className="settings-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          draft.commit();
          toast(
            "success",
            `${props.what[0]?.toUpperCase()}${props.what.slice(1)} saved. They apply to new documents only.`,
          );
        }}
      >
        {props.children}
      </form>
      <SaveBar dirty={draft.dirty} form={props.id} onDiscard={draft.discard} />
      <UnsavedChangesGuard dirty={draft.dirty} what={props.what} />
    </>
  );
}

function TaxSettings() {
  const d = SETTINGS_DEFAULTS.tax;
  const draft = useDraft({
    rate: String(d.defaultRateBp / 100),
    override: d.allowLineOverride,
    exportMode: d.exportMode as string,
    arn: "",
    eInvoicing: d.eInvoicing,
  });
  const { v, setV } = draft;
  return (
    <GroupForm id="tax-form" what="tax settings" draft={draft}>
      <VerifyNote>
        These are researched defaults, not settled advice. Confirm each one with your CA before the first
        invoice.
      </VerifyNote>
      <LayoutOnly />
      <div className="settings-rows">
        <SettingRow
          id="tax-rate"
          label="Default GST rate"
          labelFor="tax-rate-in"
          description="Used for every new line unless the line sets its own."
        >
          <NumberUnit
            a11y={{ id: "tax-rate-in", "aria-describedby": "tax-rate-desc" }}
            value={v.rate}
            onChange={(rate) => setV({ ...v, rate })}
            unit="%"
          />
        </SettingRow>
        <SettingRow
          id="tax-override"
          label="Rate per line"
          description="Let a line on a document use a different rate."
        >
          <Switch
            id="tax-override-sw"
            labelledBy="tax-override-label"
            describedBy="tax-override-desc"
            checked={v.override}
            onChange={(override) => setV({ ...v, override })}
          />
        </SettingRow>
        <SettingRow
          id="tax-export"
          label="Exports by default"
          labelFor="tax-export-in"
          description="Overseas clients. Under LUT needs a saved ARN for the financial year."
        >
          <select
            id="tax-export-in"
            aria-describedby="tax-export-desc"
            value={v.exportMode}
            onChange={(e) => setV({ ...v, exportMode: e.target.value })}
          >
            <option value="lut">Under LUT (0 % IGST)</option>
            <option value="igst_paid">IGST paid</option>
          </select>
        </SettingRow>
        <SettingRow
          id="tax-arn"
          label="LUT ARN for FY 2026-27"
          labelFor="tax-arn-in"
          description="From the GST portal, after you file the LUT for the year."
        >
          <div className="stack-sm">
            <input
              id="tax-arn-in"
              aria-describedby="tax-arn-desc tax-arn-state"
              value={v.arn}
              onChange={(e) => setV({ ...v, arn: e.target.value })}
              autoComplete="off"
            />
            {!v.arn && (
              <span id="tax-arn-state">
                <StatusPill tone="warning" icon="clock">
                  Missing: exports under LUT are blocked
                </StatusPill>
              </span>
            )}
          </div>
        </SettingRow>
        <SettingRow
          id="tax-round"
          label="Rounding"
          description="Tax per line, rounded half up to the paisa. INR totals to the nearest rupee, with a round-off line. USD totals aren't rounded."
        >
          <span className="muted">Fixed</span>
        </SettingRow>
        <SettingRow
          id="tax-einv"
          label="E-invoicing"
          description="Off unless your turnover reaches the e-invoicing threshold. Ask your CA."
        >
          <Switch
            id="tax-einv-sw"
            labelledBy="tax-einv-label"
            describedBy="tax-einv-desc"
            checked={v.eInvoicing}
            onChange={(eInvoicing) => setV({ ...v, eInvoicing })}
          />
        </SettingRow>
      </div>
    </GroupForm>
  );
}

function NumberingSettings() {
  const fy = financialYear(2026);
  const used: Partial<Record<Series, number>> = { invoice: 43, proposal: 8, estimate: 4 };
  const fmt = SETTINGS_DEFAULTS.numbering;
  return (
    <>
      <LayoutOnly />
      <p className="hint">
        A number has at most 16 characters: capital letters, digits, “/” and “-”. Numbers restart each 1
        April, never go down, and a format is fixed once its first number is used.
      </p>
      <div className="dtable dtable--static">
        <table className="dtable__table">
          <caption className="visually-hidden">Number formats by document type</caption>
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">Next number</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(SERIES) as Series[]).map((s) => {
              const n = used[s];
              return (
                <tr key={s}>
                  <th scope="row">{SERIES[s].label}</th>
                  <td className="docno">{formatDocumentNumber(fmt[s], fy, n ?? 1)}</td>
                  <td>
                    {n ? (
                      <StatusPill tone="info" icon="send">
                        In use, format fixed
                      </StatusPill>
                    ) : (
                      <StatusPill tone="neutral" icon="pencil">
                        Not used yet
                      </StatusPill>
                    )}
                  </td>
                  <td className="dtable__actions">
                    <button
                      type="button"
                      className="btn btn--text"
                      aria-label={`Edit ${SERIES[s].label} numbering`}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PaymentTerms() {
  const d = SETTINGS_DEFAULTS.payment_terms;
  const draft = useDraft({
    due: String(d.dueDays),
    validity: String(d.proposalValidityDays),
    advance: "proforma",
    thresholdInr: formatMoney(money(d.smallJobThreshold.INR, "INR"), { symbol: false, wholeUnits: true }),
    thresholdUsd: formatMoney(money(d.smallJobThreshold.USD, "USD"), { symbol: false, wholeUnits: true }),
  });
  const { v, setV } = draft;
  const offsets = d.reminderOffsetsDays.map((n) =>
    n === 0 ? "On the due date" : n < 0 ? `${-n} days before` : `${n} days after`,
  );
  return (
    <GroupForm id="terms-form" what="payment terms" draft={draft}>
      <LayoutOnly />
      <div className="settings-rows">
        <SettingRow
          id="pt-due"
          label="Payment due"
          labelFor="pt-due-in"
          description="Days after the invoice date. Clients can have their own."
        >
          <NumberUnit
            a11y={{ id: "pt-due-in", "aria-describedby": "pt-due-desc" }}
            value={v.due}
            onChange={(due) => setV({ ...v, due })}
            unit="days"
          />
        </SettingRow>
        <SettingRow id="pt-valid" label="Proposals and estimates valid for" labelFor="pt-valid-in">
          <NumberUnit
            a11y={{ id: "pt-valid-in" }}
            value={v.validity}
            onChange={(validity) => setV({ ...v, validity })}
            unit="days"
          />
        </SettingRow>
        <SettingRow
          id="pt-small"
          label="Small-job threshold"
          description="Jobs priced under this are paid 100 % upfront, whatever the client's currency."
        >
          <div className="money-pair">
            <div className="money-in">
              <span aria-hidden="true">₹</span>
              <input
                aria-label="Small-job threshold in rupees"
                inputMode="decimal"
                value={v.thresholdInr}
                onChange={(e) => setV({ ...v, thresholdInr: e.target.value })}
              />
            </div>
            <div className="money-in">
              <span aria-hidden="true">$</span>
              <input
                aria-label="Small-job threshold in US dollars"
                inputMode="decimal"
                value={v.thresholdUsd}
                onChange={(e) => setV({ ...v, thresholdUsd: e.target.value })}
              />
            </div>
          </div>
        </SettingRow>
        <SettingRow
          id="pt-adv"
          label="Advance payments"
          labelFor="pt-adv-in"
          description="Can be changed per client and per document."
        >
          <select
            id="pt-adv-in"
            aria-describedby="pt-adv-desc"
            value={v.advance}
            onChange={(e) => setV({ ...v, advance: e.target.value })}
          >
            <option value="proforma">Proforma, then a tax invoice on payment</option>
            <option value="invoice_upfront">Tax invoice upfront</option>
            <option value="receipt_voucher">Receipt voucher</option>
          </select>
        </SettingRow>
        <SettingRow id="pt-rem" label="Reminders" description="Sent between 09:00 and 19:00 IST.">
          <ul className="tag-list" aria-labelledby="pt-rem-label">
            {offsets.map((o) => (
              <li key={o} className="pill">
                {o}
              </li>
            ))}
          </ul>
        </SettingRow>
        <SettingRow
          id="pt-sched"
          label="Build schedule"
          description="Instalments for build projects. They always add up to 100 %."
        >
          <ul className="tag-list" aria-labelledby="pt-sched-label">
            {d.buildSchedule.map((s) => (
              <li key={s.label} className="pill">
                {s.pctBp / 100} % {s.label.toLowerCase()}
              </li>
            ))}
          </ul>
        </SettingRow>
      </div>
    </GroupForm>
  );
}

function Gateways() {
  const rows = [
    { name: "Razorpay", for: "INR: UPI, cards, netbanking", keys: true },
    { name: "Stripe", for: "USD: cards", keys: false },
    { name: "PayPal", for: "USD: PayPal balance and cards", keys: false },
  ];
  return (
    <>
      <LayoutOnly />
      <Notice tone="info">
        Keys are never typed here. They're stored as Cloudflare secrets; this page only shows whether each one
        is set. Live mode opens after your go-live approval.
      </Notice>
      <ul className="gateways">
        {rows.map((g) => (
          <li key={g.name} className="gateway">
            <div className="gateway__head">
              <h2 className="gateway__name">{g.name}</h2>
              <p className="gateway__for">{g.for}</p>
            </div>
            <fieldset className="segmented">
              <legend className="visually-hidden">{g.name} mode</legend>
              <label className="segmented__opt">
                <input type="radio" name={`gw-${g.name}`} defaultChecked />
                Test
              </label>
              <label className="segmented__opt" aria-describedby={`gw-${g.name}-live`}>
                <input type="radio" name={`gw-${g.name}`} disabled />
                Live
              </label>
            </fieldset>
            <p className="gateway__live hint" id={`gw-${g.name}-live`}>
              Live is locked until go-live.
            </p>
            <div className="gateway__keys">
              <span className="muted">Keys</span>
              {g.keys ? (
                <StatusPill tone="success" icon="check">
                  Configured
                </StatusPill>
              ) : (
                <StatusPill tone="warning" icon="clock">
                  Missing
                </StatusPill>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function EmailSettings() {
  const toast = useToast();
  const draft = useDraft({
    replyTo: "contact@techaust.com",
    bcc: { Invoices: true, Proposals: true, Receipts: false, Reminders: false } as Record<string, boolean>,
  });
  const { v, setV } = draft;
  return (
    <GroupForm id="email-form" what="email settings" draft={draft}>
      <LayoutOnly />
      <div className="settings-rows">
        <SettingRow
          id="em-senders"
          label="Sender addresses"
          description="Verified with Amazon SES. Changing them needs the owner."
        >
          <ul className="plain-list">
            <li>hello@techaust.com</li>
            <li>billing@techaust.com</li>
            <li>no-reply@techaust.com</li>
          </ul>
        </SettingRow>
        <SettingRow
          id="em-reply"
          label="Reply-to"
          labelFor="em-reply-in"
          description="Where replies to any email go."
        >
          <input
            id="em-reply-in"
            type="email"
            aria-describedby="em-reply-desc"
            value={v.replyTo}
            onChange={(e) => setV({ ...v, replyTo: e.target.value })}
          />
        </SettingRow>
      </div>
      <h2 className="settings-sub">A copy to you</h2>
      <div className="settings-rows">
        {Object.keys(v.bcc).map((t) => (
          <SettingRow key={t} id={`em-bcc-${t}`} label={t}>
            <div className="row-controls">
              <Switch
                id={`em-bcc-${t}-sw`}
                labelledBy={`em-bcc-${t}-label`}
                checked={!!v.bcc[t]}
                onChange={(on) => setV({ ...v, bcc: { ...v.bcc, [t]: on } })}
              />
              <button
                type="button"
                className="btn btn--text"
                onClick={() => toast("success", `Preview: a test “${t}” email would go to you only.`)}
              >
                <Send size={16} />
                Send a test to me
                <span className="visually-hidden"> ({t})</span>
              </button>
            </div>
          </SettingRow>
        ))}
      </div>
    </GroupForm>
  );
}

function DocumentTerms() {
  const blocks = [
    { name: "Standard terms", version: 3, used: 12, changed: "14 Oct 2026, by Meera Iyer" },
    { name: "Proposal terms", version: 1, used: 3, changed: "2 Oct 2026, by Meera Iyer" },
    { name: "Invoice footer notes", version: 2, used: 9, changed: "9 Oct 2026, by Meera Iyer" },
    { name: "Export declaration", version: 1, used: 0, changed: "2 Oct 2026, by Meera Iyer" },
  ];
  return (
    <>
      <LayoutOnly />
      <p className="hint">
        Each document keeps the version it was made with. Editing a block makes a new version; earlier
        documents don't change.
      </p>
      <ul className="versioned-list">
        {blocks.map((b, i) => (
          <li key={b.name} className="versioned">
            <div className="versioned__head">
              <h2 className="versioned__name">{b.name}</h2>
              <p className="versioned__meta">
                Version {b.version}, used by{" "}
                {b.used === 0 ? "no documents yet" : b.used === 1 ? "1 document" : `${b.used} documents`}.
                Last changed {b.changed}.
              </p>
            </div>
            {i === 0 && (
              <div className="versioned__text">
                <p className="placeholder">
                  [Placeholder: the standard terms the owner and the CA approve go here.]
                </p>
              </div>
            )}
            <div className="versioned__actions">
              <button type="button" className="btn btn--secondary">
                <span>
                  Edit<span className="visually-hidden"> {b.name.toLowerCase()}</span>
                </span>
              </button>
              <span className="hint">Saving makes version {b.version + 1}.</span>
              <button type="button" className="btn btn--text">
                Earlier versions<span className="visually-hidden"> of {b.name.toLowerCase()}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Retention() {
  const d = SETTINGS_DEFAULTS.retention;
  const draft = useDraft({
    leads: String(d.leadsMonths),
    email: String(d.emailLogMonths),
    security: String(d.securityLogMonths),
    fin: String(d.financialYears),
  });
  const { v, setV } = draft;
  const lowLeads = Number(v.leads) < 12;
  return (
    <GroupForm id="retention-form" what="data retention" draft={draft}>
      <VerifyNote legal>
        Minimums follow the DPDP Rules, CERT-In and the GST Act as researched. Confirm them with your CA and a
        lawyer.
      </VerifyNote>
      <LayoutOnly />
      <div className="settings-rows">
        <SettingRow
          id="rt-leads"
          label="Unconverted leads"
          labelFor="rt-leads-in"
          description="Deleted this long after their last activity. Never below 12 months."
        >
          <FormFieldInline id="rt-leads-in" error={lowLeads ? "At least 12 months (DPDP Rule 8(3))." : null}>
            <NumberUnit
              a11y={{
                id: "rt-leads-in",
                "aria-describedby": `rt-leads-desc${lowLeads ? " rt-leads-in-error" : ""}`,
                ...(lowLeads ? { "aria-invalid": true } : {}),
              }}
              value={v.leads}
              onChange={(leads) => setV({ ...v, leads })}
              unit="months"
            />
          </FormFieldInline>
        </SettingRow>
        <SettingRow id="rt-email" label="Email logs" labelFor="rt-email-in">
          <NumberUnit
            a11y={{ id: "rt-email-in" }}
            value={v.email}
            onChange={(email) => setV({ ...v, email })}
            unit="months"
          />
        </SettingRow>
        <SettingRow
          id="rt-sec"
          label="Security and access logs"
          labelFor="rt-sec-in"
          description="Never below 13 months."
        >
          <NumberUnit
            a11y={{ id: "rt-sec-in", "aria-describedby": "rt-sec-desc" }}
            value={v.security}
            onChange={(security) => setV({ ...v, security })}
            unit="months"
          />
        </SettingRow>
        <SettingRow
          id="rt-fin"
          label="Audit log and financial records"
          labelFor="rt-fin-in"
          description="Never below 8 years from the end of the financial year. Financial records are never deleted, only archived."
        >
          <NumberUnit
            a11y={{ id: "rt-fin-in", "aria-describedby": "rt-fin-desc" }}
            value={v.fin}
            onChange={(fin) => setV({ ...v, fin })}
            unit="years"
          />
        </SettingRow>
      </div>
      <p className="hint">
        A legal hold on a client or contact stops all deletion for them. Before the first deletion run, you
        see a dry-run report of what would go.
      </p>
    </GroupForm>
  );
}

function FormFieldInline({ id, error, children }: { id: string; error: string | null; children: ReactNode }) {
  return (
    <div className="stack-sm">
      {children}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

function FeatureFlags() {
  const draft = useDraft({
    s3: SETTINGS_DEFAULTS.flags.dpdpReadinessPage,
    blog: true,
    digest: SETTINGS_DEFAULTS.flags.weeklyDigest,
    cal: "",
    whatsapp: "",
    ga: "",
  });
  const { v, setV } = draft;
  return (
    <GroupForm id="flags-form" what="feature flags" draft={draft}>
      <LayoutOnly />
      <h2 className="settings-sub">Website</h2>
      <p className="hint">Website switches reach the site the next time it's published.</p>
      <div className="settings-rows">
        <SettingRow
          id="ff-s3"
          label="DPDP readiness page"
          description="Stays off until a legal partner is in place."
        >
          <Switch
            id="ff-s3-sw"
            labelledBy="ff-s3-label"
            describedBy="ff-s3-desc"
            checked={v.s3}
            onChange={(s3) => setV({ ...v, s3 })}
          />
        </SettingRow>
        <SettingRow id="ff-blog" label="Blog">
          <Switch
            id="ff-blog-sw"
            labelledBy="ff-blog-label"
            checked={v.blog}
            onChange={(blog) => setV({ ...v, blog })}
          />
        </SettingRow>
        <SettingRow
          id="ff-cal"
          label="Cal.com booking link"
          labelFor="ff-cal-in"
          description="Empty hides the booking button."
        >
          <input
            id="ff-cal-in"
            type="url"
            aria-describedby="ff-cal-desc"
            value={v.cal}
            onChange={(e) => setV({ ...v, cal: e.target.value })}
          />
        </SettingRow>
        <SettingRow
          id="ff-wa"
          label="WhatsApp number"
          labelFor="ff-wa-in"
          description="Empty hides the WhatsApp link."
        >
          <input
            id="ff-wa-in"
            type="tel"
            aria-describedby="ff-wa-desc"
            value={v.whatsapp}
            onChange={(e) => setV({ ...v, whatsapp: e.target.value })}
          />
        </SettingRow>
        <SettingRow
          id="ff-ga"
          label="Google Analytics measurement ID"
          labelFor="ff-ga-in"
          description="Empty: no analytics, and the privacy policy leaves out the analytics lines."
        >
          <input
            id="ff-ga-in"
            aria-describedby="ff-ga-desc"
            value={v.ga}
            onChange={(e) => setV({ ...v, ga: e.target.value })}
            spellCheck={false}
          />
        </SettingRow>
      </div>
      <h2 className="settings-sub">Admin</h2>
      <div className="settings-rows">
        <SettingRow
          id="ff-digest"
          label="Weekly digest email"
          description="A summary of the week, emailed to the owner."
        >
          <Switch
            id="ff-digest-sw"
            labelledBy="ff-digest-label"
            describedBy="ff-digest-desc"
            checked={v.digest}
            onChange={(digest) => setV({ ...v, digest })}
          />
        </SettingRow>
      </div>
    </GroupForm>
  );
}
