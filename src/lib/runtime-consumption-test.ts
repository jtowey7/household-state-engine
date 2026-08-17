import { consumptionAsOf, consumptionFixture } from "./consumption/fixtures";
import { runConsumptionCycle } from "./consumption/projector";

/** TEST-only proof harness for deterministic expected-consumption projection. */
export function runDeployedTestConsumptionCycle() {
  const result = runConsumptionCycle(consumptionFixture, { asOf: consumptionAsOf });
  const eventIds = result.projection.events.map((event) => event.eventId);
  const expectedEventIds = new Set([
    "OPEN-OATS",
    "OPEN-MILK",
    "OPEN-ICECREAM",
    "OPEN-RICE",
    "CONSUME:MEAL-3001:oats-rolled",
    "CONSUME:MEAL-3001:milk-whole",
    "CONSUME:MEAL-3002:oats-rolled",
    ...Array.from({ length: 7 }, (_, index) => `ALLOC:ALLOC-ICE:2026-08-${String(index + 1).padStart(2, "0")}`),
    "EXC:EXC-7001",
  ]);

  const assertions = {
    eventCount: result.projection.events.length === expectedEventIds.size,
    eventIdsUnique: new Set(eventIds).size === eventIds.length,
    skippedMealDidNotBurn: !eventIds.some((id) => id.includes("MEAL-3003")),
    futureMealDidNotBurn: !eventIds.some((id) => id.includes("MEAL-3004")),
    allocationBurned: eventIds.filter((id) => id.startsWith("ALLOC:ALLOC-ICE:")).length === 7,
    exceptionApplied: eventIds.includes("EXC:EXC-7001"),
    handoffReady: result.handoff.blockedItemKeys.length === 0,
    oatsProjectedQuantity: result.snapshot.items.find((item) => item.itemKey === "oats-rolled")?.quantity === 600,
    milkProjectedQuantity: result.snapshot.items.find((item) => item.itemKey === "milk-whole")?.quantity === 4.5,
    iceCreamProjectedQuantity: result.snapshot.items.find((item) => item.itemKey === "ice-cream-tub")?.quantity === 6,
    riceUnburnedQuantity: result.snapshot.items.find((item) => item.itemKey === "rice-basmati")?.quantity === 5000,
  };

  return {
    ok: Object.values(assertions).every(Boolean),
    mode: "TEST_ONLY",
    asOf: consumptionAsOf,
    assertions,
    projection: {
      eventCount: result.projection.events.length,
      decisions: result.projection.decisions,
      uncertainItemKeys: result.projection.uncertainItemKeys,
    },
    snapshot: {
      snapshotId: result.snapshot.snapshotId,
      replayId: result.snapshot.replayId,
      reconciliationStatus: result.snapshot.reconciliationStatus,
      blockedItemKeys: result.snapshot.blockedItemKeys,
    },
    handoff: {
      readyForQuantityRun: result.handoff.readyForQuantityRun,
      itemCount: result.handoff.items.length,
      blockedItemKeys: result.handoff.blockedItemKeys,
    },
    mutatedHouseholdState: false,
    appendedEvents: false,
    dispatched: false,
  };
}
