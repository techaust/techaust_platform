// A new proposal or estimate draft, built from services (M4.3; ADM-PROP-01, ADM-LEAD-04): the one builder for the create route, the revision of
// a sent version's rows, and the lead convert (M3.2), so a draft always has its group, its template sections, server-built lines, its
// schedule and the newest terms. The statements it returns go into the caller's own batch.

import { placeholdersOf, renderTemplateBody, type TemplateBody } from "@techaust/core/catalogue";
import type { TaxInput } from "@techaust/core/clients";
import type { CalendarDate } from "@techaust/core/dates";
import { sectionsFromTemplate } from "@techaust/core/documents";
import { uuidv7 } from "@techaust/core/ids";
import { divRoundHalfUp } from "@techaust/core/money";
import type { ScheduleTrigger } from "@techaust/core/schedule-text";
import type { ApiError } from "./context.ts";
import {
  type Computation,
  computeQuote,
  DEFAULT_LINE_DUPLICATE,
  type DocState,
  draftColumns,
  type ItemRow,
  insertChildren,
  insertDocument,
  itemLines,
  LINES_MAX,
  type LineState,
  lineName,
  lineRows,
  type QuoteSettings,
  type Refusal,
  SERVICE_DUPLICATE,
  type StepState,
  scheduleRows,
  scheduleSentence,
  sectionRows,
  TOO_MANY_LINES,
  taxContext,
} from "./quote-model.ts";
import { appendedText, emptyServiceTokens, serviceData } from "./service-fill.ts";

/** What a draft needs to know of its client: for the lead convert the client does not exist yet, so this is not a database row. */
export type ClientFacts = {
  id: string;
  displayName: string;
  currency: "INR" | "USD";
  tax: TaxInput;
};

export type ServiceChoice = { item: ItemRow; chosen?: readonly string[] | undefined };

export type NewDraftInput = {
  id: string;
  type: "proposal" | "estimate";
  client: ClientFacts;
  contact: { id: string; name: string } | null;
  title: string | null;
  services: readonly ServiceChoice[];
  /** The newest template of (kind = type, category = the first service's category), or null. */
  template: unknown;
  settings: QuoteSettings;
  newestTermsId: string | null;
  today: CalendarDate;
  /** Convert from a lead: a service that needs a choice of lines gets none (the person chooses in the editor) instead of a 400. */
  lenientLines?: boolean;
  /** Convert from a lead: what the lead wrote, added to the scope section. */
  leadMessage?: string | null;
};

type StepJson = { label: string; pctBp: number; trigger: ScheduleTrigger };

function parseSteps(json: string): StepJson[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as StepJson[]) : [];
  } catch {
    return [];
  }
}

/** The labels of the settings' build schedule get a trigger by place: the first on acceptance, the last on delivery, the rest milestones. */
export function stepsFromBuildSchedule(steps: readonly { label: string; pctBp: number }[]): StepJson[] {
  return steps.map((s, i) => ({
    label: s.label,
    pctBp: s.pctBp,
    trigger: (i === 0 ? "on_accept" : i === steps.length - 1 ? "delivery" : "milestone") as ScheduleTrigger,
  }));
}

/** Σ quantity × rate of a service's lines, each rounded half up like the engine's lines (bigint: the product can pass 2^53). */
export const referenceOf = (lines: readonly LineState[]) =>
  lines.reduce((a, l) => a + divRoundHalfUp(BigInt(l.qtyMilli) * BigInt(l.rateMinor), 1000n), 0n);

function readTemplate(raw: unknown): TemplateBody | null {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (v && typeof v === "object" && Array.isArray((v as TemplateBody).sections)) return v as TemplateBody;
  } catch {
    // fall through
  }
  return null;
}

export type NewDraft = { ok: true; state: DocState; computation: Computation } | ({ ok: false } & Refusal);

