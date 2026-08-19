import { describe, expect, it } from "vitest";
import {
  assertCanonicalBaselineBaseId,
  CANONICAL_FOOD_OS_BASE_ID,
} from "./production-baseline-input-preflight.mjs";

describe("Production baseline input preflight", () => {
  it("accepts the canonical Food OS Airtable base", () => {
    expect(() => assertCanonicalBaselineBaseId(CANONICAL_FOOD_OS_BASE_ID)).not.toThrow();
  });

  it("rejects a lookalike or alternate Airtable base", () => {
    expect(() => assertCanonicalBaselineBaseId("appOTHERBASE00001")).toThrow(
      /does not match the canonical Food OS base/,
    );
  });

  it("rejects an empty base ID", () => {
    expect(() => assertCanonicalBaselineBaseId(" ")).toThrow(
      /does not match the canonical Food OS base/,
    );
  });
});
