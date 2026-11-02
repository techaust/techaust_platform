// A payment's proof (M6.1, L10, L11; ADM-INV-17): the file, its type and its reference, set once. Used by the payment's entry dialog ("Attach proof") and,
// M6.3, by the invoice's Payments panel for a Stripe payment whose proof is awaited (07-ZM S15): Stripe's payment advice or the bank's e-FIRA, with the brief's
// four types offered as suggestions (run file G1); the type stays free text, as for a bank payment.
import { useId, useState } from "react";
import { type Currency, sha256Hex, uploadPaymentDoc } from "../../api.ts";
import { Modal, useRefusalFocus } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { Notice } from "../../components/ui.tsx";
import { CARD_ZM } from "../../lib/copy-zm.ts";
import { INV_COPY } from "../../lib/invoices.ts";
import { PAY_COPY, PAY_UI, payErrorText } from "../../lib/payments.ts";
import { FilePick } from "./parts.tsx";

/** The types a card payment's proof usually is (run file G1's list, the brief's own words): suggestions only. */
const CARD_PROOF_KINDS = ["Stripe payment advice", "e-FIRA", "bank FIRC", "payout report"] as const;

export type ProofTarget = { id: string; currency: Currency; provider: string };

/** The proof form: its own actions ("Cancel" goes back, "Attach proof" uploads). */
export function ProofForm(props: { payment: ProofTarget; onBack: () => void; onDone: (t: string) => void }) {
  const p = props.payment;
  const card = p.provider === "stripe";
  const listId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState("");
  const [ref, setRef] = useState("");
  const [errors, setErrors] = useState<{ file?: string; kind?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = useRefusalFocus();
  async function submit() {
    const e = {
      ...(file ? {} : { file: PAY_UI.proofFileHint }),
      ...(kind.trim() ? {} : { kind: PAY_UI.proofKindMissing }),
    };
    setErrors(e);
    if (e.file || e.kind || !file) {
      document.getElementById(e.file ? "pay-proof-file" : "pay-proof-kind1")?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await uploadPaymentDoc(
        { proofOf: p.id, kind: kind.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) },
        file,
        await sha256Hex(file),
        () => {},
      );
      props.onDone(PAY_UI.proofSaved);
    } catch (err) {
      setFailure(payErrorText(err));
      refusal.show();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="dialog__body pay-form">
        {card ? (
          <p className="hint">{CARD_ZM.proofHint}</p>
        ) : (
          p.currency === "USD" && <p className="hint">{PAY_COPY.exportProofHint}</p>
        )}
        <FilePick
          id="pay-proof-file"
          label={PAY_COPY.proof}
          file={file}
          onFile={setFile}
          error={errors.file}
        />
        <FormField
          id="pay-proof-kind1"
          label={PAY_COPY.proofKind}
          hint={card ? CARD_PROOF_KINDS.join(", ") : PAY_COPY.proofKindHint}
          error={errors.kind}
        >
          {(a) => (
            <input
              {...a}
              maxLength={60}
              autoComplete="off"
              list={card ? listId : undefined}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            />
          )}
        </FormField>
        {card && (
          <datalist id={listId}>
            {CARD_PROOF_KINDS.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        )}
        <FormField id="pay-proof-ref1" label={PAY_COPY.proofRef} optional>
          {(a) => (
            <input
              {...a}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          )}
        </FormField>
      </div>
      {failure && (
        <Notice tone="error" ref={refusal.ref}>
          {failure}
        </Notice>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onBack} disabled={busy}>
          {INV_COPY.cancel}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Working…" : PAY_UI.attachProof}
        </button>
      </div>
    </form>
  );
}

/** The same in its own dialog (the invoice's Payments panel, M6.3). */
export function ProofDialog(props: {
  payment: ProofTarget;
  onClose: () => void;
  onDone: (t: string) => void;
}) {
  return (
    <Modal open title={PAY_UI.attachProof} onClose={props.onClose} className="dialog--pay">
      <ProofForm payment={props.payment} onBack={props.onClose} onDone={props.onDone} />
    </Modal>
  );
}
