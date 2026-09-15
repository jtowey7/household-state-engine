/**
 * Regression: the real "add food to an existing item" journey, from the
 * household screen's own inputs through canonicalisation, the write boundary
 * and the writer/append port.
 *
 * The defect this covers: the /food surface offers everyday units ("litres"),
 * while the canonical contract stores base units — so a perfectly valid
 * "Milk, 3, litres" was refused at the write boundary with MISSING_UNIT.
 */

import { describe, expect, it } from "vitest";

import { prepareHouseholdIntake, releaseHouseholdIntake, authorizationFromRequest } from "./intake";
import { createHouseholdEventWriter } from "../event-writer/writer";
import { createFakeAppendPort } from "../event-writer/ports";
import { COMMON_UNIT_CHIPS } from "../food-ui/unit-chips";
import { resolveAddedAmount } from "../food-ui/add-food-quantity";
import { normaliseHouseholdUnit } from "../inventory-exception/unit-contract";
import type { HouseholdIntakeSubmission } from "./types";

const NOW = "2026-09-15T18:00:00.000Z";
const existing = [{ item: "Milk", quantity: 2, unit: "litres" }];

function submissionFor(input: { item: string; quantity: number; unit: string }): HouseholdIntakeSubmission {
  const amount = resolveAddedAmount({ ...input, existing });
  if (!amount.ok) throw new Error(amount.message);
  return {
    kind: "STOCK_CORRECTION",
    report: {
      exceptionId: "HOUSEHOLD-STOCK-ADD-MILK-1",
      itemKey: amount.matchedItem ?? input.item,
      statedStateAfter: amount.stateAfter,
      ...(amount.stateBefore === null ? {} : { statedStateBefore: amount.stateBefore }),
      unit: input.unit,
      observedAt: NOW,
      reportedBy: "household operator",
      source: "FoodOS household inventory",
      evidence: "Household operator explicitly added milk from the household control surface.",
      confidence: "High",
      reason: "Explicit household action: new food added to household stock.",
      recordClass: "Production",
    },
  };
}

describe("adding 3 litres to an existing Milk item", () => {
  it("every unit the household screen offers is inside the canonical contract", () => {
    for (const chip of COMMON_UNIT_CHIPS) {
      expect(normaliseHouseholdUnit(chip)).not.toBeNull();
    }
  });

  it("prepares a canonical correction with the base unit and the combined amount", () => {
    const prepared = prepareHouseholdIntake(submissionFor({ item: "Milk", quantity: 3, unit: "litres" }), {
      now: () => NOW,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const row = prepared.records[0]!.row;
    expect(row["Item"]).toBe("Milk");
    expect(row["Event type"]).toBe("Correction");
    expect(row["Unit"]).toBe("l");
    expect(row["State before"]).toBe("2");
    expect(row["State after"]).toBe("5");
    expect(prepared.requiresHumanAuthorization).toBe(true);
  });

  it("passes the write boundary and appends exactly once, idempotently", async () => {
    const submission = submissionFor({ item: "Milk", quantity: 3, unit: "litres" });
    const prepared = prepareHouseholdIntake(submission, { now: () => NOW });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const approvals = prepared.approvalRequests.map((request) =>
      authorizationFromRequest(request, {
        authorizationId: "AUTH-ADD-MILK-1",
        approvedBy: "household operator",
        approvedAt: NOW,
        evidenceDetail: "Household operator confirmed the addition on the household screen.",
      }),
    );

    const port = createFakeAppendPort();
    const writer = createHouseholdEventWriter({ port });
    const released = await releaseHouseholdIntake({ submission, writer, approvals, now: () => NOW });
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.rejected).toBe(0);
    expect(released.appended).toBe(1);
    expect(port.appended[0]!.row["Unit"]).toBe("l");
    expect(port.appended[0]!.row["State after"]).toBe("5");

    const again = await releaseHouseholdIntake({ submission, writer, approvals, now: () => NOW });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.duplicates).toBe(1);
    expect(port.ledger()).toHaveLength(1);
  });

  it("still fails closed on a measure that is not part of the contract", () => {
    const refused = prepareHouseholdIntake(
      {
        kind: "STOCK_CORRECTION",
        report: {
          ...submissionFor({ item: "Milk", quantity: 3, unit: "litres" }).report,
          unit: "handfuls",
        },
      } as HouseholdIntakeSubmission,
      { now: () => NOW },
    );
    expect(refused.ok).toBe(false);
  });
});
