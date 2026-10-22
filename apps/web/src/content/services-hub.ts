// The services hub (/services): docs/07-content.md §5.1, word for word, with the groups and their order from 07 §2.1
// (the services menu). Each group lists catalogue codes; the page shows only those on the site (S3 is hidden while
// its flag is off, WEB-SVCHUB, WEB-G-17). One-liners: 07 §5.1 has none per service, so each item shows the 07 §3 home
// one-liner where 07 has one, else the page's h1 (run file: a gap for the owner).
import type { ServiceCode } from "./types";

export const servicesHub = {
  meta: {
    title: "Services: build, automate, connect and run | TecHaust",
    description:
      "Custom software, AI document and workflow automation, systems integration and care plans, with fixed prices for India and international clients.",
  },
  h1: "What we do",
  lede: "Five kinds of work, one team. Most clients start with Advise or Automate and stay with us on a Run plan.",
  groups: [
    { id: "advise", name: "Advise", intro: "Clarity before code.", codes: ["S1", "S2", "S3", "S4"] },
    { id: "build", name: "Build", intro: "Software made to last.", codes: ["S5", "S6", "S7"] },
    {
      id: "automate",
      name: "Automate",
      intro: "Less manual work, more control.",
      codes: ["S9", "S10", "S11", "S12", "S13"],
    },
    { id: "connect", name: "Connect", intro: "Systems that agree with each other.", codes: ["S14"] },
    { id: "run", name: "Run", intro: "Looked after, every month.", codes: ["S16", "S18"] },
  ] satisfies { id: string; name: string; intro: string; codes: ServiceCode[] }[],
} as const;
