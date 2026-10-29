// The Projects screens' rules [ADM-PRJ-01..05, ADM-CLI-03]: the 07-K copy word for word, every sentence 07-K lacks marked as a
// placeholder, errors by API code, only changed fields sent (the M3.2 drafts rule), the milestone form (an amount or a
// percentage, exactly one), the client-side upload checks, the upload headers, and notes drawn as React elements (never HTML).
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { type MilestoneView, type ProjectView, RequestError, uploadHeaders } from "../api.ts";
import { markdownElements } from "../components/markdown.tsx";
import { lastLiveOfIndividual } from "./clients.ts";
import { Y } from "./copy-y.ts";

/** The mark a line not yet approved would carry (none should). */
const PLACEHOLDER_TAG = "[Placeholder]";

import {
  COPY,
  cancelConfirm,
  completeConfirm,
  detailsErrors,
  detailsOf,
  detailsPatch,
  fileDeleteConfirm,
  lastContactLine,
  milestoneDeletable,
  milestoneDeleteConfirm,
  milestoneFormOf,
  milestoneInput,
  milestoneOpen,
  milestonePatch,
  moveItem,
  NO_PROJECT_DRAFTS,
  needsConfirm,
  PENDING,
  precheckFile,
  precheckText,
  projectDrafts,
  projectErrorText,
  projectMoves,
  shareConfirm,
  sizeText,
  TOASTS,
  totalsWarning,
  typeName,
} from "./projects.ts";

// Sample data only (clearly fake).
const project = (over: Partial<ProjectView> = {}): ProjectView => ({
  id: "p1",
  code: "PRJ-0001",
  clientId: "c1",
  clientCode: "C0001",
  clientName: "Sample Clinic (sample)",
  sourceDocumentId: null,
  name: "Website (sample)",
  status: "planned",
  startDate: "2026-11-02",
  targetDate: null,
  ownerId: null,
  ownerName: null,
  currency: "INR",
  budgetMinor: 30_000_000,
  createdAt: 1,
  updatedAt: 10,
  ...over,
});
const milestone = (over: Partial<MilestoneView> = {}): MilestoneView => ({
  id: "m1",
  projectId: "p1",
  position: 1,
  title: "Design (sample)",
  amountMinor: 9_000_000,
  pctBp: null,
  resolvedMinor: 9_000_000,
  dueDate: null,
  status: "pending",
  deliveredAt: null,
  documentId: null,
  isAdvance: false,
  createdAt: 1,
  updatedAt: 5,
  ...over,
});

describe("07-K copy, word for word [ADM-PRJ-01..05]", () => {
  it("lists, statuses and the project page", () => {
    expect(`${COPY.projectsEmptyTitle}. ${COPY.projectsEmptyBody}`).toBe(
      "No projects yet. A project starts from an accepted proposal, or you can add one by hand.",
    );
    expect(COPY.projectsNoMatch).toBe(
      "Try fewer filters, or search for the start of a project code or name.",
    );
    expect(`${COPY.clientProjectsEmptyTitle}.`).toBe("No projects for this client yet.");
    expect(COPY.clientFilesEmpty).toBe("No files for this client yet.");
    expect(COPY.linkedProposal).toBe("No proposal is linked to this project.");
    expect(COPY.hoursLogged).toBe("Hours logged arrive with time logs.");
    expect(completeConfirm("PRJ X")).toBe("Mark PRJ X as completed? You can't reopen a completed project.");
    expect(cancelConfirm("PRJ X")).toBe("Cancel PRJ X? You can't reopen a cancelled project.");
    expect(milestoneDeleteConfirm("Design")).toBe("Delete the milestone Design? This can't be undone.");
  });

  it("notes, files and the erase addition", () => {
    expect(COPY.sharingExplainer).toBe(
      "Shared notes appear in the client portal for everyone at this client who has portal access.",
    );
    expect(shareConfirm("Acme")).toBe(
      "Share this note with Acme? Their portal users will be able to read it.",
    );
    expect(COPY.noteDelete).toBe("Delete this note? This can't be undone.");
    expect(COPY.formattingHint).toBe("You can use **bold**, *italic*, lists and links.");
    // FX-3 (A3 7): notes take headings; the line is a 07-Y line, marked until the owner approves it.
    expect(COPY.noteFormattingHint).toBe(Y("You can use # headings, **bold**, *italic*, lists and links."));
    expect(COPY.uploadHint).toBe("PDF, PNG, JPG, WebP, Word, Excel, CSV, text or ZIP, up to 25 MB each.");
    expect(COPY.filesSharedExplainer).toBe(
      "Shared files can be downloaded from the client portal by everyone at this client who has portal access.",
    );
    expect(fileDeleteConfirm("a.pdf")).toBe("Delete a.pdf? This can't be undone.");
    expect(lastContactLine("Acme")).toBe(
      "This is Acme's last contact, so their notes and files are deleted too, and their projects keep only their codes.",
    );
    expect(Object.values(TOASTS)).toEqual([
      "Project added.",
      "Project saved.",
      "Milestone added.",
      "Milestone saved.",
      "Milestones reordered.",
      "Note added.",
      "Note saved.",
      "Note shared.",
      "File uploaded.",
      "File shared.",
      "File deleted.",
    ]);
  });

  it("every sentence 07-K lacked has its 07-Q words, with no placeholder tag", () => {
    for (const v of Object.values(PENDING)) {
      const text = typeof v === "function" ? (v as (...a: string[]) => string)("pending", "paid") : v;
      expect(text.includes(PLACEHOLDER_TAG)).toBe(false);
    }
  });

  it("the milestone total warning, only when the lines differ from the budget", () => {
    expect(totalsWarning({ totalMinor: 29_500_000, mismatch: true }, 30_000_000, "INR")).toBe(
      "The milestones add up to ₹2,95,000.00, but the budget is ₹3,00,000.00. Check them before billing.",
    );
    expect(totalsWarning({ totalMinor: 30_000_000, mismatch: false }, 30_000_000, "INR")).toBeNull();
    expect(totalsWarning({ totalMinor: 0, mismatch: false }, null, "USD")).toBeNull();
  });
});

