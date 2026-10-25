// The seeded templates (M4.1, ADM-CAT-03). Only the section headings of ADM-PROP-02 and placeholders: the proposal wording is
// copy and comes with M4.3 (07-L), as a new version of each template (templates are append-only; an edit is a new version).
// Proposal and estimate: one per category. Care-plan block and terms block: one each, with no category.
import { CATALOGUE_CATEGORIES, type TemplateBody } from "@techaust/core/catalogue";

export type SeedTemplate = {
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

export const SEED_TEMPLATES: readonly SeedTemplate[] = [
  ...CATALOGUE_CATEGORIES.map((category) => ({ kind: "proposal" as const, category, body: PROPOSAL })),
  ...CATALOGUE_CATEGORIES.map((category) => ({ kind: "estimate" as const, category, body: ESTIMATE })),
  { kind: "care_block", category: null, body: CARE },
  { kind: "terms_block", category: null, body: TERMS },
];
