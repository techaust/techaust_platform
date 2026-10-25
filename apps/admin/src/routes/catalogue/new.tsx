// New service (M4.1, ADM-CAT-02; owner only): the entry form with an empty draft and the code field. POST /catalogue; a code
// or website address already in use lands on its field with the 07-L line; the new service's page opens after "Service added."
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { catalogueApi, errorText, RequestError } from "../../api.ts";
import { PageHeader } from "../../components/display.tsx";
import { ErrorSummary } from "../../components/form.tsx";
import { NoAccess } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import {
  blankForm,
  buildEntry,
  type EntryForm,
  ERRORS,
  type FieldErrors,
  fieldOfCode,
  saveFailureText,
  TOASTS,
} from "../../lib/catalogue.ts";
import { EntryMain, EntrySide } from "./editor.tsx";
import { CatalogueGate, CRUMBS, useCanWrite } from "./parts.tsx";

export function Component() {
  return (
    <CatalogueGate>
      <NewGate />
    </CatalogueGate>
  );
}

function NewGate() {
  return useCanWrite() ? <NewService /> : <NoAccess what="Adding a service" crumbs={CRUMBS} />;
}

function NewService() {
  const toast = useToast();
  const navigate = useNavigate();
  const [initial] = useState(blankForm);
  const [form, setForm] = useState<EntryForm>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submits, setSubmits] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dirty = !done && JSON.stringify(form) !== JSON.stringify(initial);
  const set = (patch: Partial<EntryForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setFailure(null);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const built = buildEntry(form);
    if ("errors" in built) {
      setErrors(built.errors);
      setSubmits((n) => n + 1);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await catalogueApi.create(built.value);
      setDone(true);
      toast("success", TOASTS.added);
      navigate(`/catalogue/${r.id}`);
    } catch (err) {
      const field = err instanceof RequestError ? fieldOfCode(err.code) : null;
      if (err instanceof RequestError && field) {
        setErrors({ [field]: ERRORS[err.code as keyof typeof ERRORS] as string });
        setSubmits((n) => n + 1);
      } else setFailure(saveFailureText(err, errorText));
    } finally {
      setBusy(false);
    }
  }

  const summary = Object.entries(errors).map(([id, text]) => ({ id, text }));
  return (
    <>
      <UnsavedChangesGuard dirty={dirty && !busy} what="the new service" />
      <PageHeader title="New service" crumbs={CRUMBS} />
      <form onSubmit={save} noValidate className="svc-form">
        <ErrorSummary errors={summary} focusKey={submits} />
        {failure && <Notice tone="error">{failure}</Notice>}
        <p className="hint">All fields are needed unless marked optional.</p>
        <fieldset className="svc-form__body" disabled={busy}>
          <div className="lead-page">
            <div className="lead-page__main">
              <EntryMain form={form} set={set} error={(id) => errors[id]} mode="new" />
            </div>
            <div className="lead-page__side">
              <EntrySide form={form} set={set} error={(id) => errors[id]} mode="new" />
              <div className="lead-panel svc-form__actions">
                <button
                  type="submit"
                  className="btn btn--primary btn--block"
                  disabled={busy}
                  aria-busy={busy || undefined}
                >
                  {busy ? "Saving…" : "Add service"}
                </button>
              </div>
            </div>
          </div>
        </fieldset>
      </form>
    </>
  );
}
