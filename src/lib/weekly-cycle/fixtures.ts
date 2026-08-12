import { createMemoryProductionPort } from "../production-adapter/memory-port";
import type { SourceScope } from "../production-adapter/types";
import { consumptionFixture, consumptionAsOf } from "../consumption/fixtures";
import { shadowTargets } from "../quantity-adapter/fixtures";
import type { ConsumptionPlan } from "../consumption/types";

/** SYNTHETIC ONLY — no real household production data anywhere in this file. */
export const weeklyScope: SourceScope = {
  mode: "SYNTHETIC",
  datasetId: "synthetic-household-lab",
  windowStart: "2026-08-01",
  windowEnd: "2026-08-07",
};

export const weeklyPort = createMemoryProductionPort({
  portId: "memory-port:synthetic-household-lab",
  mode: "SYNTHETIC",
  provenance: "synthetic fixture — Food OS test lab",
  openingEvents: consumptionFixture.openingEvents ?? [],
  targets: shadowTargets,
});

export const weeklyPlan: Omit<ConsumptionPlan, "openingEvents"> = {
  ...(consumptionFixture.meals ? { meals: consumptionFixture.meals } : {}),
  ...(consumptionFixture.allocations ? { allocations: consumptionFixture.allocations } : {}),
  ...(consumptionFixture.exceptions ? { exceptions: consumptionFixture.exceptions } : {}),
};

export const weeklyAsOf = consumptionAsOf;
export const weeklyNow = () => "2026-08-03T20:00:00.000Z";
