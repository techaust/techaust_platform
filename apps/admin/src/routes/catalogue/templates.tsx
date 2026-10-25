// The Templates tab (M4.1, ADM-CAT-03): the newest version of each template, by category (a proposal and an estimate for each)
// and the two blocks without a category (care plan and terms). Each cell opens that version; older versions are listed on its
// page. Cards below md (DataTable).
import { Link } from "react-router";
import { type CatalogueCategory, catalogueApi, type TemplateKind, type TemplateMeta } from "../../api.ts";
import { type Column, DataTable } from "../../components/data-table.tsx";
import { When } from "../../components/display.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { CATEGORIES, CATEGORY_LABELS, COPY, KIND_LABELS } from "../../lib/catalogue.ts";

type Row = { key: string; label: string; cells: Partial<Record<TemplateKind, TemplateMeta | undefined>> };

export function TemplatesTab() {
  const list = useLoad(() => catalogueApi.templates(), "templates");
  const loading = list.state === "loading";
  const all = list.state === "ready" ? list.data.templates : [];
  const of = (kind: TemplateKind, category: CatalogueCategory | null) =>
    all.find((t) => t.kind === kind && t.category === category);
  const byCategory: Row[] = CATEGORIES.map((c) => ({
    key: c,
    label: CATEGORY_LABELS[c],
    cells: { proposal: of("proposal", c), estimate: of("estimate", c) },
  }));
  const blocks: Row[] = (["care_block", "terms_block"] as const).map((k) => ({
    key: k,
    label: KIND_LABELS[k],
    cells: { [k]: of(k, null) },
  }));

  const cell = (kind: TemplateKind) => (r: Row) => <VersionCell meta={r.cells[kind]} />;
  const categoryColumns: Column<Row>[] = [
    { key: "category", header: "Category", card: "title", width: "24%", cell: (r) => r.label },
    { key: "proposal", header: KIND_LABELS.proposal, cell: cell("proposal") },
    { key: "estimate", header: KIND_LABELS.estimate, cell: cell("estimate") },
  ];
  const blockColumns: Column<Row>[] = [
    { key: "block", header: "Block", card: "title", width: "24%", cell: (r) => r.label },
    {
      key: "version",
      header: "Version",
      cell: (r) => <VersionCell meta={r.cells.care_block ?? r.cells.terms_block} />,
    },
  ];

  return (
    <div className="templates">
      <p className="templates__intro">{COPY.templatesIntro}</p>
      {list.state === "failed" ? (
        <LoadFailed error={list.error} onRetry={() => list.reload()} />
      ) : (
        <>
          <section aria-labelledby="tpl-cat-h" className="templates__group">
            <h2 id="tpl-cat-h" className="templates__h">
              Proposals and estimates
            </h2>
            <DataTable
              caption="Proposal and estimate templates"
              columns={categoryColumns}
              rows={byCategory}
              rowKey={(r) => r.key}
              loading={loading}
              skeletonRows={5}
            />
          </section>
          <section aria-labelledby="tpl-block-h" className="templates__group">
            <h2 id="tpl-block-h" className="templates__h">
              Care plan and terms blocks
            </h2>
            <DataTable
              caption="Care plan and terms blocks"
              columns={blockColumns}
              rows={blocks}
              rowKey={(r) => r.key}
              loading={loading}
              skeletonRows={2}
            />
          </section>
        </>
      )}
    </div>
  );
}

/** "Version 3" (a link to it) and when it was saved; the 07-L line when there is none. */
function VersionCell({ meta }: { meta: TemplateMeta | undefined }) {
  if (!meta) return <span className="muted">{COPY.templatesEmpty}</span>;
  return (
    <span className="tpl-cell">
      <Link className="tpl-cell__link" to={`/catalogue/templates/${meta.id}`}>
        Version {meta.version}
        <span className="visually-hidden">
          {" "}
          of the {meta.category ? `${CATEGORY_LABELS[meta.category]} ` : ""}
          {KIND_LABELS[meta.kind].toLowerCase()}
        </span>
      </Link>
      <When ms={meta.createdAt} inline />
    </span>
  );
}