describe("errors by API code", () => {
  const e = (code: string, message = "server words") => new RequestError(409, code, message);
  it("07-K sentences", () => {
    expect(projectErrorText(e("file_type_mismatch"))).toBe(
      "This file's contents don't match its name. Save it again in its real format and upload that.",
    );
    expect(projectErrorText(e("file_type_not_allowed"))).toBe(
      "This type of file can't be uploaded. Use PDF, PNG, JPG, WebP, Word, Excel, CSV, text or ZIP.",
    );
    expect(projectErrorText(e("file_too_large"))).toBe("This file is larger than 25 MB.");
    for (const c of ["length_required", "length_mismatch", "checksum_mismatch"])
      expect(projectErrorText(e(c))).toBe("The upload didn't arrive complete. Try again.");
    expect(
      projectErrorText(e("milestone_invalid_transition"), undefined, { from: "invoiced", to: "pending" }),
    ).toBe("A milestone can't move from Invoiced to Pending.");
    expect(projectErrorText(e("client_anonymised"))).toBe(
      "This client's personal details were removed, so nothing new can be added to it.",
    );
    expect(projectErrorText(e("budget_locked"))).toBe(
      "The budget can't change while a percentage milestone is invoiced or paid.",
    );
    expect(projectErrorText(e("milestone_limit"))).toBe("A project can have up to 100 milestones.");
    expect(projectErrorText(e("milestone_locked"))).toBe(
      "This milestone is already invoiced, so it can't be changed or deleted.",
    );
    expect(projectErrorText(e("arrives_with_invoicing"))).toBe(
      "Invoiced and Paid are set by invoicing, which arrives later.",
    );
    expect(projectErrorText(e("order_mismatch"))).toBe(
      "The milestones changed while you were reordering. Reload and try again.",
    );
    expect(projectErrorText(e("invalid_transition"), { from: "completed", to: "active" })).toBe(
      "A project can't move from Completed to Active.",
    );
  });

  it("an unworded M3.4 code is the server's words, marked; others are the server's words", () => {
    expect(projectErrorText(e("dates_order", "The target date can't be before the start date"))).toBe(
      "The target date can't be before the start date.",
    );
    expect(projectErrorText(e("stale_version", "Someone else saved first"))).toBe(
      "Someone else saved first.",
    );
    expect(projectErrorText(new Error("x"))).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    );
  });
});

describe("status moves [ADM-PRJ-01]", () => {
  it("follow core's list; complete and cancel ask first", () => {
    expect(projectMoves("planned")).toEqual(["active", "cancelled"]);
    expect(projectMoves("completed")).toEqual([]);
    expect(needsConfirm("completed")).toBe(true);
    expect(needsConfirm("cancelled")).toBe(true);
    expect(needsConfirm("on_hold")).toBe(false);
  });
});

