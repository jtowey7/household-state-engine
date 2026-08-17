import { hashOf } from "./state-engine/hash";
import { runSchedulerCycle } from "./scheduler/cycle";
import { cleanControlPlane } from "./scheduler/fixtures";
import type { WakeLedgerEntry } from "./scheduler/types";
import { weeklyAsOf, weeklyNow, weeklyPlan, weeklyPort, weeklyScope } from "./weekly-cycle";
import { shadowCatalogue } from "./procurement";

const work = {
  port: weeklyPort,
  scope: weeklyScope,
  plan: weeklyPlan,
  asOf: weeklyAsOf,
  now: weeklyNow,
  catalogue: shadowCatalogue,
};

/** Stable TEST-only persistence key for a scheduler wake against this fixture. */
export function testSchedulerWakeRunId(wakeAt: string): string {
  return `TEST-SCHEDULER-CYCLE-${hashOf({ snapshotId: cleanControlPlane.snapshotId, wakeAt }).slice(0, 24)}`;
}

/**
 * TEST-only deployed-runtime proof harness for the existing stateless scheduler.
 * A fresh call executes one wake; a supplied durable ledger executes the real
 * canonical duplicate-wake path. No Airtable connector or Production state is involved.
 */
export async function runDeployedTestSchedulerCycle(
  wakeAt: string,
  wakeLedger: readonly WakeLedgerEntry[] = [],
) {
  const result = await runSchedulerCycle({
    controlPlane: cleanControlPlane,
    wakeAt,
    work,
    ...(wakeLedger.length > 0 ? { wakeLedger } : {}),
  });

  if (wakeLedger.length > 0) {
    return {
      first: null,
      duplicate: result,
      assertions: {
        duplicateWakeInert:
          result.evidence.duplicateWakeOf !== null &&
          result.evidence.workPerformed.toLowerCase().includes("no new work"),
        mutatedHouseholdState: result.evidence.mutatedHouseholdState,
        appendedEvents: result.evidence.appendedEvents,
        dispatched: result.evidence.dispatched,
      },
    };
  }

  return {
    first: result,
    duplicate: null,
    assertions: {
      highestPriorityDirective: result.evidence.directiveSelected === "DIR-010",
      executed: result.evidence.outcome === "EXECUTED",
      replayCompleted: result.evidence.checks.some(
        (check) => check.label === "Replay completed" && check.passed,
      ),
      quantityRequirementsProduced: result.run?.plan?.requirements.length ?? 0,
      basketProduced: result.run?.basket?.basketId ?? null,
      approvalUnGranted: result.run?.approval.granted === false,
      mutatedHouseholdState: result.evidence.mutatedHouseholdState,
      appendedEvents: result.evidence.appendedEvents,
      dispatched: result.evidence.dispatched,
      duplicateWakeInert: false,
    },
  };
}
