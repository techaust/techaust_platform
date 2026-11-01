// 07-ZJ (docs/07-content-appendix/ZJ-t11-deed.md): the deed of assignment's admin lines (staff-only, sections D and E), the designer's recommended words,
// marked with "[Placeholder]" until the lead approves them (the owner delegated 07-ZJ to the lead, 2026-11-01); then `APPROVED_07ZJ` turns true and the marks go
// (the 07-ZH pattern). The deed's own text is 07-ZE's and comes from the server (core `deedText`); nothing of it is written here. Its own small module, so the
// audit log's labels (line 33) don't load the deed screen's words.

/** 07-ZJ: APPROVED by the lead under the owner's delegation, 2026-11-01. */
export const APPROVED_07ZJ: boolean = true;
export const PLACEHOLDER_MARK = "[Placeholder]";
/** A 07-ZJ line as the screen shows it: marked until approved. */
export const ZJ = (line: string): string => (APPROVED_07ZJ ? line : `${PLACEHOLDER_MARK} ${line}`);

/** Line 33: the audit log's words for the deed actions, its group and its record type. */
export const DEED_AUDIT = {
  "deed.draft": ZJ("prepared a draft deed"),
  "deed.recheck": ZJ("checked a project for a deed"),
  "deed.edit": ZJ("edited a deed's Schedules"),
  "deed.finalise": ZJ("finalised a deed"),
  "deed.sign": ZJ("uploaded a signed deed"),
  "deed.cancel": ZJ("cancelled a draft deed"),
  "deed.pdf_retry": ZJ("asked for a deed's PDF again"),
} as const;
export const DEED_AUDIT_GROUP = ZJ("Deeds");
export const DEED_RECORD_TYPE = ZJ("Deed");
