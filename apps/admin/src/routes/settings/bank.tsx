// Bank details (ADM-SET-02): the INR block and the USD/SWIFT block, account numbers masked to their last four
// characters in every view (the API never sends more). "Edit bank details" asks for a fresh authenticator code first
// (bank.manage is a step-up action); only then do the fields unlock. The account number field starts empty: leaving it
// empty keeps the stored number. The accountant reads the masked blocks only.
import { ACCOUNT_NO, IFSC, SWIFT } from "@techaust/core/bank";
import { type FormEvent, type ReactNode, useState } from "react";
import {
  api,
  type BankAccount,
  type BankInput,
  type BankKind,
  ensureStepUp,
  errorText,
  RequestError,
} from "../../api.ts";
import { When } from "../../components/display.tsx";
import { ErrorSummary, FormField, type SummaryError } from "../../components/form.tsx";
import { Landmark, Lock } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import { sentence } from "../../lib/format.ts";
import { orNull } from "../../lib/settings-form.ts";
import { FormSkeleton, StaleNotice } from "./kit.tsx";

type BlockForm = {
  accountName: string;
  accountNo: string;
  accountNoAgain: string;
  ifsc: string;
  swift: string;
  bankName: string;
  branch: string;
  bankAddress: string;
  intermediary: string;
};
type Forms = Record<BankKind, BlockForm>;

const KINDS: BankKind[] = ["INR", "USD_SWIFT"];
const TITLE: Record<BankKind, string> = { INR: "INR account", USD_SWIFT: "USD account (SWIFT)" };

const fid = (kind: BankKind, field: string) => `bank-${kind}-${field}`;
const clean = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

const toForm = (a: BankAccount): BlockForm => ({
  accountName: a.accountName ?? "",
  accountNo: "",
  accountNoAgain: "",
  ifsc: a.ifsc ?? "",
  swift: a.swift ?? "",
  bankName: a.bankName ?? "",
  branch: a.branch ?? "",
  bankAddress: a.bankAddress ?? "",
  intermediary: a.intermediary ?? "",
});

/** Has anything been typed into a block that has no account yet? (An untouched new block is skipped.) */
const touched = (f: BlockForm) => Object.values(f).some((v) => v.trim() !== "");

/** The same checks as the API, worded for the form. Returns the errors (by field id) and the request body. */
export function checkBlock(kind: BankKind, f: BlockForm, exists: boolean) {
  const e: Record<string, string> = {};
  const no = clean(f.accountNo);
  const again = clean(f.accountNoAgain);
  if (!f.accountName.trim()) e[fid(kind, "accountName")] = "Enter the account name.";
  if (!exists && !no) e[fid(kind, "accountNo")] = "Enter the account number.";
  else if (no && !ACCOUNT_NO.test(no))
    e[fid(kind, "accountNo")] = "Use letters and digits only, 5 to 34 characters.";
  if (no && no !== again) e[fid(kind, "accountNoAgain")] = "The two account numbers don't match.";
  if (kind === "INR" && !IFSC.test(clean(f.ifsc)))
    e[fid(kind, "ifsc")] = "An IFSC has 11 characters: 4 letters, a zero, then 6 letters or digits.";
  if (kind === "USD_SWIFT" && !SWIFT.test(clean(f.swift)))
    e[fid(kind, "swift")] = "A SWIFT/BIC has 8 or 11 letters and digits.";
  if (!f.bankName.trim()) e[fid(kind, "bankName")] = "Enter the bank's name.";
  if (kind === "USD_SWIFT" && !f.bankAddress.trim())
    e[fid(kind, "bankAddress")] = "Enter the bank's address.";
  const body: BankInput = {
    accountName: f.accountName.trim(),
    bankName: f.bankName.trim(),
    branch: orNull(f.branch),
    bankAddress: orNull(f.bankAddress),
    intermediary: orNull(f.intermediary),
    ...(kind === "INR" ? { ifsc: clean(f.ifsc) } : { swift: clean(f.swift) }),
    ...(no ? { accountNo: no, accountNoAgain: again } : {}),
  };
  return { errors: e, body };
}

