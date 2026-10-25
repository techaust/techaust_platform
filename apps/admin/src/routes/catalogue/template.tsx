// One template version (M4.1, ADM-CAT-03): its sections with the placeholders drawn as tokens, and the list of versions. A
// version never changes (the table is append-only): on the newest version the owner's Edit makes a new one. The editor offers
// the allowed placeholders as chips that insert at the caret, and a placeholder that doesn't exist is named in place, under its
// section, with the 07-L line (on leaving the field and on saving; the API refuses it too, `unknown_placeholder`).
import { formatIstDateTime } from "@techaust/core";
import { type FormEvent, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { catalogueApi, errorText, RequestError, type TemplateMeta, type TemplatePage } from "../../api.ts";
import { PageHeader, Skeleton, When } from "../../components/display.tsx";
import { ErrorSummary } from "../../components/form.tsx";
import { Pencil } from "../../components/icons.tsx";
import { LoadFailed, NotFound, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { UnsavedChangesGuard } from "../../components/unsaved.tsx";
import {
  COPY,
  ERRORS,
  type FieldErrors,
  insertPlaceholder,
  PENDING,
  PLACEHOLDERS,
  TOASTS,
  templateTitle,
  unknownIn,
} from "../../lib/catalogue.ts";
import { CatalogueGate, PlaceholderText, TEMPLATE_CRUMBS, useCanWrite } from "./parts.tsx";

export function Component() {
  const { id = "" } = useParams();
  return (
    <CatalogueGate>
      <TemplateScreen key={id} id={id} />
    </CatalogueGate>
  );
}

export const versionLine = (t: Pick<TemplateMeta, "version" | "savedByName" | "createdAt">) =>
  COPY.versionLine(t.version, t.savedByName ?? PENDING.seededBy, formatIstDateTime(t.createdAt));

function TemplateScreen({ id }: { id: string }) {
  const page = useLoad(() => catalogueApi.template(id), id);
  if (page.state === "failed") {
    if (page.error instanceof RequestError && (page.error.status === 404 || page.error.status === 400))
      return <NotFound />;
    return (
      <>
        <PageHeader title="Template" crumbs={TEMPLATE_CRUMBS} />
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      </>
    );
  }
  if (page.state === "loading")
    return (
      <>
        <PageHeader title="Template" crumbs={TEMPLATE_CRUMBS} />
        <p className="visually-hidden" role="status">
          Loading the template
        </p>
        <div className="lead-panel stack-sm" aria-hidden="true">
          <Skeleton width="30%" />
          <Skeleton width="80%" />
          <Skeleton width="55%" />
        </div>
      </>
    );
  return <TemplateView data={page.data} />;
}

type Section = { key: string; heading: string; body: string };

function TemplateView({ data }: { data: TemplatePage }) {
  const { template: t, versions } = data;
  const canWrite = useCanWrite();
  const newest = versions[0];
  const isNewest = !newest || newest.id === t.id;
  const [editing, setEditing] = useState<Section[] | null>(null);
  const title = templateTitle(t);
  return (
    <>
      <PageHeader
        title={title}
        crumbs={TEMPLATE_CRUMBS}
        lede={versionLine(t)}
        action={
          canWrite && isNewest && !editing ? (
            <button
              id="tpl-edit"
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setEditing(t.body.sections.map((s) => ({ ...s })));
                requestAnimationFrame(() => document.getElementById("tpl-s0-body")?.focus());
              }}
            >
              <Pencil />
              Edit
            </button>
          ) : undefined
        }
      />
      {!isNewest && newest && (
        <Notice tone="info">
          <p>
            {PENDING.latestVersion(newest.version)}{" "}
            <Link to={`/catalogue/templates/${newest.id}`}>Version {newest.version}</Link>
          </p>
        </Notice>
      )}
      <div className="lead-page">
        <div className="lead-page__main">
          {editing ? (
            <TemplateEditor
              meta={t}
              sections={editing}
              setSections={setEditing}
              onCancel={() => {
                setEditing(null);
                requestAnimationFrame(() => document.getElementById("tpl-edit")?.focus());
              }}
            />
          ) : (
            <section className="lead-panel" aria-label={title}>
              <ol className="tpl-sections">
                {t.body.sections.map((s) => (
                  <li key={s.key} className="tpl-section">
                    <h2 className="tpl-section__h">
                      <PlaceholderText text={s.heading} />
                    </h2>
                    {s.body ? (
                      <p className="tpl-section__body">
                        <PlaceholderText text={s.body} />
                      </p>
                    ) : (
                      <p className="muted">None</p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
        <aside className="lead-page__side" aria-label="Versions">
          <section className="lead-panel" aria-labelledby="tpl-versions-h">
            <h2 id="tpl-versions-h" className="lead-panel__title">
              Versions
            </h2>
            <ol className="tpl-versions">
              {versions.map((v) => (
                <li key={v.id} className="tpl-versions__row">
                  {v.id === t.id ? (
                    <span className="tpl-versions__here" aria-current="page">
                      Version {v.version}
                    </span>
                  ) : (
                    <Link to={`/catalogue/templates/${v.id}`}>Version {v.version}</Link>
                  )}
                  <span className="tpl-versions__who">{v.savedByName ?? PENDING.seededBy}</span>
                  <When ms={v.createdAt} inline />
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}

function TemplateEditor(props: {
  meta: TemplatePage["template"];
  sections: Section[];
  setSections: (s: Section[]) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submits, setSubmits] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // The body the chips write into: the last one that had focus (the first section until then).
  const target = useRef<{ index: number; start: number; end: number }>({ index: 0, start: 0, end: 0 });
  const original = props.meta.body.sections;
  const dirty =
    !saved &&
    props.sections.some((s, i) => s.heading !== original[i]?.heading || s.body !== original[i]?.body);

  const check = (i: number, s: Section, errs: FieldErrors) => {
    const out = { ...errs };
    delete out[`tpl-s${i}-heading`];
    delete out[`tpl-s${i}-body`];
    if (!s.heading.trim()) out[`tpl-s${i}-heading`] = PENDING.emptySections;
    const bad = unknownIn(`${s.heading}\n${s.body}`);
    if (bad.length) out[`tpl-s${i}-body`] = bad.map((p) => ERRORS.unknown_placeholder(p)).join(" ");
    return out;
  };
  const edit = (i: number, patch: Partial<Section>) =>
    props.setSections(props.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  function insert(name: string) {
    const { index, start, end } = target.current;
    const s = props.sections[index];
    if (!s) return;
    const r = insertPlaceholder(s.body, name, start, end);
    edit(index, { body: r.text });
    target.current = { index, start: r.caret, end: r.caret };
    requestAnimationFrame(() => {
      const el = document.getElementById(`tpl-s${index}-body`) as HTMLTextAreaElement | null;
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    let errs: FieldErrors = {};
    props.sections.forEach((s, i) => {
      errs = check(i, s, errs);
    });
    setErrors(errs);
    if (Object.keys(errs).length) {
      setSubmits((n) => n + 1);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const r = await catalogueApi.saveTemplate({
        kind: props.meta.kind,
        category: props.meta.category,
        body: {
          sections: props.sections.map((s) => ({ key: s.key, heading: s.heading.trim(), body: s.body })),
        },
      });
      setSaved(true);
      toast("success", TOASTS.templateSaved(r.version));
      navigate(`/catalogue/templates/${r.id}`);
    } catch (err) {
      if (err instanceof RequestError && err.code === "unknown_placeholder") {
        // The API names none; the screen finds them again and shows each under its section.
        let found: FieldErrors = {};
        props.sections.forEach((s, i) => {
          found = check(i, s, found);
        });
        setErrors(found);
        setSubmits((n) => n + 1);
      } else if (err instanceof RequestError && err.code === "template_category")
        setFailure(ERRORS.template_category);
      else if (err instanceof RequestError && err.code === "conflict") setFailure(ERRORS.conflict);
      else if (err instanceof RequestError && err.code === "invalid") setFailure(PENDING.tooLong);
      else setFailure(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const summary = Object.entries(errors).map(([id, text]) => ({ id, text }));
  const next = props.meta.version + 1;
  return (
    <form className="lead-panel tpl-editor" onSubmit={save} noValidate aria-labelledby="tpl-editor-h">
      <UnsavedChangesGuard dirty={dirty && !busy} what="this template" />
      <h2 id="tpl-editor-h" className="visually-hidden">
        {templateTitle(props.meta)}
      </h2>
      <ErrorSummary errors={summary} focusKey={submits} />
      {failure && <Notice tone="error">{failure}</Notice>}
      {/* biome-ignore lint/a11y/useSemanticElements: a set of insert buttons, not form controls in a fieldset (the FilterBar chips pattern) */}
      <div className="ph-chips" role="group" aria-labelledby="tpl-ph-label" aria-describedby="tpl-ph-hint">
        <span id="tpl-ph-label" className="label-like">
          Placeholders
        </span>
        <p id="tpl-ph-hint" className="hint">
          {COPY.placeholdersHint}
        </p>
        <ul className="ph-chips__row">
          {PLACEHOLDERS.map((p) => (
            <li key={p}>
              <button
                type="button"
                className="chip ph-chip"
                // Keep the caret where it was in the body while the chip is pressed.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(p)}
              >
                <span className="visually-hidden">Insert </span>
                <code>{`{{${p}}}`}</code>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <fieldset className="tpl-editor__body" disabled={busy}>
        <ol className="tpl-sections tpl-sections--edit">
          {props.sections.map((s, i) => {
            const hid = `tpl-s${i}-heading`;
            const bid = `tpl-s${i}-body`;
            const bodyError = errors[bid];
            const headError = errors[hid];
            const unknown = unknownIn(`${s.heading}\n${s.body}`);
            return (
              <li key={s.key} className="tpl-section">
                <div className="field">
                  <label htmlFor={hid}>Section {i + 1}, heading</label>
                  <input
                    id={hid}
                    autoComplete="off"
                    maxLength={120}
                    value={s.heading}
                    aria-invalid={headError ? true : undefined}
                    aria-describedby={headError ? `${hid}-error` : undefined}
                    onChange={(e) => edit(i, { heading: e.target.value })}
                    onBlur={() => setErrors((x) => check(i, s, x))}
                  />
                  {headError && <FieldError id={`${hid}-error`}>{headError}</FieldError>}
                </div>
                <div className="field">
                  <label htmlFor={bid}>Section {i + 1}, text</label>
                  <textarea
                    id={bid}
                    rows={Math.min(10, Math.max(3, s.body.split("\n").length + 1))}
                    maxLength={2000}
                    value={s.body}
                    aria-invalid={bodyError ? true : undefined}
                    aria-describedby={bodyError ? `${bid}-error` : "tpl-ph-hint"}
                    onChange={(e) => edit(i, { body: e.target.value })}
                    onFocus={(e) => {
                      target.current = {
                        index: i,
                        start: e.target.selectionStart,
                        end: e.target.selectionEnd,
                      };
                    }}
                    onSelect={(e) => {
                      const el = e.currentTarget;
                      target.current = { index: i, start: el.selectionStart, end: el.selectionEnd };
                    }}
                    onBlur={() => setErrors((x) => check(i, s, x))}
                  />
                  {bodyError && <FieldError id={`${bid}-error`}>{bodyError}</FieldError>}
                  {s.body.includes("{{") && (
                    <p className="tpl-section__body tpl-section__body--echo" aria-hidden="true">
                      <PlaceholderText text={s.body} unknown={bodyError ? unknown : undefined} />
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </fieldset>
      <div className="lead-panel__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Saving…" : `Save as version ${next}`}
        </button>
      </div>
    </form>
  );
}
