// What happens to a sent offer, for the staff page (M4.5; ADM-PROP-07..10): who it went to and how far each email got, who accepted and how, the
// certificate, a decline's reason, and the dialog numbers of "Start project". The statements ride in the ONE batch of `readContext` (a D1 call
// costs CPU on the Free plan), and `offerSection` shapes their rows. Read only; nothing here writes.
//
// The IP address and the browser of an acceptance are shown to the owner only (LD8): they are evidence, and not every member needs them.
import type { Role } from "@techaust/core/permissions";
import type { readContext } from "./documents.ts";
import { readSettings, todayIst } from "./quote-model.ts";
import { planStartProject, type StartPlan } from "./start-project-plan.ts";

type Context = NonNullable<Awaited<ReturnType<typeof readContext>>>;

/**
 * The plan of "Start project" for an accepted proposal. ONE function for the route (`document-start.ts`) and for the page's dialog numbers
 * (`startProject` in the document view), so the figures the dialog shows are the figures the route writes.
 */
export function startPlanOf(ctx: Pick<Context, "bundle" | "client" | "settingsRows">): StartPlan {
  const d = ctx.bundle.document;
  return planStartProject({
    proposal: {
      currency: d.currency === "USD" ? "USD" : "INR",
      total_minor: d.total_minor,
      export_mode: d.export_mode,
      computed: d.computed,
    },
    schedule: ctx.bundle.schedule.map((s) => ({
      label: s.label,
      trigger: s.trigger,
      pct_bp: s.pct_bp,
      amount_minor: s.amount_minor,
      target_date: s.target_date,
    })),
    client: ctx.client,
    settings: readSettings(ctx.settingsRows),
    today: todayIst(),
  });
}

const GROUP = "(SELECT version_group_id FROM documents WHERE id = ?1)";

/** The group's send rows (every version), newest first. `email_log` status of the offer email by the row's id (index `email_log_entity`). */
export const DELIVERY_SQL = `SELECT s.id, d.version, s.kind, s.queued_at, s.created_at, s.attach_pdf, s.email, c.name AS contact_name,
  (SELECT e.status FROM email_log e WHERE e.entity_type = 'document_send' AND e.entity_id = s.id AND e.template = 'offer.sent' ORDER BY e.created_at DESC LIMIT 1) AS email_status
  FROM document_sends s JOIN documents d ON d.id = s.document_id LEFT JOIN contacts c ON c.id = s.contact_id
  WHERE d.version_group_id = ${GROUP} ORDER BY s.created_at DESC, s.id DESC LIMIT 50`;

export const ACCEPTANCE_SQL = `SELECT a.id, a.document_id, a.typed_name, a.email, a.accepted_at, a.via, a.ip, a.user_agent, a.country, a.pdf_sha256, a.snapshot_sha256, ce.rendered_at, c.name AS contact_name
  FROM acceptances a JOIN documents d ON d.id = a.document_id LEFT JOIN acceptance_certificates ce ON ce.acceptance_id = a.id LEFT JOIN contacts c ON c.id = a.contact_id
  WHERE d.version_group_id = ${GROUP} LIMIT 1`;

export const DECISION_SQL = `SELECT d.id, d.status, d.decided_at, d.decision_reason, d.decision_note, dc.name AS contact_name
  FROM documents d LEFT JOIN contacts dc ON dc.id = d.decided_contact_id
  WHERE d.version_group_id = ${GROUP} AND d.decided_at IS NOT NULL ORDER BY d.version DESC LIMIT 1`;

export const PROJECT_SQL = "SELECT id, code FROM projects WHERE source_document_id = ?1";

/** The four reads, bound to the document id (`?1`). */
export const offerStatements = (db: D1Database, id: string): D1PreparedStatement[] => [
  db.prepare(DELIVERY_SQL).bind(id),
  db.prepare(ACCEPTANCE_SQL).bind(id),
  db.prepare(DECISION_SQL).bind(id),
  db.prepare(PROJECT_SQL).bind(id),
];

type Rows = D1Result<unknown> | undefined;
const rowsOf = (r: Rows): Record<string, unknown>[] => (r?.results ?? []) as Record<string, unknown>[];

