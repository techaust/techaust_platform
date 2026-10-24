// Email settings (ADM-SET-07): the three sender identities, the reply-to address, a blind copy to the owner per
// template, and the footer line. "Send a test to me" queues one email of that template, with sample data, to the
// signed-in member only (the API takes the address from the session; five an hour).
import { EMAIL_TEMPLATES, type EmailTemplate } from "@techaust/core/email-templates";
import { useState } from "react";
import { TEMPLATE_NAMES } from "../../../worker/email-fixtures.ts";
import { api, errorText } from "../../api.ts";
import { SettingRow, Switch } from "../../components/form.tsx";
import { Send } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { sentence } from "../../lib/format.ts";
import { type FieldErrors, looksLikeEmail } from "../../lib/settings-form.ts";
import { useUser } from "../../session.tsx";
import { type Built, ctl, GroupForm, type GroupSpec, RowError } from "./kit.tsx";

type Form = {
  hello: string;
  billing: string;
  noReply: string;
  replyTo: string;
  footerText: string;
  bcc: Partial<Record<EmailTemplate, boolean>>;
};

const spec: GroupSpec<"email", Form> = {
  group: "email",
  what: "the email settings",
  savedText: "Email settings saved.",
  toForm: (v) => ({
    hello: v.senders.hello,
    billing: v.senders.billing,
    noReply: v.senders.noReply,
    replyTo: v.replyTo,
    footerText: v.footerText,
    bcc: { ...v.bccOwner },
  }),
  build: (f): Built<"email"> => {
    const e: FieldErrors = {};
    const need = (id: string, v: string) => {
      if (!looksLikeEmail(v)) e[id] = "Enter an email address, like hello@techaust.com.";
    };
    need("f-senders-hello", f.hello);
    need("f-senders-billing", f.billing);
    need("f-senders-noReply", f.noReply);
    need("f-replyTo", f.replyTo);
    if (!f.footerText.trim()) e["f-footerText"] = "Enter the footer line.";
    else if (f.footerText.trim().length > 500) e["f-footerText"] = "Keep the footer under 500 characters.";
    if (Object.keys(e).length) return { errors: e };
    return {
      value: {
        senders: { hello: f.hello.trim(), billing: f.billing.trim(), noReply: f.noReply.trim() },
        replyTo: f.replyTo.trim(),
        bccOwner: Object.fromEntries(Object.entries(f.bcc).filter(([, on]) => on)),
        footerText: f.footerText.trim(),
      },
    };
  },
};

const SENDERS = [
  { key: "hello", id: "f-senders-hello", label: "General", desc: "Replies to enquiries and everyday mail." },
  { key: "billing", id: "f-senders-billing", label: "Billing", desc: "Invoices, receipts and reminders." },
  { key: "noReply", id: "f-senders-noReply", label: "No-reply", desc: "Sign-in links and security alerts." },
] as const;

export function EmailSettings() {
  const user = useUser();
  const toast = useToast();
  const [sending, setSending] = useState<EmailTemplate | null>(null);

  async function test(t: EmailTemplate) {
    setSending(t);
    try {
      await api.testEmail(t);
      toast("success", `A test “${TEMPLATE_NAMES[t]}” email is on its way to ${user.email}.`);
    } catch (e) {
      toast("error", `The test wasn't sent. ${sentence(errorText(e))}`);
    } finally {
      setSending(null);
    }
  }

  return (
    <GroupForm spec={spec} readOnly={false}>
      {({ form: f, set, error }) => (
        <>
          <h2 className="settings-sub">Senders</h2>
          <p className="hint">The addresses must be verified with Amazon SES before mail can go from them.</p>
          <div className="settings-rows">
            {SENDERS.map((s) => (
              <SettingRow key={s.key} id={`em-${s.key}`} label={s.label} labelFor={s.id} description={s.desc}>
                <input
                  {...ctl(s.id, error(s.id), `em-${s.key}-desc`)}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  value={f[s.key]}
                  onChange={(e) => set({ [s.key]: e.target.value } as Partial<Form>)}
                />
                <RowError id={s.id} error={error(s.id)} />
              </SettingRow>
            ))}
            <SettingRow
              id="em-reply"
              label="Reply-to"
              labelFor="f-replyTo"
              description="Where replies to any email go."
            >
              <input
                {...ctl("f-replyTo", error("f-replyTo"), "em-reply-desc")}
                type="email"
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                value={f.replyTo}
                onChange={(e) => set({ replyTo: e.target.value })}
              />
              <RowError id="f-replyTo" error={error("f-replyTo")} />
            </SettingRow>
            <SettingRow
              id="em-footer"
              label="Footer line"
              labelFor="f-footerText"
              description="At the bottom of every email."
            >
              <textarea
                {...ctl("f-footerText", error("f-footerText"), "em-footer-desc")}
                rows={2}
                value={f.footerText}
                onChange={(e) => set({ footerText: e.target.value })}
              />
              <RowError id="f-footerText" error={error("f-footerText")} />
            </SettingRow>
          </div>

          <h2 className="settings-sub">A copy to you</h2>
          <p className="hint">
            Switch one on to get a blind copy of every email of that kind. A test goes to you only, with
            sample data, whatever the switch says.
          </p>
          <div className="settings-rows">
            {EMAIL_TEMPLATES.map((t) => {
              const rid = `em-bcc-${t.replace(".", "-")}`;
              return (
                <SettingRow key={t} id={rid} label={TEMPLATE_NAMES[t]}>
                  <div className="row-controls">
                    <Switch
                      id={`${rid}-sw`}
                      labelledBy={`${rid}-label`}
                      checked={!!f.bcc[t]}
                      onChange={(on) => set({ bcc: { ...f.bcc, [t]: on } })}
                    />
                    <button
                      type="button"
                      className="btn btn--text"
                      onClick={() => test(t)}
                      disabled={sending !== null}
                      aria-busy={sending === t || undefined}
                    >
                      <Send size={16} />
                      {sending === t ? "Sending…" : "Send a test to me"}
                      <span className="visually-hidden"> ({TEMPLATE_NAMES[t]})</span>
                    </button>
                  </div>
                </SettingRow>
              );
            })}
          </div>
        </>
      )}
    </GroupForm>
  );
}
