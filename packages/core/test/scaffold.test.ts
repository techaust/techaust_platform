import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index";

// Scaffold smoke test: proves the workspace, TypeScript and Vitest wiring. Replaced by real tests in M1.2.
describe("@techaust/core scaffold", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@techaust/core");
  });
});
