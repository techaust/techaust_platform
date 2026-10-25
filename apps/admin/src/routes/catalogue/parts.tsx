// Pieces the Catalogue screens share (M4.1, ADM-CAT-01..05): the access gate, the breadcrumbs, the status pills, the price
// cell, the payment schedule (a proportional bar over the steps, with the website's own sentence), and a template text with its
// placeholders drawn as tokens. The styles are catalogue.css (with the M3.2/M3.3 panels from leads.css and clients.css), loaded
// with these screens only.
import "../../leads.css";
import "../../clients.css";
import "../../catalogue.css";
import type { ReactNode } from "react";
import type { CatalogueListItem, EntryStep } from "../../api.ts";
import { StatusPill } from "../../components/display.tsx";
import { NoAccess } from "../../components/states.tsx";
import { allowed } from "../../lib/access.ts";
import {
  priceText,
  STATUS_LABELS,
  scheduleWords,
  splitPlaceholders,
  TRIGGER_LABELS,
} from "../../lib/catalogue.ts";
import { bpToPercent } from "../../lib/settings-form.ts";
import { useUser } from "../../session.tsx";

export const CRUMBS = [{ label: "Catalogue", to: "/catalogue" }];
export const TEMPLATE_CRUMBS = [
  { label: "Catalogue", to: "/catalogue" },
  { label: "Templates", to: "/catalogue?tab=templates" },
];

/** Every role reads the catalogue (04 §9); the gate is here so a future change of the matrix needs no screen change. */
export function CatalogueGate({ children }: { children: ReactNode }) {
  const user = useUser();
  return allowed(user.role, "catalogue.read") ? children : <NoAccess what="The catalogue" />;
}

/** Only the owner adds, edits and retires (catalogue.write). */
export function useCanWrite() {
  return allowed(useUser().role, "catalogue.write");
}

/** Only the owner publishes prices to the website (catalogue.publish, a separate action from catalogue.write). */
export function useCanPublish() {
  return allowed(useUser().role, "catalogue.publish");
}

/** Retired, and not on the website: icon and text, never colour alone. Active and on the website are the quiet default. */
export function ItemPills({ item }: { item: Pick<CatalogueListItem, "active" | "showOnSite"> }) {
  return (
    <>
      {!item.active && (
        <StatusPill tone="muted" icon="ban">
          {STATUS_LABELS.retired}
        </StatusPill>
      )}
      {!item.showOnSite && (
        <StatusPill tone="neutral" icon="lock">
          {STATUS_LABELS.offSite}
        </StatusPill>
      )}
    </>
  );
}

/** The two "from" prices, one per line, tabular; a currency not offered is left out (no dash, no zero). */
export function Prices({ inr, usd }: { inr: number | null; usd: number | null }) {
  if (inr === null && usd === null) return null;
  return (
    <span className="prices">
      {inr !== null && <span className="prices__amt">{priceText(inr, "INR")}</span>}
      {usd !== null && <span className="prices__amt">{priceText(usd, "USD")}</span>}
    </span>
  );
}

/**
 * The schedule as one ruled bar: each step's width is its share, in turn ink and verdigris. A share still missing (under
 * 100 %) is a dashed gap at the end; over 100 % the bar is full and the total says so. The bar is a picture of the list
 * below it (hidden from assistive tech, which reads the list and the total).
 */
export function ScheduleBar({ steps }: { steps: { pctBp: number | null }[] }) {
  const total = steps.reduce((a, s) => a + (s.pctBp ?? 0), 0);
  const scale = Math.max(total, 10_000);
  const gap = Math.max(0, 10_000 - total);
  return (
    <div className="sched-bar" aria-hidden="true">
      {steps.map((s, i) =>
        s.pctBp ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the steps in their order; the bar is redrawn whole
            key={i}
            className="sched-bar__seg"
            data-alt={i % 2 === 1 || undefined}
            style={{ flexGrow: s.pctBp / scale }}
          />
        ) : null,
      )}
      {gap > 0 && <span className="sched-bar__gap" style={{ flexGrow: gap / scale }} />}
    </div>
  );
}

/** The stored schedule, read-only: the website's sentence, the bar, and the steps. */
export function ScheduleView({ steps }: { steps: EntryStep[] }) {
  const words = scheduleWords(steps);
  return (
    <div className="sched">
      {words && <p className="sched__words">{words}</p>}
      <ScheduleBar steps={steps} />
      <ol className="sched__steps">
        {steps.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: stored steps in their order
          <li key={i} className="sched__step">
            <span className="sched__pct">{bpToPercent(s.pctBp)} %</span>
            <span className="sched__label">{s.label}</span>
            <span className="sched__when">{TRIGGER_LABELS[s.trigger]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A template text with its placeholders drawn as tokens; line breaks kept. Plain text: never parsed as HTML. */
export function PlaceholderText({
  text,
  unknown,
}: {
  text: string;
  unknown?: readonly string[] | undefined;
}) {
  const parts = splitPlaceholders(text);
  return (
    <span className="ph-text">
      {parts.map((p, i) =>
        p.placeholder ? (
          <code
            // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one text, in order
            key={i}
            className="ph"
            data-unknown={unknown?.some((u) => p.text.includes(u)) || undefined}
          >
            {p.text}
          </code>
        ) : (
          p.text
        ),
      )}
    </span>
  );
}