export function BankDetails({ readOnly }: { readOnly: boolean }) {
  const loaded = useLoad(() => api.bank(), "");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [asking, setAsking] = useState(false);
  const toast = useToast();

  if (loaded.state === "loading") return <FormSkeleton />;
  if (loaded.state === "failed") return <LoadFailed error={loaded.error} onRetry={() => loaded.reload()} />;
  const accounts = loaded.data.accounts;

  async function unlock() {
    setAsking(true);
    const ok = await ensureStepUp();
    setAsking(false);
    if (ok) setMode("edit");
  }

  return (
    <>
      <Notice tone="info">
        Only the owner enters these, here and nowhere else. They print in full on invoices; in the admin,
        account numbers show only their last 4 characters
        {readOnly ? "." : ", and the accountant sees them read-only."}
      </Notice>
      {mode === "view" ? (
        <>
          <div className="bank-blocks">
            {KINDS.map((k) => (
              <BankBlock key={k} account={accounts.find((a) => a.kind === k)} kind={k} />
            ))}
          </div>
          {!readOnly && (
            <>
              <div className="actions-row">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={unlock}
                  disabled={asking}
                  aria-busy={asking || undefined}
                >
                  <Lock size={20} />
                  {accounts.some((a) => a.exists) ? "Edit bank details" : "Enter bank details"}
                </button>
              </div>
              <p className="hint hint--below">
                Editing asks for a fresh code from your authenticator app first.
              </p>
            </>
          )}
        </>
      ) : (
        <BankForm
          accounts={accounts}
          onCancel={() => setMode("view")}
          onSaved={(changed) => {
            setMode("view");
            toast(
              "success",
              changed ? "Bank details saved. New invoices print them from now on." : "No change.",
            );
            loaded.reload(true);
          }}
          onReload={() => {
            setMode("view");
            loaded.reload();
          }}
        />
      )}
    </>
  );
}

