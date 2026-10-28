// The seeded templates (M4.1, ADM-CAT-03). Version 1 has only the section headings of ADM-PROP-02 and placeholders. Version 2 (M4.3 review
// fix 7) carries the wording of docs/07-content-appendix/O-m4.3-proposal-screens.md section 1, word for word, as a NEW version of each template
// (templates are append-only; an edit is a new version, and a draft takes the newest version). Keys never change.
// VERIFY WITH CA/LEGAL: "This is an estimate, not a tax invoice." Proposal and estimate: one per category. Care-plan block and terms block: one
// each, with no category.
import { CATALOGUE_CATEGORIES, type TemplateBody } from "@techaust/core/catalogue";

export type SeedTemplate = {
  version: number;
  kind: "proposal" | "estimate" | "care_block" | "terms_block";
  category: string | null;
  body: TemplateBody;
};

const section = (key: string, heading: string, body = "") => ({ key, heading, body });

/** The ADM-PROP-02 sections, in order. The estimate, terms and acceptance sections are always present in a proposal. */
const PROPOSAL: TemplateBody = {
  sections: [
    section("cover", "Cover", "{{client.name}}\n{{service.name}}"),
    section("summary", "Summary"),
    section("problem_goals", "Problem and goals"),
    section("scope", "Scope", "{{service.short}}"),
    section("deliverables", "Deliverables", "{{service.deliverables}}"),
    section("timeline", "Timeline (milestones)"),
    section("team", "Team (roles)"),
    section("estimate", "Estimate", "{{service.schedule}}"),
    section(
      "assumptions_exclusions",
      "Assumptions and exclusions",
      "{{service.assumptions}}\n{{service.exclusions}}",
    ),
    section("terms", "Terms"),
    section("acceptance", "Acceptance", "{{client.contact}}"),
  ],
};
const ESTIMATE: TemplateBody = {
  sections: [
    section("estimate", "Estimate", "{{service.name}}"),
    section("schedule", "Payment schedule", "{{service.schedule}}"),
  ],
};
const CARE: TemplateBody = { sections: [section("care_plan", "Care plan", "{{client.name}}")] };
const TERMS: TemplateBody = { sections: [section("terms", "Terms", "{{company.name}}")] };

const V1: readonly SeedTemplate[] = [
  ...CATALOGUE_CATEGORIES.map((category) => ({
    version: 1,
    kind: "proposal" as const,
    category,
    body: PROPOSAL,
  })),
  ...CATALOGUE_CATEGORIES.map((category) => ({
    version: 1,
    kind: "estimate" as const,
    category,
    body: ESTIMATE,
  })),
  { version: 1, kind: "care_block", category: null, body: CARE },
  { version: 1, kind: "terms_block", category: null, body: TERMS },
];

// ---- version 2: the wording of 07-O section 1 ----------------------------------------------------------------------------------

type Category = (typeof CATALOGUE_CATEGORIES)[number];

/** The first line of the Summary, by category (07-O section 1). */
const SUMMARY_LINE: Record<Category, string> = {
  advise:
    "{{client.name}} asked us for {{service.name}}. This proposal sets out what we'll look at, what you'll receive and what it costs.",
  build:
    "This proposal covers {{service.name}} for {{client.name}}: what we'll build, how we'll deliver it in stages, and the fixed price for the written scope.",
  automate:
    "This proposal covers {{service.name}} for {{client.name}}: what we'll automate, how we'll measure it in a pilot, and the price.",
  connect:
    "This proposal covers {{service.name}} for {{client.name}}: which systems we'll connect, how data will move between them, and the price.",
  run: "This proposal covers {{service.name}} for {{client.name}}: the support we'll provide each month and the monthly price.",
};

