// The lines of a draft (M4.3, ADM-PROP-03, docs/06 §5.3 LineItemsEditor) drawn as LEDGER ROWS: the description and the line's amount on
// the first line, the working underneath it (quantity, rate, discount, then the taxable value and the tax the server worked out), and a
// quiet marker that says where the line came from (the catalogue, or a custom line the discount guard ignores). The form keeps up to 100
// lines usable: every row is memoised and owns nothing but its inputs, so a keystroke draws one row, not a hundred. Moving, editing the
// second line and the custom line's tax, and removing are in each row's menu (keyboard and screen-reader friendly, no drag).
import { type Dispatch, memo, useCallback, useId, useMemo, useState } from "react";
import { type CatalogueEntry, type CatalogueListItem, type Currency, catalogueApi } from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { FormField } from "../../components/form.tsx";
import { ArrowDown, ArrowUp, Package, Pencil, Plus, Trash } from "../../components/icons.tsx";
import { MenuButton } from "../../components/popover.tsx";
import { useLoad } from "../../components/states.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { COPY as CAT_COPY, milliToQty, UNIT_LABELS, UNITS } from "../../lib/catalogue.ts";
import {
  DOC_COPY,
  DOC_ERRORS,
  DOC_PENDING,
  type EditorAction,
  type LineDraft,
  type LineErrors,
  lineColumns,
  lineErrors,
  lineTaxText,
  moneyText,
  moved,
  uid,
} from "../../lib/documents.ts";
import type { Issue, LineFigures, QuoteType, Supply } from "../../lib/documents-api.ts";
import { moneyInput } from "../../lib/settings-form.ts";
import { MoneyIn } from "../projects/parts.tsx";

export const LINES_MAX = 100;

