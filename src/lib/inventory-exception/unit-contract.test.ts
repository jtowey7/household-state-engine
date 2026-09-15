import { describe, expect, it } from "vitest";

import {
  HOUSEHOLD_UNIT_CONTRACT,
  normaliseHouseholdUnit,
  sameHouseholdUnit,
} from "./unit-contract";

describe("household unit contract", () => {
  it("maps every unit the household surface offers onto a canonical unit", () => {
    expect(normaliseHouseholdUnit("packs")).toBe("pack");
    expect(normaliseHouseholdUnit("each")).toBe("unit");
    expect(normaliseHouseholdUnit("kg")).toBe("kg");
    expect(normaliseHouseholdUnit("g")).toBe("g");
    expect(normaliseHouseholdUnit("litres")).toBe("l");
    expect(normaliseHouseholdUnit("ml")).toBe("ml");
    expect(normaliseHouseholdUnit("cans")).toBe("can");
  });

  it("accepts ordinary spelling variations without guessing unknown words", () => {
    expect(normaliseHouseholdUnit(" Litre ")).toBe("l");
    expect(normaliseHouseholdUnit("Kilograms")).toBe("kg");
    expect(normaliseHouseholdUnit("tins")).toBe("can");
    expect(normaliseHouseholdUnit("bunches")).toBeNull();
    expect(normaliseHouseholdUnit("")).toBeNull();
    expect(normaliseHouseholdUnit(null)).toBeNull();
  });

  it("every canonical unit normalises to itself", () => {
    for (const unit of HOUSEHOLD_UNIT_CONTRACT) {
      expect(normaliseHouseholdUnit(unit)).toBe(unit);
    }
  });

  it("compares two everyday words by their canonical meaning", () => {
    expect(sameHouseholdUnit("litres", "l")).toBe(true);
    expect(sameHouseholdUnit("each", "units")).toBe(true);
    expect(sameHouseholdUnit("kg", "g")).toBe(false);
    expect(sameHouseholdUnit("bunches", "bunches")).toBe(false);
  });
});