/**
 * The Terms section's own text stays empty: the sentence "The terms below are version {terms version} of our proposal terms." is filled by the
 * screen and the PDF from the version the document is pinned to (07-O marks it `{...}`, not `{{...}}`). Stored in the text it would go stale
 * when a draft adopts newer terms. The sections "written per proposal" (Problem and goals, Timeline, Team) stay empty on purpose: the editor
 * asks staff to write them or hide them, and a send is blocked until they do (`section_empty`).
 */
const proposalV2 = (category: Category): TemplateBody => ({
  sections: [
    section("cover", "Cover", "{{client.name}}\n{{service.name}}\nProposal from {{company.name}}"),
    section("summary", "Summary", SUMMARY_LINE[category]),
    section("problem_goals", "Problem and goals"),
    section(
      "scope",
      "Scope",
      "{{service.short}}\n\nThe price covers the written scope. If you want something new, we quote it before doing it, and you decide.",
    ),
    section("deliverables", "Deliverables", "{{service.deliverables}}"),
    section("timeline", "Timeline (milestones)"),
    section("team", "Team (roles)"),
    section("estimate", "Estimate", "Payment schedule: {{service.schedule}}"),
    section(
      "assumptions_exclusions",
      "Assumptions and exclusions",
      "{{service.assumptions}}\n{{service.exclusions}}",
    ),
    section("terms", "Terms"),
    section(
      "acceptance",
      "Acceptance",
      'Prepared for {{client.contact}}.\n\nTo accept, open this proposal in the client portal, type your full name and tick "I have read and agree to the terms". This proposal is valid for {{proposal.validity_days}} days from the date it\'s sent.',
    ),
  ],
});

/** One wording for all five categories. The payment schedule itself is the table under Estimate. */
const ESTIMATE_V2: TemplateBody = {
  sections: [
    section(
      "estimate",
      "Estimate",
      "Estimate for {{service.name}}, prepared for {{client.name}}.\n\nThis is an estimate, not a tax invoice.",
    ),
    section(
      "schedule",
      "Validity",
      "This estimate is valid for {{proposal.validity_days}} days from the date it's sent.",
    ),
  ],
};
const CARE_V2: TemplateBody = {
  sections: [
    section(
      "care_plan",
      "Care plan",
      "Care plans are paid monthly in advance. Hours above the included hours are charged at the overage rate, before GST. Price and hours changes take effect from the next billing period.",
    ),
  ],
};
/**
 * Version 3 of the care-plan block (research round 2026-10-28; 07-U §9; Researched 2026-10-28, 08-C RA-24): the V2 text with one sentence added, "Extra hours are invoiced on the next monthly
 * invoice and are due with it." (s.31(5) CGST Act: a continuous supply is invoiced on or before its due date; overage hours are charged at the plan's SAC and rate). A NEW version, never an edit.
 */
const CARE_V3: TemplateBody = {
  sections: [
    section(
      "care_plan",
      "Care plan",
      "Care plans are paid monthly in advance. Hours above the included hours are charged at the overage rate, before GST. Extra hours are invoiced on the next monthly invoice and are due with it. Price and hours changes take effect from the next billing period.",
    ),
  ],
};
const TERMS_V2: TemplateBody = {
  sections: [section("terms", "Terms", "These terms are part of the proposal from {{company.name}}.")],
};

const V2: readonly SeedTemplate[] = [
  ...CATALOGUE_CATEGORIES.map((category) => ({
    version: 2,
    kind: "proposal" as const,
    category,
    body: proposalV2(category),
  })),
  ...CATALOGUE_CATEGORIES.map((category) => ({
    version: 2,
    kind: "estimate" as const,
    category,
    body: ESTIMATE_V2,
  })),
  { version: 2, kind: "care_block", category: null, body: CARE_V2 },
  { version: 2, kind: "terms_block", category: null, body: TERMS_V2 },
];

const V3: readonly SeedTemplate[] = [{ version: 3, kind: "care_block", category: null, body: CARE_V3 }];

export const SEED_TEMPLATES: readonly SeedTemplate[] = [...V1, ...V2, ...V3];
