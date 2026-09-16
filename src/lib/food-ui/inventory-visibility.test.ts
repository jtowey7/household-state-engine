import { describe, expect, it } from "vitest";

import { isVisibleHouseholdFood } from "./inventory-visibility";

describe("household inventory visibility", () => {
  it("keeps positive stock visible", () => {
    expect(isVisibleHouseholdFood({ quantity: 100 })).toBe(true);
    expect(isVisibleHouseholdFood({ quantity: 1 })).toBe(true);
  });

  it("hides zero stock without deleting the canonical record", () => {
    expect(isVisibleHouseholdFood({ quantity: 0 })).toBe(false);
  });

  it("keeps unknown quantities visible rather than guessing", () => {
    expect(isVisibleHouseholdFood({ quantity: null })).toBe(true);
  });
});
