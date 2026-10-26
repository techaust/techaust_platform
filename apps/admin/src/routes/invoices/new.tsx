// "New invoice" (M5.1, ADM-INV-01): an empty draft for one client. The type comes from the client (the server's rule: India gives a tax invoice);
// the contact is the client's billing contact, else the primary one; the lines are added in the editor (the catalogue picker or a custom line).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, type ClientView } from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { DOC_COPY, DOC_PENDING, DOC_TOASTS } from "../../lib/documents.ts";
import { INV_COPY, invErrorText } from "../../lib/invoices.ts";
import { invoicesApi } from "../../lib/invoices-api.ts";
import { ClientPicker } from "../projects/new.tsx";
import { invoiceHref } from "./parts.tsx";

const P = "ni";

export function NewInvoiceDialog(props: {
  open: boolean;
  clientId?: string | undefined;
  onClose: () => void;
}) {
  return (
    <Modal open={props.open} title={INV_COPY.newInvoice} onClose={props.onClose}>
      {props.open && <NewInvoiceForm clientId={props.clientId} onClose={props.onClose} />}
    </Modal>
  );
}

function NewInvoiceForm(props: { clientId?: string | undefined; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [client, setClient] = useState<ClientView | null>(null);
  const [changing, setChanging] = useState(!props.clientId);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preset = useLoad(
    () => (props.clientId ? api.client(props.clientId) : Promise.resolve(null)),
    props.clientId ?? "",
  );
  useEffect(() => {
    if (preset.state === "ready" && preset.data && !client) setClient(preset.data.client);
  }, [preset, client]);

  async function submit() {
    if (!client) {
      setError(DOC_PENDING.pickClient);
      requestAnimationFrame(() => document.getElementById(`${P}-who`)?.focus());
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const made = await invoicesApi.create({ clientId: client.id });
      toast("success", DOC_TOASTS.created);
      props.onClose();
      navigate(invoiceHref(made.id));
    } catch (e) {
      setFormError(invErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit();
      }}
    >
      <div className="dialog__body new-doc__body">
        <div id={`${P}-who`} tabIndex={-1} className="new-doc__who">
          {client && !changing ? (
            <div className="chosen-client">
              <p className="chosen-client__name">
                {client.displayName}
                <span className="docno">{client.code}</span>
                <span className="docno">{client.currency}</span>
              </p>
              <button type="button" className="btn btn--text" onClick={() => setChanging(true)}>
                Change<span className="visually-hidden"> the client</span>
              </button>
            </div>
          ) : (
            <ClientPicker
              prefix={P}
              chosen={client}
              error={undefined}
              onChoose={(c) => {
                setClient(c);
                setChanging(false);
                setError(null);
              }}
            />
          )}
          {error && <FieldError id={`${P}-who-error`}>{error}</FieldError>}
        </div>
        {formError && <Notice tone="error">{formError}</Notice>}
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
          {INV_COPY.cancel}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Working…" : DOC_COPY.createButton}
        </button>
      </div>
    </form>
  );
}