export type DeliveryState =
  | "waiting_pdf"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  | "skipped";

/** One send row: `waiting_pdf` while the PDF is not stored, else what `email_log` says (`queued` before the consumer has written a row). */
export const deliveryState = (queuedAt: number | null, emailStatus: string | null): DeliveryState =>
  queuedAt === null && emailStatus === null ? "waiting_pdf" : ((emailStatus ?? "queued") as DeliveryState);

export type OfferSection = {
  delivery: {
    id: string;
    version: number;
    kind: string;
    contactName: string | null;
    email: string | null;
    attachPdf: boolean;
    state: DeliveryState;
    at: number;
  }[];
  acceptance: {
    id: string;
    documentId: string;
    contactName: string | null;
    typedName: string;
    email: string;
    acceptedAt: number;
    via: string | null;
    country: string | null;
    pdfSha256: string;
    snapshotSha256: string | null;
    /** Owner only. */
    ip?: string | null;
    userAgent?: string | null;
  } | null;
  certificate: { state: "none" | "pending" | "ready" };
  decision: {
    status: string;
    at: number;
    reason: string | null;
    note: string | null;
    contactName: string | null;
  } | null;
  startProject: {
    project: { id: string; code: string } | null;
    milestones: number;
    firstInstalment: { type: string; amountMinor: number; pctBp: number; trigger: string } | null;
    reason?: string;
  } | null;
};

/** Shapes the four results (in `offerStatements` order). `plan` is the start-project plan of an accepted proposal, from the same function as the route. */
export function offerSection(
  results: readonly Rows[],
  opts: { role: Role; plan: StartPlan | null },
): OfferSection {
  const [deliveryR, acceptanceR, decisionR, projectR] = results;
  const a = rowsOf(acceptanceR)[0];
  const dec = rowsOf(decisionR)[0];
  const project = rowsOf(projectR)[0];
  const plan = opts.plan;
  return {
    delivery: rowsOf(deliveryR).map((r) => ({
      id: r.id as string,
      version: r.version as number,
      kind: r.kind as string,
      contactName: (r.contact_name as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      attachPdf: r.attach_pdf === 1,
      state: deliveryState((r.queued_at as number | null) ?? null, (r.email_status as string | null) ?? null),
      at: r.created_at as number,
    })),
    acceptance: a
      ? {
          id: a.id as string,
          documentId: a.document_id as string,
          contactName: (a.contact_name as string | null) ?? null,
          typedName: a.typed_name as string,
          email: a.email as string,
          acceptedAt: a.accepted_at as number,
          via: (a.via as string | null) ?? null,
          country: (a.country as string | null) ?? null,
          pdfSha256: a.pdf_sha256 as string,
          snapshotSha256: (a.snapshot_sha256 as string | null) ?? null,
          ...(opts.role === "owner"
            ? {
                ip: (a.ip as string | null) ?? null,
                userAgent: (a.user_agent as string | null) ?? null,
              }
            : {}),
        }
      : null,
    certificate: {
      state: !a ? "none" : a.rendered_at === null || a.rendered_at === undefined ? "pending" : "ready",
    },
    decision: dec
      ? {
          status: dec.status as string,
          at: dec.decided_at as number,
          reason: (dec.decision_reason as string | null) ?? null,
          note: (dec.decision_note as string | null) ?? null,
          contactName: (dec.contact_name as string | null) ?? null,
        }
      : null,
    startProject:
      plan === null
        ? null
        : {
            project: project ? { id: project.id as string, code: project.code as string } : null,
            milestones: plan.ok ? plan.milestones.length : 0,
            firstInstalment:
              plan.ok && plan.firstInstalment
                ? {
                    type: plan.firstInstalment.type,
                    amountMinor: plan.firstInstalment.amountMinor,
                    pctBp: plan.firstInstalment.pctBp,
                    trigger: plan.firstInstalment.trigger,
                  }
                : null,
            ...(plan.ok ? (plan.reason ? { reason: plan.reason } : {}) : { reason: plan.code }),
          },
  };
}
