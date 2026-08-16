/**
 * Food OS — adapter → replay → QUANTITY REQUIREMENTS safety-boundary proof.
 *
 * Composes ONLY existing modules:
 *   mapHouseholdEventRowsWithEvidencePrecision()  (read-only source mapping)
 *     -> replayEvents()                            (canonical State Engine)
 *       -> toQuantityRequirementsHandoff()
 *         -> adaptSnapshotToQuantityRun()          (ISOLATE_ITEMS)
 *
 * It re-implements no replay, quantity or procurement maths, performs no I/O,
 * and never writes. Synthetic fixtures only.
 */

import { mapHouseholdEventRowsWithEvidencePrecision } from "../production-adapter/evidence-aware-mapper";
import type { AirtableRow } from "../production-adapter/airtable-port";
import { replayEvents, toQuantityRequirementsHandoff } from "../state-engine/engine";
import type {
  HouseholdEvent,
  QuantityRequirementsHandoff,
  StateSnapshot,
} from "../state-engine/types";
import { adaptSnapshotToQuantityRun } from "../quantity-adapter/adapter";
import type { DemandTarget, QuantityRunPlan } from "../quantity-adapter/types";

export interface ProofCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface SafetyProofRun {
  /** Canonical events mapped from the synthetic source rows. */
  events: HouseholdEvent[];
  /** Source rows the mapper refused (structural failures). */
  mappingFailures: Array<{ code: string; detail: string }>;
  snapshot: StateSnapshot;
  handoff: QuantityRequirementsHandoff;
  plan: QuantityRunPlan;
  checks: ProofCheck[];
  passed: boolean;
  /** This proof never dispatches procurement and never writes. */
  dispatched: false;
  readOnly: true;
}

export interface SafetyProofOptions {
  rows: readonly AirtableRow[];
  targets: readonly DemandTarget[];
  now?: () => string;
  /** Item expected to be blocked by qualified source evidence. */
  qualifiedItemKey: string;
  /** Item expected to stay eligible for the quantity run. */
  exactItemKey: string;
  /** Event ID of the Record class = Test row that must have zero effect. */
  testEventId: string;
}

function check(id: string, label: string, passed: boolean, detail: string): ProofCheck {
  return { id, label, passed, detail };
}

export function runSafetyBoundaryProof(options: SafetyProofOptions): SafetyProofRun {
  const mapped = mapHouseholdEventRowsWithEvidencePrecision([...options.rows]);
  const events: HouseholdEvent[] = [];
  const mappingFailures: Array<{ code: string; detail: string }> = [];
  for (const result of mapped) {
    if (result.ok) events.push(result.event);
    else mappingFailures.push({ code: result.code, detail: result.detail });
  }

  const snapshot = replayEvents(events, options.now ? { now: options.now } : {});
  const handoff = toQuantityRequirementsHandoff(snapshot);
  const plan = adaptSnapshotToQuantityRun(handoff, {
    targets: options.targets,
    blockedItemPolicy: "ISOLATE_ITEMS",
  });

  const exactItem = snapshot.items.find((i) => i.itemKey === options.exactItemKey);
  const qualifiedItem = snapshot.items.find((i) => i.itemKey === options.qualifiedItemKey);
  const handoffKeys = handoff.items.map((i) => i.itemKey);
  const requirementKeys = plan.requirements.map((r) => r.itemKey);
  const handoffEventIds = new Set(handoff.items.flatMap((i) => i.sourceEventIds));
  const requirementEventIds = plan.requirements.flatMap((r) => r.sourceEventIds);

  const checks: ProofCheck[] = [
    check(
      "PROD_EVENTS_MAPPED",
      "Production rows map to canonical events",
      mappingFailures.length === 0 && events.length > 0,
      `${events.length} canonical event(s) mapped, ${mappingFailures.length} structural failure(s).`,
    ),
    check(
      "TEST_ROWS_INERT",
      "Record class = Test has zero effect",
      !snapshot.contributingEventIds.includes(options.testEventId) &&
        snapshot.ignoredEventIds.includes(options.testEventId) &&
        !(exactItem?.contributingEventIds ?? []).includes(options.testEventId) &&
        !handoffEventIds.has(options.testEventId) &&
        !requirementEventIds.includes(options.testEventId),
      `Test event ${options.testEventId} is ignored and absent from state, handoff and requirements.`,
    ),
    check(
      "QUALIFIED_ITEM_BLOCKED",
      "Qualified evidence blocks only the affected item",
      qualifiedItem?.evidencePrecision === "QUALIFIED_AMBIGUOUS" &&
        qualifiedItem?.blocked === true &&
        snapshot.blockedItemKeys.includes(options.qualifiedItemKey) &&
        !handoffKeys.includes(options.qualifiedItemKey) &&
        !requirementKeys.includes(options.qualifiedItemKey) &&
        plan.rejections.some(
          (r) => r.code === "ITEM_ISOLATED" && r.itemKey === options.qualifiedItemKey,
        ),
      `${options.qualifiedItemKey} is withheld from the handoff and the quantity run with an explicit ITEM_ISOLATED rejection.`,
    ),
    check(
      "UNRELATED_ITEMS_ELIGIBLE",
      "Unrelated exact items stay eligible",
      exactItem?.blocked === false &&
        handoffKeys.includes(options.exactItemKey) &&
        requirementKeys.includes(options.exactItemKey) &&
        plan.executed &&
        plan.eligibleForProcurement,
      `${options.exactItemKey} produced a quantity requirement while ${options.qualifiedItemKey} was isolated.`,
    ),
    check(
      "IDENTITY_PRESERVED",
      "Handoff preserves replayId / snapshotId / source event IDs",
      handoff.replayId === snapshot.replayId &&
        handoff.snapshotId === snapshot.snapshotId &&
        plan.replayId === snapshot.replayId &&
        plan.snapshotId === snapshot.snapshotId &&
        plan.replayTimestamp === snapshot.replayTimestamp &&
        requirementEventIds.length > 0 &&
        requirementEventIds.every((id) => snapshot.contributingEventIds.includes(id)),
      `replayId ${snapshot.replayId} and snapshotId ${snapshot.snapshotId} carried through; every requirement source event ID traces back to the replay.`,
    ),
  ];

  return {
    events,
    mappingFailures,
    snapshot,
    handoff,
    plan,
    checks,
    passed: checks.every((c) => c.passed),
    dispatched: false,
    readOnly: true,
  };
}
