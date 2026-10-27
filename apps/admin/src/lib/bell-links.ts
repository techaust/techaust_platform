// Where an M5.5b bell lands (07-V §9; the titles are written by the jobs Worker). Tiny on purpose: the shell imports it on every page.

/**
 * Where a bell lands: an export stage on the realisation list with that invoice marked; the EDF reminder on its month; a statement PDF on the client's
 * statement tab, which picks the PDF up by its id. A link that already carries what it needs is left as the jobs Worker wrote it.
 */
export function reportBellHref(kind: string, link: string): string {
  if (kind.startsWith("export.") && link.startsWith("/invoices/")) {
    const id = link.slice("/invoices/".length).split(/[?#]/)[0] ?? "";
    return `/reports/realisation?doc=${id}`;
  }
  return link;
}