export const LinesPanel = memo(function LinesPanel(props: {
  lines: LineDraft[];
  figures: Record<string, LineFigures>;
  currency: Currency;
  supply: Supply | null;
  warnings: Issue[];
  showErrors: boolean;
  type: QuoteType;
  dispatch: Dispatch<EditorAction>;
  /** The current lines, for the row menus (a stable callback reads them when used, not when drawn). */
  current: () => LineDraft[];
}) {
  const { dispatch, current } = props;
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const monthly = useMemo(
    () =>
      new Set(
        props.warnings
          .filter((w) => w.code === "monthly_line_in_proposal" && w.path[0] === "lines")
          .map((w) => Number(w.path[1])),
      ),
    [props.warnings],
  );

  const edit = useCallback(
    (u: string, patch: Partial<LineDraft>) => dispatch({ type: "line", uid: u, patch }),
    [dispatch],
  );
  const move = useCallback(
    (u: string, by: -1 | 1) => {
      const list = current();
      const i = list.findIndex((l) => l.uid === u);
      dispatch({ type: "lines", lines: moved(list, i, by) });
      requestAnimationFrame(() => document.getElementById(`ln-${u}-description`)?.focus());
    },
    [dispatch, current],
  );
  const remove = useCallback(
    (u: string) => {
      const list = current();
      const i = list.findIndex((l) => l.uid === u);
      const rest = list.filter((l) => l.uid !== u);
      dispatch({ type: "lines", lines: rest });
      const next = rest[i] ?? rest[i - 1];
      requestAnimationFrame(() =>
        document.getElementById(next ? `ln-${next.uid}-description` : "ln-add-custom")?.focus(),
      );
    },
    [dispatch, current],
  );
  const openDetails = useCallback((u: string) => setDetails(u), []);

  function add(line: LineDraft) {
    dispatch({ type: "lines", lines: [...current(), line] });
    setFocusId(`ln-${line.uid}-description`);
    requestAnimationFrame(() => document.getElementById(`ln-${line.uid}-description`)?.focus());
  }

  const full = props.lines.length >= LINES_MAX;
  const editing = details ? props.lines.find((l) => l.uid === details) : undefined;
  return (
    <section className="lead-panel doc-lines" aria-labelledby="doc-lines-h">
      <div className="lead-panel__head">
        <h2 id="doc-lines-h" className="lead-panel__title">
          Lines
        </h2>
        <span className="doc-lines__count tnum" aria-hidden="true">
          {props.lines.length} / {LINES_MAX}
        </span>
      </div>
      {props.lines.length === 0 ? (
        <p className="panel-empty">
          <Package size={20} />
          <span>{DOC_PENDING.noLines}</span>
        </p>
      ) : (
        <ol className="qledger" aria-labelledby="doc-lines-h" data-focus={focusId ?? undefined}>
          {props.lines.map((l, i) => (
            <LineRow
              key={l.uid}
              line={l}
              n={i + 1}
              count={props.lines.length}
              figures={props.figures[l.uid]}
              currency={props.currency}
              supply={props.supply}
              showErrors={props.showErrors}
              monthly={props.type === "proposal" && monthly.has(i)}
              onEdit={edit}
              onMove={move}
              onRemove={remove}
              onDetails={openDetails}
            />
          ))}
        </ol>
      )}
      <div className="doc-lines__add">
        <button type="button" className="btn btn--secondary" onClick={() => setPicking(true)} disabled={full}>
          <Package size={20} />
          {DOC_PENDING.addCatalogueLine}
        </button>
        <button
          type="button"
          id="ln-add-custom"
          className="btn btn--text"
          disabled={full}
          onClick={() =>
            add({
              uid: uid("l"),
              id: null,
              catalogueItemId: null,
              catalogueLine: null,
              catalogueRateMinor: null,
              defaultLine: null,
              code: null,
              description: "",
              detail: "",
              sac: "",
              gstRate: "",
              unit: "fixed",
              qty: "1",
              rate: "",
              discKind: "percent",
              disc: "",
            })
          }
        >
          <Plus size={16} />
          {DOC_PENDING.addCustomLine}
        </button>
        {full && <p className="hint">{DOC_ERRORS.too_many_lines}</p>}
      </div>
      <CataloguePick
        open={picking}
        currency={props.currency}
        onClose={() => setPicking(false)}
        onPick={add}
      />
      <LineDetails
        line={editing}
        n={editing ? props.lines.indexOf(editing) + 1 : 0}
        onClose={() => {
          const u = details;
          setDetails(null);
          if (u) requestAnimationFrame(() => document.getElementById(`ln-${u}-description`)?.focus());
        }}
        onSave={(patch) => {
          if (details) edit(details, patch);
        }}
      />
    </section>
  );
});

type RowProps = {
  line: LineDraft;
  n: number;
  count: number;
  figures: LineFigures | undefined;
  currency: Currency;
  supply: Supply | null;
  showErrors: boolean;
  monthly: boolean;
  onEdit: (uid: string, patch: Partial<LineDraft>) => void;
  onMove: (uid: string, by: -1 | 1) => void;
  onRemove: (uid: string) => void;
  onDetails: (uid: string) => void;
};