function BankBlock({ account, kind }: { account: BankAccount | undefined; kind: BankKind }) {
  const titleId = `bank-${kind}-title`;
  if (!account?.exists)
    return (
      <section className="bank" aria-labelledby={titleId}>
        <h2 id={titleId} className="bank__title">
          {TITLE[kind]}
        </h2>
        <p className="bank__empty">
          <Landmark />
          <span>
            <strong>Not entered yet.</strong> Invoices can't show {kind === "INR" ? "INR" : "USD"} payment
            details until the owner enters them.
          </span>
        </p>
      </section>
    );
  return (
    <section className="bank" aria-labelledby={titleId}>
      <h2 id={titleId} className="bank__title">
        {TITLE[kind]}
      </h2>
      <dl className="facts">
        <Fact k="Account name" v={account.accountName} />
        <Fact
          k="Account number"
          v={account.accountNoLast4 ? <Masked last4={account.accountNoLast4} /> : null}
        />
        {kind === "INR" ? (
          <>
            <Fact k="IFSC" v={account.ifsc} />
            <Fact k="Bank" v={account.bankName} />
            <Fact k="Branch" v={account.branch} />
          </>
        ) : (
          <>
            <Fact k="SWIFT / BIC" v={account.swift} />
            <Fact k="Bank" v={account.bankName} />
            <Fact k="Bank address" v={account.bankAddress} />
            <Fact k="Intermediary bank" v={account.intermediary} />
          </>
        )}
        <Fact k="Last changed" v={<When ms={account.updatedAt} inline />} />
      </dl>
    </section>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v ?? <span className="muted">Not set</span>}</dd>
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

function BankForm(props: {
  accounts: BankAccount[];
  onCancel: () => void;
  onSaved: (changed: boolean) => void;
  onReload: () => void;
}) {
  const byKind = (k: BankKind) => props.accounts.find((a) => a.kind === k);
  const [initial] = useState<Forms>(() => ({
    INR: toForm(byKind("INR") ?? ({} as BankAccount)),
    USD_SWIFT: toForm(byKind("USD_SWIFT") ?? ({} as BankAccount)),
  }));
  const [forms, setForms] = useState<Forms>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submits, setSubmits] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const dirty = JSON.stringify(forms) !== JSON.stringify(initial);

  const set = (k: BankKind, patch: Partial<BlockForm>) =>
    setForms((f) => ({ ...f, [k]: { ...f[k], ...patch } }));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const work = KINDS.filter((k) => byKind(k)?.exists || touched(forms[k])).map((k) => ({
      k,
      ...checkBlock(k, forms[k], byKind(k)?.exists ?? false),
    }));
    const found = Object.assign({}, ...work.map((w) => w.errors)) as Record<string, string>;
    setErrors(found);
    setSubmits((n) => n + 1);
    setFailure(null);
    if (Object.keys(found).length) return;
    setBusy(true);
    let changed = false;
    let current: BankKind = "INR";
    try {
      for (const w of work) {
        current = w.k;
        const r = await api.saveBank(w.k, w.body);
        changed ||= r.changed;
      }
      props.onSaved(changed);
    } catch (err) {
      if (err instanceof RequestError && err.code === "stale_version") setStale(true);
      else if (err instanceof RequestError && err.fields.length) {
        setErrors(Object.fromEntries(err.fields.map((f) => [fid(current, f.path), sentence(f.message)])));
        setSubmits((n) => n + 1);
      } else setFailure(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const summary: SummaryError[] = Object.entries(errors).map(([id, text]) => ({ id, text }));
  const err = (k: BankKind, f: string) => errors[fid(k, f)];
  const input = (k: BankKind, f: keyof BlockForm, extra: Record<string, unknown> = {}) => ({
    value: forms[k][f],
    autoComplete: "off",
    spellCheck: false,
    onChange: (e: { target: { value: string } }) => set(k, { [f]: e.target.value }),
    ...extra,
  });

  return (
    <form id="bank-form" className="settings-form" onSubmit={save} noValidate>
      {stale && <StaleNotice onReload={props.onReload} />}
      <ErrorSummary errors={summary} focusKey={submits} />
      {failure && <Notice tone="error">{failure}</Notice>}
      <Notice tone="success">
        Unlocked for 10 minutes. Account numbers are never shown again once saved.
      </Notice>
      <p className="hint">
        All fields are needed unless marked optional. Changes apply to new documents only.
      </p>
      {KINDS.map((k) => {
        const a = byKind(k);
        return (
          <fieldset key={k} className="form-section">
            <legend>{TITLE[k]}</legend>
            {!a?.exists && (
              <p className="hint">Not entered yet. Leave every field empty to skip this account for now.</p>
            )}
            <div className="form-grid">
              <FormField id={fid(k, "accountName")} label="Account name" error={err(k, "accountName")}>
                {(x) => <input {...x} {...input(k, "accountName")} />}
              </FormField>
              {k === "INR" ? (
                <FormField id={fid(k, "ifsc")} label="IFSC" error={err(k, "ifsc")}>
                  {(x) => (
                    <input {...x} {...input(k, "ifsc", { maxLength: 11, autoCapitalize: "characters" })} />
                  )}
                </FormField>
              ) : (
                <FormField id={fid(k, "swift")} label="SWIFT / BIC" error={err(k, "swift")}>
                  {(x) => (
                    <input {...x} {...input(k, "swift", { maxLength: 11, autoCapitalize: "characters" })} />
                  )}
                </FormField>
              )}
              <FormField
                id={fid(k, "accountNo")}
                label="Account number"
                optional={!!a?.exists}
                hint={
                  a?.accountNoLast4
                    ? `Ends in ${a.accountNoLast4}. Leave it empty to keep it, or type the full new number.`
                    : "Letters and digits, as your bank shows it."
                }
                error={err(k, "accountNo")}
              >
                {(x) => (
                  <input {...x} {...input(k, "accountNo", { inputMode: k === "INR" ? "numeric" : "text" })} />
                )}
              </FormField>
              <FormField
                id={fid(k, "accountNoAgain")}
                label="Account number again"
                optional={!forms[k].accountNo}
                hint="Type it again to catch a slip. Pasting is off here."
                error={err(k, "accountNoAgain")}
              >
                {(x) => (
                  <input
                    {...x}
                    {...input(k, "accountNoAgain", {
                      inputMode: k === "INR" ? "numeric" : "text",
                      onPaste: (e: { preventDefault: () => void }) => e.preventDefault(),
                    })}
                  />
                )}
              </FormField>
              <FormField id={fid(k, "bankName")} label="Bank" error={err(k, "bankName")}>
                {(x) => <input {...x} {...input(k, "bankName")} />}
              </FormField>
              {k === "INR" && (
                <FormField id={fid(k, "branch")} label="Branch" optional error={err(k, "branch")}>
                  {(x) => <input {...x} {...input(k, "branch")} />}
                </FormField>
              )}
            </div>
            {k === "USD_SWIFT" && (
              <>
                <FormField id={fid(k, "bankAddress")} label="Bank address" error={err(k, "bankAddress")}>
                  {(x) => (
                    <textarea
                      {...x}
                      rows={2}
                      value={forms[k].bankAddress}
                      onChange={(e) => set(k, { bankAddress: e.target.value })}
                    />
                  )}
                </FormField>
                <FormField
                  id={fid(k, "intermediary")}
                  label="Intermediary bank"
                  optional
                  hint="Only if your bank routes USD through one."
                  error={err(k, "intermediary")}
                >
                  {(x) => <input {...x} {...input(k, "intermediary")} />}
                </FormField>
              </>
            )}
          </fieldset>
        );
      })}
      <div className="actions-row">
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Saving…" : "Save bank details"}
        </button>
        <button type="button" className="btn btn--secondary" onClick={props.onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      <UnsavedChangesGuard dirty={dirty && !busy} what="the bank details" />
    </form>
  );
}
