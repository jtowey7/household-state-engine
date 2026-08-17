import { runSchedulerCycle } from "./scheduler/cycle";
import { cleanControlPlane } from "./scheduler/fixtures";
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

/**
 * TEST-only deployed-runtime proof harness for the existing stateless scheduler.
 * It invokes the canonical scheduler cycle, then delivers the same wake-up a
 * second time using the recorded evidence as the wake ledger. No Airtable
 * connector or production household state is involved.
 */
export async function runDeployedTestSchedulerCycle(wakeAt: string) {
  const first = await runSchedulerCycle({
    controlPlane: cleanControlPlane,
    wakeAt,
    work,
  });

  const second = await runSchedulerCycle({
    controlPlane: cleanControlPlane,
    wakeAt,
    work,
    wakeLedger: [
      {
        cycleId: first.evidence.cycleId,
        wakeAt: first.evidence.wakeAt,
        evidence: first.evidence,
      },
    ],
  });

  return {
    first,
    duplicate: second,
    assertions: {
      highestPriorityDirective: first.evidence.directiveSelected === "DIR-010",
      executed: first.evidence.outcome === "EXECUTED",
      replayCompleted: first.evidence.checks.some(
        (check) => check.label === "Replay completed" && check.passed,
      ),
      quantityRequirementsProduced: first.run?.plan?.requirements.length ?? 0,
      basketProduced: first.run?.basket?.basketId ?? null,
      approvalUnGranted: first.run?.approval.granted === false,
      mutatedHouseholdState: first.evidence.mutatedHouseholdState,
      appendedEvents: first.evidence.appendedEvents,
      dispatched: first.evidence.dispatched,
      duplicateWakeInert:
        second.evidence.duplicateWakeOf === first.evidence.cycleId &&
        second.evidence.workPerformed === first.evidence.workPerformed,
    },
  };
}
