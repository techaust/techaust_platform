// HTML escaping for text and attribute values. Every string that reaches the document HTML goes through `esc`.
const MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes `& < > " '` (safe in text and in a quoted attribute). */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => MAP[c] as string);
