// The stylesheet clash guard (scripts/css-collisions.mjs, run by `pnpm check` and CI): a class may be the subject of a base rule in only
// one stylesheet per app, because a SPA route's stylesheet stays loaded for the whole session (run css-collisions, 2026-10-31: the
// Reports copy of `.segmented` drew the GST switch wrongly and leaked to every other switch). Runs in Node.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  baseKey,
  checkApps,
  findClashes,
  loadApps,
  selectorsOf,
  selfTest,
} from "../../../scripts/css-collisions.mjs";

const shell = `.segmented { display: grid; }
.segmented__opt:has(input:checked) { background: var(--color-selection); font-weight: 600; }`;

describe("css collisions: what counts as a base rule", () => {
  it("one compound selector is a base rule, keyed by its classes; functional pseudo-class arguments add none", () => {
    expect(baseKey(".segmented")).toBe("segmented");
    expect(baseKey(".segmented__opt:has(input:checked)")).toBe("segmented__opt");
    expect(baseKey(".x:not(.y):hover")).toBe("x");
    expect(baseKey("a.back[aria-current]")).toBe("back");
    expect(baseKey(".x::before")).toBe("x");
    expect(baseKey(".ledger.ledger--3b")).toBe("ledger.ledger--3b");
  });

  it("a rule under a parent or after a sibling is not a base rule", () => {
    expect(baseKey(".dialog .radios")).toBeNull();
    expect(baseKey(".period-picker > .segmented")).toBeNull();
    expect(baseKey(".a + .a")).toBeNull();
    expect(baseKey('[data-theme="dark"] .x')).toBeNull();
    expect(baseKey("input:checked")).toBeNull();
  });

  it("reads rules inside @media and @supports, splits selector lists, and ignores comments, strings and @keyframes", () => {
    const css = `/* .ghost { } */
@media (max-width: 479px) { .a, .b:hover { x: 1; } }
@supports (display: grid) { .c { x: "{" } }
@keyframes spin { from { opacity: 0 } to { opacity: 1 } }
@import url("x.css");
.d:is(.e, .f) { x: 1; }`;
    expect(selectorsOf(css)).toEqual([".a", ".b:hover", ".c", ".d:is(.e, .f)"]);
  });
});

describe("css collisions: the clash", () => {
  it("catches the switch the owner saw: .segmented in shell.css and again in reports.css (inside @media too)", () => {
    const reports =
      "@media (max-width: 479px) { .segmented { width: 100%; } }\n.segmented__opt span { padding: 0; }";
    expect(
      findClashes([
        { name: "shell.css", css: shell },
        { name: "reports.css", css: reports },
      ]),
    ).toEqual([{ key: "segmented", files: ["reports.css", "shell.css"] }]);
  });

  it("passes a scoped adjustment (.dialog .radios, .period-picker .segmented)", () => {
    const local = ".dialog .radios { gap: 0; }\n.period-picker .segmented { width: 100%; }";
    expect(
      findClashes([
        { name: "shell.css", css: `${shell}\n.radios { display: grid; }` },
        { name: "reports.css", css: local },
      ]),
    ).toEqual([]);
  });

  it("checks each app on its own; an allow-list entry needs a reason and must still match a clash", () => {
    const twice = [
      { name: "a.css", css: ".x { }" },
      { name: "b.css", css: ".x:hover { }" },
    ];
    expect(
      checkApps({ admin: [{ name: "a.css", css: ".x { }" }], portal: [{ name: "b.css", css: ".x { }" }] }),
    ).toEqual([]);
    expect(checkApps({ admin: twice })).toHaveLength(1);
    expect(
      checkApps({ admin: twice }, [
        { app: "admin", key: "x", files: ["b.css", "a.css"], reason: "shared on purpose" },
      ]),
    ).toEqual([]);
    expect(
      checkApps({ admin: twice }, [{ app: "admin", key: "x", files: ["a.css", "b.css"], reason: "" }]),
    ).toHaveLength(2);
    expect(
      checkApps({ admin: [] }, [{ app: "admin", key: "x", files: ["a.css", "b.css"], reason: "gone" }]),
    ).toEqual(["allow-list entry admin .x matches no clash: remove it"]);
  });

  it("the built-in self-test passes, and the repository's own stylesheets have no clash", () => {
    expect(selfTest()).toEqual([]);
    const apps = loadApps(fileURLToPath(new URL("../../../", import.meta.url)));
    expect(Object.keys(apps)).toEqual(expect.arrayContaining(["admin", "portal", "web"]));
    expect(apps.admin?.some((f) => f.name.endsWith("reports.css"))).toBe(true);
    expect(checkApps(apps)).toEqual([]);
  });
});
