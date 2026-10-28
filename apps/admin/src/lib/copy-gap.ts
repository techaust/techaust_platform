// A line of the admin's screens that no approved 07 appendix has yet (CLAUDE.md: "a new line missing from 07 still shows `[Placeholder]` until the owner
// approves it"). The 07-R to 07-V wording was approved on 2026-10-28 (docs/runs/research-and-wording.md), so the per-appendix switches are gone; what is
// left behind `gap` is a line those appendices don't have, each one listed in the run file's designer report. Never invent a line: mark it here.

/** The mark a missing line carries, so nobody mistakes it for approved copy. */
export const COPY_GAP = "[Placeholder]";

/** A proposed line that no approved appendix has yet: shown with the mark until the owner approves its words. */
export const gap = (line: string): string => `${COPY_GAP} ${line}`;
