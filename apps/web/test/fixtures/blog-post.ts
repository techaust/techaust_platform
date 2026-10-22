// A test fixture post, NOT a real post (the real ones are the owner's, in src/content/blog). Front-matter as the
// collection would read it, plus a Markdown body.
export const fixturePost = {
  id: "fixture-post",
  data: {
    title: 'Fixture <post> & "quotes"',
    description: "A fixture used by tests only.",
    date: "2026-09-01",
    tags: ["fixture"],
    draft: false,
    relatedServices: ["S1"],
    faq: [{ q: "Is this real?", a: "No." }],
  },
  body: [
    "Intro paragraph.",
    "",
    "## First heading",
    "",
    "Some words here.",
    "",
    "```",
    "## not a heading",
    "```",
    "",
    "### Second level",
    "",
    "Closing words.",
  ].join("\n"),
};
