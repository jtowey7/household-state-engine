import { describe, expect, it } from "vitest";

import { householdRefusalMessage } from "./refusal-copy";

describe("household refusal copy", () => {
  it("never exposes internal diagnostics for a rejected unit", () => {
    const message = householdRefusalMessage({
      code: "STOCK_INPUT_REFUSED",
      detail: "MISSING_UNIT: Milk: unit `litres` is not in the household unit contract.",
    });
    expect(message).not.toMatch(/MISSING_UNIT|contract|`/);
    expect(message).toMatch(/measure/i);
  });

  it("replaces other internal codes with calm language", () => {
    for (const detail of [
      "CANONICALISATION_FAILED: payload hash mismatch",
      "AUTHORIZATION_SCOPE_MISMATCH: policy identity drift",
      "EXCEPTION_PAYLOAD_CONFLICT: event id EVT-1",
    ]) {
      const message = householdRefusalMessage({ detail });
      expect(message).not.toMatch(/[A-Z]{3,}_[A-Z_]+|payload|policy|event id/i);
    }
  });

  it("keeps a message that is already written for the household", () => {
    const detail = "Give the food a name, an exact amount left, and a unit.";
    expect(householdRefusalMessage({ detail })).toBe(detail);
  });
});