describe("the project details draft [ADM-PRJ-01]", () => {
  it("sends only what changed, money in minor units", () => {
    const base = detailsOf(project());
    expect(base.budget).toBe("3,00,000");
    const value = { ...base, name: " New name ", budget: "3,50,000.50", targetDate: "2027-01-29" };
    expect(detailsPatch({ base, value }, "INR")).toEqual({
      name: "New name",
      budgetMinor: 35_000_050,
      targetDate: "2027-01-29",
    });
    expect(detailsPatch({ base, value: { ...base, budget: "", ownerId: "" } }, "INR")).toEqual({
      budgetMinor: null,
    });
  });

  it("checks the name, the dates' order and the amount", () => {
    const f = { name: "", ownerId: "", startDate: "2026-12-01", targetDate: "2026-11-01", budget: "1.234" };
    const e = detailsErrors(f, "INR", {});
    expect(e.name?.includes(PLACEHOLDER_TAG)).toBe(false);
    expect(e.targetDate?.includes(PLACEHOLDER_TAG)).toBe(false);
    expect(e.budget).toBe("Use at most 2 decimal places.");
  });

  it("a reload keeps an untouched draft field in step and drops only a clashing one", () => {
    const base = detailsOf(project());
    let s = projectDrafts(NO_PROJECT_DRAFTS, { type: "details", value: { ...base, name: "Mine" }, base });
    s = projectDrafts(s, { type: "loaded", details: { ...base, targetDate: "2027-02-01" } });
    expect(s.details?.value).toMatchObject({ name: "Mine", targetDate: "2027-02-01" });
    expect(s.conflict).toBe(false);
    s = projectDrafts(s, { type: "loaded", details: { ...base, name: "Theirs", targetDate: "2027-02-01" } });
    expect(s.details?.value.name).toBe("Theirs");
    expect(s.conflict).toBe(true);
    expect(projectDrafts(s, { type: "reloaded-latest" })).toEqual(NO_PROJECT_DRAFTS);
  });
});

describe("the milestone form [ADM-PRJ-02]", () => {
  it("an amount or a percentage, exactly one", () => {
    const f = milestoneFormOf(null, "INR");
    expect(milestoneInput({ ...f, title: "A", amount: "25,000" }, "INR", {})).toEqual({
      ok: true,
      body: { title: "A", amountMinor: 2_500_000, dueDate: null },
    });
    expect(
      milestoneInput({ ...f, title: "B", kind: "pct", pct: "12.5 %", dueDate: "2026-12-01" }, "INR", {}),
    ).toEqual({ ok: true, body: { title: "B", pctBp: 1250, dueDate: "2026-12-01" } });
    const bad = milestoneInput({ ...f, kind: "pct", pct: "101" }, "INR", {});
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["pct", "title"]);
  });

  it("an edit sends what changed; switching to a percentage sends the percentage", () => {
    const m = milestone();
    expect(milestoneFormOf(m, "INR")).toMatchObject({ kind: "amount", amount: "90,000" });
    expect(milestonePatch(m, { title: m.title, amountMinor: m.amountMinor, dueDate: null })).toEqual({});
    expect(milestonePatch(m, { title: "New", pctBp: 3000, dueDate: "2027-01-01" })).toEqual({
      title: "New",
      pctBp: 3000,
      dueDate: "2027-01-01",
    });
  });

  it("invoiced and paid are never offered for change", () => {
    expect(milestoneOpen(milestone({ status: "ready_to_bill" }))).toBe(true);
    expect(milestoneOpen(milestone({ status: "invoiced" }))).toBe(false);
    expect(milestoneDeletable(milestone({ status: "ready_to_bill" }))).toBe(false);
    expect(milestoneDeletable(milestone({ documentId: "d1" }))).toBe(false);
  });

  it("reorders by moving one item", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});

