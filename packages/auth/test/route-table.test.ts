// answeringRow: the first matched pattern the table declares, never the last [early check M2].
import { describe, expect, it } from "vitest";
import { answeringRow } from "../src/route-table.ts";

const table = new Map([
  ["/api/x/:id", { who: "any" }],
  ["/api/x/defaults", { who: "owner" }],
]);
const rowOf = (p: string) => table.get(p);

describe("answeringRow", () => {
  it("takes the first declared pattern, so a static path registered before /:id wins", () => {
    const matched = [{ path: "*" }, { path: "/api/x/defaults" }, { path: "/api/x/:id" }];
    expect(answeringRow(matched, rowOf)).toEqual({ who: "owner" });
  });

  it("skips middleware patterns that are not rows", () => {
    expect(answeringRow([{ path: "*" }, { path: "/api/*" }, { path: "/api/x/:id" }], rowOf)).toEqual({
      who: "any",
    });
  });

  it("is null when no matched pattern is declared (deny by default), and for no match at all", () => {
    expect(answeringRow([{ path: "*" }, { path: "/api/*" }], rowOf)).toBeNull();
    expect(answeringRow([], rowOf)).toBeNull();
  });
});
