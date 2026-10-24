// Reply from the admin (M3.2, ADM-LEAD-06): from hello@ to the lead. Start blank or from one of the three 07-I templates
// (filled by the API with the lead's and the sender's details, word for word); everything stays editable. A `[…]` left
// in the text is a gap: it is marked in the preview, listed with a way to jump to it, and blocks sending (the API
// refuses it too, 400 `unfilled_gap`). The preview shows what goes out (paragraphs at blank lines, as the email does).
// 429 says the hourly limit. Once sent, the reply is on the timeline.
import { LEAD_REPLIES_PER_HOUR } from "@techaust/core/reply-templates";
import { type FormEvent, useRef, useState } from "react";
import { api, errorText, type LeadDetail, type ReplyTemplateFilled, RequestError } from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { Send } from "../../components/icons.tsx";
import { useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { findGaps, paragraphs, splitGaps } from "../../lib/leads.ts";

/** The sender every lead reply uses (packages/email SENDERS.hello; the API sets it, not the screen). */
const FROM = "TecHaust Technologies <hello@techaust.com>";
const GAP_MESSAGE = "Fill in the part in square brackets before sending.";

export function ReplyDialog(props: {
  open: boolean;
  lead: LeadDetail;
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const templates = useLoad<{ templates: ReplyTemplateFilled[] } | null>(
    () => (props.open ? api.replyTemplates(props.lead.id) : Promise.resolve(null)),
    props.open ? props.lead.id : "",
  );
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [tried, setTried] = useState(false);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ text: string; limit?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [filled, setFilled] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const list = templates.data?.templates ?? [];

  if (props.open !== shown) {
    setShown(props.open);
    if (props.open) {
      setTemplateId("");
      setSubject("");
      setBody("");
      setTried(false);
      setSubjectError(null);
      setBodyError(null);
      setFailure(null);
      setFilled(false);
    }
  }
  // The subject of every 07-I template is the same line; a blank reply starts with it too.
  if (props.open && !filled && list.length > 0) {
    setFilled(true);
    setSubject(list[0]?.subject ?? "");
  }

  const gaps = findGaps(`${subject}\n${body}`);
  const bodyGaps = findGaps(body);

  function pick(id: string) {
    setTemplateId(id);
    const t = list.find((x) => x.id === id);
    setSubject(t ? t.subject : (list[0]?.subject ?? ""));
    setBody(t ? t.body : "");
    setFailure(null);
    setBodyError(null);
  }

  function goToGap(i: number) {
    const g = bodyGaps[i];
    const el = bodyRef.current;
    if (!g || !el) return;
    el.focus();
    el.setSelectionRange(g.start, g.end);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    const s = subject.trim();
    const b = body.trim();
    setSubjectError(s ? null : "Enter a subject.");
    setBodyError(b ? null : "Write the reply.");
    if (!s) {
      document.getElementById("rp-subject")?.focus();
      return;
    }
    if (!b) {
      bodyRef.current?.focus();
      return;
    }
    if (gaps.length) {
      if (bodyGaps.length) goToGap(0);
      else document.getElementById("rp-subject")?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await api.replyToLead(props.lead.id, { subject: s, body: b, ...(templateId ? { templateId } : {}) });
      toast("success", `Reply sent to ${props.lead.email}.`);
      props.onSent();
    } catch (err) {
      if (err instanceof RequestError && err.code === "unfilled_gap") {
        setTried(true);
        goToGap(0);
      } else if (err instanceof RequestError && err.code === "rate_limited") {
        setFailure({ text: `${err.message}.`, limit: true });
      } else {
        setFailure({ text: errorText(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={props.open} title={`Reply to ${props.lead.name}`} onClose={props.onClose} busy={busy} wide>
      <form onSubmit={submit} noValidate>
        <div className="dialog__body reply">
          <div className="reply__compose">
            <dl className="reply__envelope">
              <div className="reply__row">
                <dt>From</dt>
                <dd>{FROM}</dd>
              </div>
              <div className="reply__row">
                <dt>To</dt>
                <dd className="break">{props.lead.email}</dd>
              </div>
            </dl>
            {failure && (
              <Notice tone="error">
                {failure.text}
                {failure.limit && (
                  <span className="notice__more">
                    Each person can send {LEAD_REPLIES_PER_HOUR} replies an hour.
                  </span>
                )}
              </Notice>
            )}
            {templates.state === "failed" && (
              <Notice tone="error">The templates didn't load. {errorText(templates.error)}</Notice>
            )}
            <FormField id="rp-template" label="Start from">
              {(a) => (
                <select {...a} value={templateId} onChange={(e) => pick(e.target.value)}>
                  <option value="">Blank</option>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField id="rp-subject" label="Subject" error={subjectError}>
              {(a) => (
                <input
                  {...a}
                  autoComplete="off"
                  maxLength={200}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value.replace(/[\r\n]/g, " "))}
                />
              )}
            </FormField>
            <FormField
              id="rp-body"
              label="Message"
              error={bodyError ?? (tried && gaps.length ? GAP_MESSAGE : null)}
            >
              {(a) => (
                <textarea
                  {...a}
                  ref={bodyRef}
                  rows={10}
                  maxLength={4000}
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setBodyError(null);
                  }}
                />
              )}
            </FormField>
            {gaps.length > 0 && (
              <div className={tried ? "gaps gaps--error" : "gaps"} role={tried ? "alert" : undefined}>
                <p className="gaps__title">
                  {gaps.length === 1 ? "1 part to fill in" : `${gaps.length} parts to fill in`}
                </p>
                <ul className="gaps__list">
                  {bodyGaps.map((g, i) => (
                    <li key={`${g.start}-${g.text}`}>
                      <button type="button" className="btn btn--text gaps__go" onClick={() => goToGap(i)}>
                        <mark className="gap">{g.text}</mark>
                        <span className="visually-hidden">: select it in the message</span>
                      </button>
                    </li>
                  ))}
                  {gaps.length > bodyGaps.length && (
                    <li>
                      <span className="gaps__subject">In the subject</span>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <section className="reply__preview" aria-labelledby="rp-preview-h">
            <h3 id="rp-preview-h" className="reply__preview-title">
              Preview
            </h3>
            <div className="mail">
              <p className="mail__subject">
                {splitGaps(subject).map((p, i) =>
                  p.gap ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one line, in order
                    <mark key={i} className="gap">
                      {p.text}
                    </mark>
                  ) : (
                    p.text
                  ),
                )}
              </p>
              {paragraphs(body).length === 0 ? (
                <p className="muted">The message appears here as you write it.</p>
              ) : (
                paragraphs(body).map((para, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs in order
                  <p key={i} className="mail__p">
                    {splitGaps(para).map((p, j) =>
                      p.gap ? (
                        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one paragraph, in order
                        <mark key={j} className="gap">
                          {p.text}
                        </mark>
                      ) : (
                        p.text
                      ),
                    )}
                  </p>
                ))
              )}
            </div>
          </section>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--secondary" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
            <Send />
            {busy ? "Sending…" : "Send reply"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
