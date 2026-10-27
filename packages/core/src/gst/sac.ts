// SAC descriptions for the HSN tables of GSTR-1 and the EDF list (M5.5b; ADM-REP-04). A frozen copy of docs/08-research-appendix/
// A-gst-invoicing.md §2 (the "Scheme of Classification of Services", Notification 11/2017-CTR; the code order is inferred from the
// group sequence there). VERIFY WITH CA/LEGAL. A SAC that is not listed gets a blank description and the warning
// `hsn_description_missing`: nothing is guessed.
export const SAC_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  "998311": "Management consulting and management services",
  "998312": "Business consulting, including PR",
  "998313": "IT consulting and support services",
  "998314": "IT design and development services",
  "998315": "Hosting and IT infrastructure provisioning services",
  "998316": "IT infrastructure and network management services",
  "998319": "Other IT services n.e.c.",
  "998391": "Specialty design services",
  "997331": "Licensing services for the right to use computer software and databases",
  "998434": "Software downloads (on-line content)",
  "998713": "Maintenance and repair of computers and peripheral equipment",
});
