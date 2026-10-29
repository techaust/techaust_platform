// 07-Y (FX-3, the full audit's admin and portal fixes): the lines the fix task added, PENDING the owner. Each one shows the "[Placeholder] " mark
// before the recommended words until the owner approves the page; then `APPROVED_07Y` turns true and the marks go (the 07-X pattern, copy-x.ts).
// Its own module, so a screen marks its line without loading another screen's words.

export const APPROVED_07Y = false;
export const PLACEHOLDER_MARK = "[Placeholder]";
/** A 07-Y line as the screen shows it: marked until the owner approves 07-Y. */
export const Y = (line: string): string => (APPROVED_07Y ? line : `${PLACEHOLDER_MARK} ${line}`);
