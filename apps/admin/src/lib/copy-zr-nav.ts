// M7.4 (run file G.1): the navigation's words for the requests inbox (the designer's staff lines, approved by the lead on 2026-11-06, 07-ZR). Its own tiny module: the shell
// imports it on every page, so it never carries the inbox's other words (lib/copy-zr.ts re-exports these).
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const ZR_NAV = {
  label: "Requests",
  count: (n: number) => plural(n, "1 open request", `${n} open requests`),
} as const;