describe("files [ADM-PRJ-04]", () => {
  it("the browser checks the type and the size first (the server checks the bytes)", () => {
    expect(precheckFile({ name: "brief.PDF", size: 10 })).toBeNull();
    expect(precheckFile({ name: "photo.jpeg", size: 10 })).toBeNull();
    expect(precheckFile({ name: "page.html", size: 10 })).toBe("file_type_not_allowed");
    expect(precheckFile({ name: "noext", size: 10 })).toBe("file_type_not_allowed");
    expect(precheckFile({ name: "big.zip", size: 26_214_401 })).toBe("file_too_large");
    expect(precheckText("file_too_large")).toBe("This file is larger than 25 MB.");
  });

  it("the upload headers: the name percent-encoded, the SHA-256 the browser computed", () => {
    expect(uploadHeaders("Brief (draft) ✓.pdf", "ab".repeat(32))).toEqual({
      "Content-Type": "application/octet-stream",
      "X-File-Name": "Brief%20(draft)%20%E2%9C%93.pdf",
      "X-File-Sha256": "ab".repeat(32),
    });
  });

  it("sizes and kinds in words", () => {
    expect(sizeText(1)).toBe("1 byte");
    expect(sizeText(820_000)).toBe("820 KB");
    expect(sizeText(999_600)).toBe("1 MB");
    expect(sizeText(999_400)).toBe("999 KB");
    expect(sizeText(2_240_000)).toBe("2.2 MB");
    expect(typeName("application/pdf")).toBe("PDF");
    expect(typeName("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("Excel");
  });
});

describe("the erase addition shows for an individual client's last live contact only [ADM-CLI-05]", () => {
  it("matches the API's condition", () => {
    const live = { anonymisedAt: null };
    expect(lastLiveOfIndividual({ client: { type: "individual" }, liveContactCount: 1 }, live)).toBe(true);
    expect(lastLiveOfIndividual({ client: { type: "individual" }, liveContactCount: 2 }, live)).toBe(false);
    expect(lastLiveOfIndividual({ client: { type: "business" }, liveContactCount: 1 }, live)).toBe(false);
    expect(
      lastLiveOfIndividual({ client: { type: "individual" }, liveContactCount: 1 }, { anonymisedAt: 5 }),
    ).toBe(false);
  });
});

describe("notes are React elements, never HTML [ADM-PRJ-03]", () => {
  function walk(n: ReactNode, seen: { props: Record<string, unknown>[]; text: string[] }) {
    if (Array.isArray(n)) for (const c of n) walk(c, seen);
    else if (typeof n === "string") seen.text.push(n);
    else if (isValidElement(n)) {
      const props = n.props as Record<string, unknown> & { children?: ReactNode };
      seen.props.push(props);
      walk(props.children, seen);
    }
    return seen;
  }

  it("markup in a note stays text, links keep only http, https and mailto", () => {
    const seen = walk(
      markdownElements(
        '<img src=x onerror="alert(1)"> **bold** [ok](https://example.test) [bad](javascript:alert(1))\n\n- one\n- two',
      ),
      { props: [], text: [] },
    );
    expect(seen.props.some((p) => "dangerouslySetInnerHTML" in p)).toBe(false);
    expect(seen.text.join("")).toContain('<img src=x onerror="alert(1)">');
    const hrefs = seen.props.map((p) => p.href).filter(Boolean);
    expect(hrefs).toEqual(["https://example.test/"]);
    for (const p of seen.props.filter((x) => x.href)) expect(p.rel).toBe("noopener noreferrer");
  });

  it("FX-3: a note's `#` to `###` are h3 to h5 (never an h1 or h2 on the page); other Markdown keeps `#` as text", () => {
    const tags = (nodes: ReactNode[]) => nodes.map((n) => (isValidElement(n) ? n.type : typeof n));
    expect(tags(markdownElements("# One\n## Two\n### Three\n#### Four", true))).toEqual([
      "h3",
      "h4",
      "h5",
      "p",
    ]);
    const seen = walk(markdownElements("# <b>x</b> [l](javascript:x)", true), { props: [], text: [] });
    expect(seen.props.some((p) => "dangerouslySetInnerHTML" in p)).toBe(false);
    expect(seen.text.join("")).toBe("<b>x</b> l");
    expect(tags(markdownElements("# One"))).toEqual(["p"]);
  });

  it("FX-3 fix round: a note's headings keep its outline and never skip a level under the panel's h2 (axe heading-order)", () => {
    const tags = (nodes: ReactNode[]) => nodes.map((n) => (isValidElement(n) ? n.type : typeof n));
    // a note that opens with `##` (found by the record-page sweep on the project Overview) starts at h3
    expect(tags(markdownElements("## Second\nText.", true))).toEqual(["h3", "p"]);
    expect(tags(markdownElements("### Only small", true))).toEqual(["h3"]);
    // a jump of two levels is drawn one level deeper only; going back up is free
    expect(tags(markdownElements("# Top\n### Deep\n## Mid\n# Top again", true))).toEqual([
      "h3",
      "h4",
      "h4",
      "h3",
    ]);
    expect(tags(markdownElements("## A\n### B\n## C", true))).toEqual(["h3", "h4", "h3"]);
    // the size stays the author's
    const [first] = markdownElements("## Second", true);
    expect(isValidElement(first) && (first.props as { className: string }).className).toBe("md__h md__h--2");
  });
});