const LineRow = memo(function LineRow(p: RowProps) {
  const l = p.line;
  const [left, setLeft] = useState<Partial<Record<keyof LineErrors, true>>>({});
  const errors = lineErrors(l, p.currency);
  const shown = (k: keyof LineErrors) => (p.showErrors || left[k] ? errors[k] : undefined);
  const id = (k: string) => `ln-${l.uid}-${k}`;
  const blur = (k: keyof LineErrors) => () => setLeft((x) => (x[k] ? x : { ...x, [k]: true }));
  const a11y = (k: keyof LineErrors) => {
    const e = shown(k);
    return {
      id: id(k),
      ...(e ? { "aria-invalid": true as const, "aria-describedby": `${id(k)}-error` } : {}),
    };
  };
  const f = p.figures;
  const hidden = <span className="visually-hidden">Line {p.n}, </span>;
  const fromCatalogue = l.catalogueItemId !== null;
  const items = [
    ...(p.n > 1
      ? [{ label: "Move up", icon: <ArrowUp size={16} />, onSelect: () => p.onMove(l.uid, -1) }]
      : []),
    ...(p.n < p.count
      ? [{ label: "Move down", icon: <ArrowDown size={16} />, onSelect: () => p.onMove(l.uid, 1) }]
      : []),
    { label: "Edit details", icon: <Pencil size={16} />, onSelect: () => p.onDetails(l.uid) },
    {
      label: "Remove",
      icon: <Trash size={16} />,
      tone: "danger" as const,
      onSelect: () => p.onRemove(l.uid),
    },
  ];
  return (
    <li className="qledger__row" data-custom={fromCatalogue ? undefined : true}>
      <span className="qledger__n tnum" aria-hidden="true">
        {p.n}
      </span>
      <div className="qledger__desc">
        <label className="qledger__label visually-hidden" htmlFor={id("description")}>
          {hidden}
          {lineColumns.description}
        </label>
        <input
          {...a11y("description")}
          className="qledger__desc-in"
          autoComplete="off"
          maxLength={200}
          value={l.description}
          placeholder={lineColumns.description}
          onChange={(e) => p.onEdit(l.uid, { description: e.target.value })}
          onBlur={blur("description")}
        />
        {l.detail.trim() !== "" && <span className="qledger__detail">{l.detail}</span>}
      </div>
      <p className="qledger__amount tnum">
        <span className="visually-hidden">
          {hidden}
          {lineColumns.amount}:{" "}
        </span>
        {f?.lineTotalMinor === null || f?.lineTotalMinor === undefined
          ? ""
          : moneyText(f.lineTotalMinor, p.currency)}
      </p>
      <div className="qledger__act">
        <MenuButton label={`Actions for line ${p.n}`} items={items} align="end" />
      </div>
      <div className="qledger__work">
        <div className="qledger__cell qledger__cell--qty">
          <label className="qledger__label" htmlFor={id("qty")}>
            {hidden}
            {lineColumns.quantity}
          </label>
          <div className="qledger__qty">
            <input
              {...a11y("qty")}
              className="tnum"
              inputMode="decimal"
              autoComplete="off"
              value={l.qty}
              onChange={(e) => p.onEdit(l.uid, { qty: e.target.value })}
              onBlur={blur("qty")}
            />
            <span className="qledger__unit">{UNIT_LABELS[l.unit as keyof typeof UNIT_LABELS] ?? l.unit}</span>
          </div>
        </div>
        <div className="qledger__cell">
          <label className="qledger__label" htmlFor={id("rate")}>
            {hidden}
            {lineColumns.rate}
          </label>
          <MoneyIn
            a11y={a11y("rate")}
            currency={p.currency}
            value={l.rate}
            onChange={(rate) => p.onEdit(l.uid, { rate })}
            onBlur={blur("rate")}
          />
        </div>
        <div className="qledger__cell qledger__cell--disc">
          <label className="qledger__label" htmlFor={id("disc")}>
            {hidden}
            {DOC_COPY.lineDiscount}
          </label>
          <div className="disc-in">
            <select
              aria-label={`Line ${p.n}, ${DOC_COPY.lineDiscount}: ${DOC_COPY.fixed} or ${DOC_COPY.percent}`}
              value={l.discKind}
              onChange={(e) => p.onEdit(l.uid, { discKind: e.target.value as "fixed" | "percent" })}
            >
              <option value="percent">{DOC_COPY.percent}</option>
              <option value="fixed">{DOC_COPY.fixed}</option>
            </select>
            <input
              {...a11y("disc")}
              className="tnum disc-in__value"
              inputMode="decimal"
              autoComplete="off"
              value={l.disc}
              onChange={(e) => p.onEdit(l.uid, { disc: e.target.value })}
              onBlur={blur("disc")}
            />
          </div>
        </div>
      </div>
      <dl className="qledger__figs">
        <div>
          <dt>{lineColumns.taxable}</dt>
          <dd className="tnum">
            {f?.taxableMinor === null || f?.taxableMinor === undefined
              ? ""
              : moneyText(f.taxableMinor, p.currency)}
          </dd>
        </div>
        <div>
          <dt>{lineColumns.tax}</dt>
          <dd className="tnum">{lineTaxText(f, p.currency, p.supply)}</dd>
        </div>
      </dl>
      <p className="qledger__meta">
        {fromCatalogue ? (
          <span className="qledger__src">
            <Package size={16} />
            {l.code ?? "Catalogue"}
            {l.catalogueLine && <span>{l.catalogueLine}</span>}
            {l.catalogueRateMinor !== null && (
              <span className="tnum">{moneyText(l.catalogueRateMinor, p.currency)}</span>
            )}
          </span>
        ) : (
          <span className="qledger__src qledger__src--custom">{DOC_COPY.customLine}</span>
        )}
      </p>
      {(p.monthly || Object.keys(errors).some((k) => shown(k as keyof LineErrors))) && (
        <div className="qledger__errors">
          {(["description", "qty", "rate", "disc", "sac", "gstRate"] as const).map((k) =>
            shown(k) ? (
              <FieldError key={k} id={`${id(k)}-error`}>
                {shown(k)}
              </FieldError>
            ) : null,
          )}
          {p.monthly && <p className="qledger__warn">{DOC_ERRORS.monthly_line_in_proposal}</p>}
        </div>
      )}
    </li>
  );
});

