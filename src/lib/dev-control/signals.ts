/**
 * Food OS — DEVELOPMENT CONTROL signal collection.
 *
 * Executes the existing synthetic harnesses (weekly shadow cycle, scheduler
 * wake-ups, integration lab) and returns their evidence. Synthetic fixtures
 * only: no production connector, no household mutation, no dispatch.
 */

import { consumptionFixture } from "../consumption/fixtures";
import { safetyReport } from "../feedback/classifier-fixtures";
import { createMemoryProductionPort } from "../production-adapter/memory-port";
import { shadowTargets } from "../quantity-adapter/fixtures";
import { blockedControlPlane, cleanControlPlane } from "../scheduler/fixtures";
import { runSchedulerCycle } from "../scheduler/cycle";
import { labCases, labNow, labTargets } from "../test-lab/cases";
import { runLabSuite } from "../test-lab/harness";
import { runWeeklyShadowCycle } from "../weekly-cycle/cycle";
import {
  weeklyAsOf,
  weeklyNow,
  weeklyPlan,
  weeklyPort,
  weeklyScope,
} from "../weekly-cycle/fixtures";
import type { ConnectivitySignal, DevControlSignals } from "./types";

const WAKE_AT = "2026-08-03T20:05:00.000Z";

export interface CollectOptions {
  now?: string;
  connectivity?: ConnectivitySignal;
}

export async function collectDevControlSignals(
  options: CollectOptions = {},
): Promise<DevControlSignals> {
  const base = {
    port: weeklyPort,
    scope: weeklyScope,
    plan: weeklyPlan,
    asOf: weeklyAsOf,
    now: weeklyNow,
  };

  const [nominal, constrained, offline] = await Promise.all([
    runWeeklyShadowCycle(base),
    runWeeklyShadowCycle({
      ...base,
      feedbackReports: [safetyReport],
      feedbackSubjectItemKeys: { shellfish: ["shellfish"] },
    }),
    runWeeklyShadowCycle({
      ...base,
      port: createMemoryProductionPort({
        portId: "memory-port:offline",
        openingEvents: consumptionFixture.openingEvents ?? [],
        targets: shadowTargets,
        failWith: "connector offline (simulated)",
      }),
    }),
  ]);

  const [clean, blocked] = await Promise.all([
    runSchedulerCycle({ controlPlane: cleanControlPlane, wakeAt: WAKE_AT, work: base }),
    runSchedulerCycle({ controlPlane: blockedControlPlane, wakeAt: WAKE_AT, work: base }),
  ]);

  return {
    now: options.now ?? weeklyNow(),
    weekly: [
      { id: "nominal", label: "Nominal week", run: nominal },
      { id: "constraint", label: "Safety rule in force", run: constrained },
      { id: "offline", label: "Source unavailable", run: offline },
    ],
    scheduler: [
      { id: "clean", label: "Normal wake-up", result: clean },
      { id: "blocked", label: "Blocked control plane", result: blocked },
    ],
    lab: runLabSuite(labCases, { targets: labTargets, now: labNow }),
    connectivity:
      options.connectivity ??
      { status: "UNKNOWN", detail: "Connector status not resolved.", missing: [] },
  };
}
