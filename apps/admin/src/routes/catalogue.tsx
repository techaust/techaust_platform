// The Catalogue section (M4.1, ADM-CAT-01..05; replaces the M3.1 "coming soon"): one page with three tabs kept in the URL
// (`?tab=`), as on the client page: Services (the list), Templates (by kind and category) and Publish to website. Every role
// reads all three; only the owner adds, edits and publishes (the API decides the same from the 04 §9 matrix).
import { Link, useSearchParams } from "react-router";
import { PageHeader } from "../components/display.tsx";
import { Plus } from "../components/icons.tsx";
import { type TabItem, Tabs } from "../components/tabs.tsx";
import { COPY } from "../lib/catalogue.ts";
import { CatalogueGate, useCanWrite } from "./catalogue/parts.tsx";
import { PublishTab } from "./catalogue/publish.tsx";
import { ServicesTab } from "./catalogue/services.tsx";
import { TemplatesTab } from "./catalogue/templates.tsx";

type TabKey = "services" | "templates" | "publish";
const TABS: TabItem<TabKey>[] = [
  { key: "services", label: "Services" },
  { key: "templates", label: "Templates" },
  { key: "publish", label: "Publish to website" },
];

export function Component() {
  return (
    <CatalogueGate>
      <Catalogue />
    </CatalogueGate>
  );
}

function Catalogue() {
  const canWrite = useCanWrite();
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === asked) ? (asked as TabKey) : "services";
  // A tab change starts from a clean query (the list's filters belong to the Services tab).
  const select = (k: TabKey) => setParams(k === "services" ? {} : { tab: k }, { replace: true });
  return (
    <>
      <PageHeader
        title="Catalogue"
        lede={COPY.listIntro}
        action={
          canWrite && tab === "services" ? (
            <Link to="/catalogue/new" className="btn btn--primary">
              <Plus />
              New service
            </Link>
          ) : undefined
        }
      />
      <Tabs label="Catalogue sections" tabs={TABS} selected={tab} onSelect={select}>
        {tab === "services" ? <ServicesTab /> : tab === "templates" ? <TemplatesTab /> : <PublishTab />}
      </Tabs>
    </>
  );
}