/** Add a line from the catalogue: the service, and (for a service with default lines) which line. The rate starts at the catalogue price. */
function CataloguePick(props: {
  open: boolean;
  currency: Currency;
  onClose: () => void;
  onPick: (line: LineDraft) => void;
}) {
  return (
    <Modal open={props.open} title={DOC_PENDING.addCatalogueLine} onClose={props.onClose}>
      {props.open && <CataloguePickForm {...props} />}
    </Modal>
  );
}

function CataloguePickForm(props: {
  currency: Currency;
  onClose: () => void;
  onPick: (line: LineDraft) => void;
}) {
  const list = useLoad(() => catalogueApi.list({ active: "1", limit: "50" }), "");
  const [item, setItem] = useState<CatalogueListItem | null>(null);
  const [entry, setEntry] = useState<CatalogueEntry | null>(null);
  const [lineName, setLineName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = useId();
  const priceOf = (inr: number | null, usd: number | null) => (props.currency === "INR" ? inr : usd);

  function choose(it: CatalogueListItem) {
    setItem(it);
    setEntry(null);
    setLineName(null);
    setError(null);
    catalogueApi.item(it.id).then(
      (r) => setEntry(r.item),
      () => setError(DOC_PENDING.linesLoadFailed),
    );
  }

  function add() {
    if (!item || !entry) {
      setError(DOC_PENDING.chooseService);
      return;
    }
    const defaults = entry.defaultLines ?? [];
    const d = defaults.find((x) => x.description === lineName);
    if (defaults.length > 0 && !d) {
      setError(`${DOC_ERRORS.choose_default_lines.replace("{service}", entry.name)}`);
      return;
    }
    const rate = d
      ? priceOf(d.rateInrMinor, d.rateUsdMinor)
      : priceOf(entry.priceInrMinor, entry.priceUsdMinor);
    props.onPick({
      uid: uid("l"),
      id: null,
      catalogueItemId: entry.id,
      catalogueLine: d ? d.description : null,
      catalogueRateMinor: rate,
      defaultLine: d ? d.description : null,
      code: entry.code,
      description: d ? d.description : entry.name.replaceAll(" & ", " and "),
      detail: "",
      sac: entry.sac,
      gstRate: "",
      unit: d ? d.unit : entry.unit,
      qty: d ? milliToQty(d.qtyMilli) : "1",
      rate: rate === null ? "" : moneyInput(rate, props.currency),
      discKind: "percent",
      disc: "",
    });
    props.onClose();
  }

  const items = list.state === "ready" ? list.data.items : [];
  const defaults = entry?.defaultLines ?? [];
  return (
    <>
      <div className="dialog__body pick">
        {list.state === "loading" && (
          <p className="hint" role="status">
            Loading…
          </p>
        )}
        <fieldset className="radios pick__list">
          <legend>{DOC_COPY.services}</legend>
          {items.map((it) => {
            const price = priceOf(it.priceInrMinor, it.priceUsdMinor);
            return (
              <label key={it.id} className="radio client-option">
                <input
                  type="radio"
                  name={`${base}-svc`}
                  checked={item?.id === it.id}
                  onChange={() => choose(it)}
                />
                <span className="client-option__text">
                  <span className="client-option__name">{it.name}</span>
                  <span className="client-option__meta">
                    <span className="docno">{it.code}</span>
                    {price !== null && <span className="tnum">{moneyText(price, props.currency)}</span>}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {entry && defaults.length > 0 && (
          <fieldset className="radios pick__list">
            <legend>
              {DOC_ERRORS.choose_default_lines.replace("{service}", entry.name).replace(/\.$/, "")}
            </legend>
            {defaults.map((d) => {
              const r = priceOf(d.rateInrMinor, d.rateUsdMinor);
              return (
                <label key={d.description} className="radio client-option">
                  <input
                    type="radio"
                    name={`${base}-line`}
                    checked={lineName === d.description}
                    onChange={() => setLineName(d.description)}
                  />
                  <span className="client-option__text">
                    <span className="client-option__name">{d.description}</span>
                    {r !== null && (
                      <span className="client-option__meta">
                        <span className="tnum">{moneyText(r, props.currency)}</span>
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" onClick={add}>
          {DOC_PENDING.addCatalogueLine}
        </button>
      </div>
    </>
  );
}

/** A line's second line (shown under the description in the document) and, for a custom line, its unit, SAC and GST rate. */
function LineDetails(props: {
  line: LineDraft | undefined;
  n: number;
  onClose: () => void;
  onSave: (patch: Partial<LineDraft>) => void;
}) {
  return (
    <Modal open={!!props.line} title={`Line ${props.n}`} onClose={props.onClose}>
      {props.line && <LineDetailsForm {...props} line={props.line} />}
    </Modal>
  );
}

function LineDetailsForm(props: {
  line: LineDraft;
  onClose: () => void;
  onSave: (patch: Partial<LineDraft>) => void;
}) {
  const l = props.line;
  const custom = l.catalogueItemId === null;
  const [detail, setDetail] = useState(l.detail);
  const [unit, setUnit] = useState(l.unit);
  const [sac, setSac] = useState(l.sac);
  const [gst, setGst] = useState(l.gstRate);
  const errors = lineErrors({ ...l, sac, gstRate: gst }, "INR");
  const [tried, setTried] = useState(false);
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (custom && (errors.sac || errors.gstRate)) return;
        props.onSave(custom ? { detail, unit, sac, gstRate: gst } : { detail });
        props.onClose();
      }}
    >
      <div className="dialog__body">
        <FormField id="ld-detail" label="Detail" optional>
          {(a) => (
            <textarea
              {...a}
              rows={3}
              maxLength={300}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          )}
        </FormField>
        {custom ? (
          <>
            <FormField id="ld-unit" label="Unit">
              {(a) => (
                <select {...a} value={unit} onChange={(e) => setUnit(e.target.value)}>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField
              id="ld-sac"
              label="SAC"
              optional
              hint={CAT_COPY.sacHint}
              error={tried ? errors.sac : undefined}
            >
              {(a) => (
                <input
                  {...a}
                  inputMode="numeric"
                  autoComplete="off"
                  value={sac}
                  onChange={(e) => setSac(e.target.value)}
                />
              )}
            </FormField>
            <FormField
              id="ld-gst"
              label="GST rate"
              optional
              hint={CAT_COPY.gstHint}
              error={tried ? errors.gstRate : undefined}
            >
              {(a) => (
                <div className="number-unit">
                  <input
                    {...a}
                    inputMode="decimal"
                    autoComplete="off"
                    value={gst}
                    onChange={(e) => setGst(e.target.value)}
                  />
                  <span className="number-unit__unit" aria-hidden="true">
                    %
                  </span>
                </div>
              )}
            </FormField>
          </>
        ) : (
          <p className="hint">{DOC_ERRORS.line_tax_fixed}</p>
        )}
      </div>
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary">
          Done
        </button>
      </div>
    </form>
  );
}