export async function buildNewDraft(i: NewDraftInput): Promise<NewDraft> {
  const { settings } = i;
  const lines: LineState[] = [];
  let best: { ref: bigint; item: ItemRow } | null = null;
  // One service once, and each of its default lines once: asking twice for the same thing made duplicate lines (10 services x 30 lines).
  const seenServices = new Set<string>();
  for (const s of i.services) {
    if (seenServices.has(s.item.id)) return { ok: false, error: SERVICE_DUPLICATE, status: 400 };
    seenServices.add(s.item.id);
    if (s.chosen && new Set(s.chosen).size !== s.chosen.length)
      return { ok: false, error: DEFAULT_LINE_DUPLICATE, status: 400 };
    const made = itemLines(s.item, i.client.currency, s.chosen, settings.tax.defaultRateBp);
    if (!made.ok) {
      // A lead convert never fails on the catalogue: a service that needs a choice of lines, or has no price in this currency, gives its sections and schedule and no lines.
      if (
        i.lenientLines &&
        (made.error.code === "choose_default_lines" || made.error.code === "service_not_priced")
      ) {
        best ??= { ref: 0n, item: s.item };
        continue;
      }
      return made;
    }
    lines.push(...made.lines);
    if (lines.length > LINES_MAX) return { ok: false, error: TOO_MANY_LINES, status: 400 };
    const ref = referenceOf(made.lines);
    if (!best || ref > best.ref) best = { ref, item: s.item };
  }
  const first = i.services[0]?.item;
  // The schedule of the service with the largest reference amount; else the settings' build schedule (100 % on acceptance under the small-job threshold).
  let steps: StepJson[];
  if (best) steps = parseSteps(best.item.schedule);
  else steps = [];
  if (steps.length === 0) {
    const small =
      lines.length > 0 &&
      referenceOf(lines) < BigInt(settings.paymentTerms.smallJobThreshold[i.client.currency]);
    steps = small
      ? [{ label: "On acceptance", pctBp: 10_000, trigger: "on_accept" }]
      : stepsFromBuildSchedule(settings.paymentTerms.buildSchedule);
  }
  const schedule: StepState[] = steps.map((s) => ({
    id: uuidv7(),
    label: s.label,
    trigger: s.trigger,
    pctBp: s.pctBp,
    detail: null,
    targetDate: null,
  }));

  // Sections: the template rendered with the client, the company and the first service; the other services add their texts.
  const tpl = readTemplate(i.template);
  const data: Record<string, string | number | null | undefined> = {
    "client.name": i.client.displayName,
    "client.contact": i.contact?.name ?? null,
    "company.name": settings.company.tradeName,
    "proposal.validity_days": settings.paymentTerms.proposalValidityDays,
    ...serviceData(first ?? null),
    "service.schedule": scheduleSentence(steps),
  };
  // A service with no text for a token makes it EMPTY (taken out, section hidden); no service at all leaves it UNKNOWN (kept, filled by the
  // save that adds the first service line). See service-fill.ts.
  const empty = emptyServiceTokens(first ?? null);
  const rendered = tpl ? renderTemplateBody(tpl, data, { empty }).sections : [];
  const emptiedKeys = new Set(
    (tpl?.sections ?? [])
      .filter((s) => placeholdersOf(`${s.heading}\n${s.body}`).some((n) => empty.has(n)))
      .map((s) => s.key),
  );
  const drafts = sectionsFromTemplate(rendered);
  // Mutable copies: the other services' texts are appended to them below.
  const sections: {
    id: string;
    kind: string;
    title: string | null;
    bodyMd: string | null;
    hidden: boolean;
  }[] = drafts.map((s) => ({ ...s, id: uuidv7() }));
  const append = (kind: string, text: string) => {
    const at = sections.find((s) => s.kind === kind);
    if (at) at.bodyMd = at.bodyMd ? `${at.bodyMd}\n\n${text}` : text;
  };
  for (const s of i.services.slice(1)) {
    const d = appendedText("deliverables", s.item);
    if (d !== null) append("deliverables", d);
    const aex = appendedText("assumptions_exclusions", s.item);
    if (aex !== null) append("assumptions_exclusions", aex);
  }
  // A section whose template text was only empty tokens and that no service filled is created hidden.
  for (const s of sections) if (s.bodyMd === null && emptiedKeys.has(s.kind)) s.hidden = true;
  if (i.leadMessage) {
    if (sections.some((s) => s.kind === "scope")) append("scope", i.leadMessage);
    // No scope section in the template (or no template): what the lead wrote is the scope, under the service's name (the M3.2 behaviour).
    else
      sections.unshift({ id: uuidv7(), kind: "scope", title: i.title, bodyMd: i.leadMessage, hidden: false });
  }

  const state: DocState = {
    id: i.id,
    type: i.type,
    clientId: i.client.id,
    contactId: i.contact?.id ?? null,
    title: i.title ?? (first ? lineName(first.name) : null),
    currency: i.client.currency,
    validityDays: settings.paymentTerms.proposalValidityDays,
    termsVersionId: i.newestTermsId,
    discountKind: null,
    discountValue: null,
    exportMode: null,
    lines,
    sections,
    schedule,
  };
  const computation = await computeQuote(state, i.client.tax, taxContext(settings), i.today);
  return { ok: true, state, computation };
}

/**
 * The statements that write a new draft: `main` is the documents INSERT (written only while `guard` holds), `children(g)` the lines,
 * sections and schedule, each written only while `g` holds (the request's audit row, or a condition of the caller's batch).
 */
export function newDraftStatements(
  db: D1Database,
  state: DocState,
  c: Computation,
  meta: { groupId: string; version: number; createdBy: string; now: number },
  guard: { sql: (at: number) => string; params: readonly unknown[] },
) {
  return {
    main: insertDocument(db, draftColumns(state, c, meta), guard),
    children: (g: { sql: (at: number) => string; params: readonly unknown[] }) => [
      ...insertChildren(db, "document_lines", state.id, lineRows(state, c), g),
      ...insertChildren(db, "document_sections", state.id, sectionRows(state), g),
      ...insertChildren(db, "payment_schedules", state.id, scheduleRows(state, c), g),
    ],
  };
}

export type { ApiError };
