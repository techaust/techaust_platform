// Preview: the shared states every admin screen uses. Toasts, a confirmation for a money action with the code in
// the same dialog, a form after a failed submit, and the no-access and not-found pages inside the shell.
import { formatMoney, money } from "@techaust/core";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { RequestError } from "../api.ts";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { PageHeader } from "../components/display.tsx";
import { ErrorSummary, FormField } from "../components/form.tsx";
import { ChevronRight } from "../components/icons.tsx";
import { useToast } from "../components/toast.tsx";

export function StatesPreview() {
  const toast = useToast();
  const [voiding, setVoiding] = useState(false);
  const [submits, setSubmits] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("ravi@");
  const nameErr = name.trim() ? null : "Enter the client's name.";
  const emailErr = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? null
    : "Enter an email address, like name@example.com.";
  const errors = [
    nameErr && { id: "st-name", text: nameErr },
    emailErr && { id: "st-email", text: emailErr },
  ].filter(Boolean) as { id: string; text: string }[];

  const amount = formatMoney(money(1_18_000_00, "INR"));

  return (
    <>
      <PageHeader
        title="States"
        lede="How the admin answers: what you see when something works, needs confirming, goes wrong or isn't yours to open."
      />

      <section className="states-sec" aria-labelledby="st-toasts">
        <h2 id="st-toasts">Messages after an action</h2>
        <p className="hint">
          They stay at least 6 seconds (errors 10), pause while you point at them, and an error is always
          shown on the screen too.
        </p>
        <div className="actions-row">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => toast("success", "Invoice TH/INV/2627/0042 sent to ravi@example.test.")}
          >
            Show a success message
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() =>
              toast(
                "error",
                "The invoice wasn't sent: the email service didn't answer. Nothing went out; try again in a minute.",
              )
            }
          >
            Show an error message
          </button>
        </div>
      </section>

      <section className="states-sec" aria-labelledby="st-confirm">
        <h2 id="st-confirm">Confirming a money action</h2>
        <p className="hint">
          The dialog says what, for whom, how much and what happens next, and asks for the code in the same
          place.
        </p>
        <div className="actions-row">
          <button type="button" className="btn btn--danger-outline" onClick={() => setVoiding(true)}>
            Void invoice TH/INV/2627/0042
          </button>
        </div>
      </section>

      <section className="states-sec" aria-labelledby="st-form">
        <h2 id="st-form">A form after a failed save</h2>
        <form
          className="settings-form states-form"
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setSubmits((n) => n + 1);
            if (!errors.length) toast("success", "Client saved.");
          }}
        >
          <ErrorSummary errors={errors} focusKey={submits} />
          <div className="form-grid">
            <FormField id="st-name" label="Client name" error={nameErr}>
              {(a) => (
                <input
                  {...a}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="organization"
                />
              )}
            </FormField>
            <FormField id="st-email" label="Billing email" error={emailErr}>
              {(a) => (
                <input
                  {...a}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              )}
            </FormField>
          </div>
          <button type="submit" className="btn btn--primary">
            Save client
          </button>
        </form>
      </section>

      <section className="states-sec" aria-labelledby="st-pages">
        <h2 id="st-pages">Pages inside the shell</h2>
        <ul className="setlist">
          {[
            {
              to: "/preview/states/403",
              t: "You don't have access",
              d: "A Staff member opens bank details.",
            },
            {
              to: "/preview/no-such-page",
              t: "Page not found",
              d: "An old link, or a record that was removed.",
            },
            {
              to: "/preview/users?view=loading",
              t: "Loading",
              d: "Skeleton rows while a list loads; no spinners.",
            },
            {
              to: "/preview/users?view=empty",
              t: "Nothing matches",
              d: "An empty list says why and what to do next.",
            },
            { to: "/preview/shell/leads", t: "Coming soon", d: "A section a later milestone builds." },
          ].map((p) => (
            <li key={p.to}>
              <Link to={p.to} className="setlist__link">
                <span className="setlist__text">
                  <span className="setlist__label">{p.t}</span>
                  <span className="setlist__desc">{p.d}</span>
                </span>
                <ChevronRight />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <ConfirmDialog
        open={voiding}
        title="Void invoice TH/INV/2627/0042?"
        tone="danger"
        stepUp
        confirmLabel="Void invoice"
        busyLabel="Voiding…"
        onClose={() => setVoiding(false)}
        onConfirm={(code) =>
          code === "000000"
            ? Promise.reject(
                new RequestError(
                  400,
                  "invalid_code",
                  "That code didn't work. Wait for the next code from your app and enter it.",
                ),
              )
            : new Promise<undefined>((r) =>
                setTimeout(() => {
                  toast("success", "Invoice TH/INV/2627/0042 is void. Its number stays used.");
                  r(undefined);
                }, 600),
              )
        }
      >
        <dl className="confirm-facts">
          <div>
            <dt>Client</dt>
            <dd>Northwind Traders</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd className="money">{amount}</dd>
          </div>
          <div>
            <dt>Issued</dt>
            <dd>21 Oct 2026</dd>
          </div>
        </dl>
        <p>
          The invoice is marked void and keeps its number; it can't be issued again. If the client has paid,
          issue a credit note instead.
        </p>
      </ConfirmDialog>
    </>
  );
}
