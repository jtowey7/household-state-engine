/**
 * Regression: every everyday measure the /food screen offers must survive the
 * real write/release boundary, not just the form. This drives each unit chip
 * through canonical preparation, explicit approval and the writer/append port.
 */

import { describe, expect, it } from "vitest";

import { authorizationFromRequest, prepareHouseholdIntake, releaseHouseholdIntake } from "./intake";
import { createHouseholdEventWriter } from "../event-writer/writer";
import { createFakeAppendPort } from "../event-writer/ports";
import { COMMON_UNIT_CHIPS } from "../food-ui/unit-chips";
import { householdRefusalMessage } from "../food-ui/refusal-copy";
import type { HouseholdIntakeSubmission } from "./types";

const NOW = "2026-09-15T18:00:00.000Z";

function submissionFor(unit: string, index: number): HouseholdIntakeSubmission {
  return {
    kind: "STOCK_CORRECTION",
    report: {
      exceptionId: `HOUSEHOLD-STOCK-CHIP-${index}`,
      itemKey: "Milk",
      statedStateAfter: 5,
      statedStateBefore: 2,
      unit,
      observedAt: NOW,
      reportedBy: "household operator",
      source: "FoodOS household inventory",
      evidence: "Household operator added food from the household control surface.",
      confidence: "High",
      reason: "Explicit household action: food added to household stock.",
      recordClass: "Production",
    },
  };
}

describe("unit chips at the write/release boundary", () => {
  it.each(COMMON_UNIT_CHIPS.map((chip, index) => [chip, index] as const))(
    "prepares, approves and appends a correction measured in %s",
    async (chip, index) => {
      const submission = submissionFor(chip, index);
      const prepared = prepareHouseholdIntake(submission, { now: () => NOW });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;

      const approvals = prepared.approvalRequests.map((request) =>
        authorizationFromRequest(request, {
          authorizationId: `AUTH-CHIP-${index}`,
          approvedBy: "household operator",
          approvedAt: NOW,
          evidenceDetail: "Household operator confirmed the change on the household screen.",
        }),
      );

      const port = createFakeAppendPort();
      const writer = createHouseholdEventWriter({ port });
      const released = await releaseHouseholdIntake({ submission, writer, approvals, now: () => NOW });
      expect(released.ok).toBe(true);
      if (!released.ok) return;
      expect(released.rejected).toBe(0);
      expect(released.appended).toBe(1);
      expect(port.appended[0]!.row["State after"]).toBe("5");
    },
  );

  it("shows household language, never a raw diagnostic, when a measure is not recognised", () => {
    const refused = prepareHouseholdIntake(submissionFor("handfuls", 99), { now: () => NOW });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    const message = householdRefusalMessage(refused);
    expect(message).not.toMatch(/MISSING_UNIT|unit contract|STOCK_INPUT_REFUSED/);
    expect(message).toMatch(/did not recognise that measure|could not use this update/i);
  });
});
