import { hashOf } from "../state-engine/hash";
import { replayEvents, toQuantityRequirementsHandoff } from "../state-engine/engine";
import { projectConsumptionEvents } from "../consumption/projector";
import { adaptSnapshotToQuantityRun } from "../quantity-adapter/adapter";
import { loadProductionState } from "../production-adapter/adapter";
import { aggregateCandidateBasket } from "../procurement/adapter";
import { shadowCatalogue } from "../procurement/fixtures";
import { proposeAppends } from "../event-writer/propose";
import type { AppendProposal } from "../event-writer/propose";
import type {
  ApprovalGate,
  CycleStage,
  WeeklyCycleOptions,
  WeeklyCycleRun,
} from "./types";

function gate(readyForReview: boolean, reason: string): ApprovalGate {
  return { required: true, granted: false, readyForReview, reason };
}

/**
 * Runs one deterministic shadow weekly cycle. Never throws: a stage failure is
 * captured as a FAILED stage so the operator sees where the cycle stopped.
 */
export async function runWeeklyShadowCycle(
  options: WeeklyCycleOptions,
): Promise<WeeklyCycleRun> {
  const stages: CycleStage[] = [];
  const isolated = new Set<string>();
  const base = {
    scope: options.scope,
    asOf: options.asOf,
    source: null,
    projection: null,
    snapshot: null,
    handoff: null,
    plan: null,
    basket: null,
    appendProposals: [] as AppendProposal[],
    mutatedHouseholdState: false as const,
    appendedEvents: false as const,
    dispatched: false as const,
  };

  const source = await loadProductionState(options.port, options.scope);
  // Demand targets come from weekly planning, not from the event source.
  const demandTargets = options.demandTargets ?? source.targets;
  for (const key of source.quarantinedItemKeys) isolated.add(key);
  stages.push({
    stage: "LOAD_SOURCE",
    status: !source.ok ? "REFUSED" : source.rejections.length > 0 ? "WARNED" : "OK",
    detail: source.ok
      ? `Loaded ${source.openingEvents.length} opening events and ${demandTargets.length} demand targets (from planning).`
      : (source.rejections[0]?.detail ?? "Source read refused."),
    metrics: {
      portId: source.portId,
      mode: options.scope.mode,
      openingEvents: source.openingEvents.length,
      targets: demandTargets.length,
      quarantined: source.quarantinedItemKeys.length,
      writable: false,
    },
    warnings: source.rejections.filter((r) => !r.fatal).map((r) => `${r.code}: ${r.detail}`),
  });

  if (!source.ok) {
    const skipped = ([
      "PROJECT_CONSUMPTION",
      "PROPOSE_APPEND",
      "REPLAY",
      "HANDOFF",
      "QUANTITY_PLAN",
      "AGGREGATE_PROCUREMENT",
    ] as const).map(
      (stage): CycleStage => ({
        stage,
        status: "SKIPPED",
        detail: "Skipped: the source read was refused.",
        metrics: {},
        warnings: [],
      }),
    );
    stages.push(...skipped, {
      stage: "APPROVAL_GATE",
      status: "REFUSED",
      detail: "Nothing to review: the cycle never produced a plan.",
      metrics: { readyForReview: false },
      warnings: [],
    });
    return {
      ...base,
      cycleId: hashOf({ scope: options.scope, asOf: options.asOf, refused: source.rejections }),
      stages,
      source,
      approval: gate(false, "Source read refused; no plan was produced."),
      isolatedItemKeys: [...isolated].sort(),
      status: "REFUSED",
    };
  }

  try {
    const projection = projectConsumptionEvents(
      { ...options.plan, openingEvents: source.openingEvents },
      { asOf: options.asOf },
    );
    for (const key of projection.uncertainItemKeys) isolated.add(key);
    stages.push({
      stage: "PROJECT_CONSUMPTION",
      status: projection.uncertainItemKeys.length > 0 ? "WARNED" : "OK",
      detail: `Projected ${projection.events.length} household events from planned meals, allocations and exceptions.`,
      metrics: {
        events: projection.events.length,
        decisions: projection.decisions.length,
        uncertainItems: projection.uncertainItemKeys.length,
      },
      warnings: projection.uncertainItemKeys.map(
        (k) => `UNCERTAIN_QUANTITY: ${k} isolated from this run; unrelated items continue.`,
      ),
    });

    // PROPOSE_APPEND: prepare, never execute. The cycle constructs proposals
    // with no connector, so this stage is structurally unable to write.
    const appendProposals = proposeAppends(projection.events, {
      now: options.now ?? (() => options.asOf),
      existingEventIds: source.openingEvents.map((e) => e.eventId),
    });
    stages.push({
      stage: "PROPOSE_APPEND",
      status: appendProposals.some((p) => p.rejection) ? "WARNED" : "OK",
      detail: `${appendProposals.filter((p) => p.record).length} HOUSEHOLD EVENTS rows proposed for human authorisation. Nothing was written.`,
      metrics: {
        proposed: appendProposals.filter((p) => p.record).length,
        notProposable: appendProposals.filter((p) => p.rejection).length,
        written: 0,
        requiresHumanAuthorization: true,
      },
      warnings: appendProposals
        .filter((p) => p.rejection)
        .map((p) => `${p.rejection?.code}: ${p.sourceEventId}`),
    });

    const snapshot = replayEvents(projection.events, options.now ? { now: options.now } : {});
    for (const key of snapshot.blockedItemKeys) isolated.add(key);
    stages.push({
      stage: "REPLAY",
      status:
        snapshot.reconciliationStatus === "CLEAN"
          ? "OK"
          : snapshot.reconciliationStatus === "EXCEPTIONS"
            ? "WARNED"
            : "REFUSED",
      detail: `Replay ${snapshot.reconciliationStatus}: ${snapshot.items.length} items materialised, ${snapshot.ignoredEventIds.length} events ignored.`,
      metrics: {
        replayId: snapshot.replayId,
        snapshotId: snapshot.snapshotId,
        items: snapshot.items.length,
        applied: snapshot.contributingEventIds.length,
        ignored: snapshot.ignoredEventIds.length,
        blocked: snapshot.blockedItemKeys.length,
      },
      warnings: snapshot.exceptions.map((e) => `${e.code}: ${e.detail}`),
    });

    const rawHandoff = toQuantityRequirementsHandoff(snapshot);
    const uncertain = new Set(projection.uncertainItemKeys);
    // Uncertain items are DROPPED from the handoff rather than marked blocked:
    // they are simply not procured this cycle, and unrelated items keep
    // planning instead of the whole run being refused. Genuinely blocked items
    // (replay conflicts) stay blocked and still refuse the run.
    const handoff = {
      ...rawHandoff,
      items: rawHandoff.items.filter((i) => !uncertain.has(i.itemKey)),
    };
    const withheld = [...new Set([...handoff.blockedItemKeys, ...uncertain])].sort();
    stages.push({
      stage: "HANDOFF",
      status: handoff.readyForQuantityRun && withheld.length === 0 ? "OK" : "WARNED",
      detail: `Handoff carries ${handoff.items.length} items; ${withheld.length} withheld.`,
      metrics: {
        items: handoff.items.length,
        withheld: withheld.length,
        readyForQuantityRun: handoff.readyForQuantityRun,
      },
      warnings: withheld.map((k) => `withheld from quantity run: ${k}`),
    });


    // Isolated (blocked/uncertain) items are withheld line-by-line and never
    // procured on a guess; unrelated items keep planning.
    const plan = adaptSnapshotToQuantityRun(handoff, {
      targets: demandTargets,
      blockedItemPolicy: "ISOLATE_ITEMS",
      isolatedItemKeys: [...isolated].sort(),
    });

    stages.push({
      stage: "QUANTITY_PLAN",
      status: plan.executed ? (plan.rejections.length > 0 ? "WARNED" : "OK") : "REFUSED",
      detail: plan.executed
        ? `${plan.requirements.length} quantity requirements emitted; ${plan.rejections.length} lines rejected.`
        : (plan.rejections[0]?.detail ?? "Quantity run refused."),
      metrics: {
        planId: plan.planId,
        requirements: plan.requirements.length,
        rejections: plan.rejections.length,
        eligibleForProcurement: plan.eligibleForProcurement,
      },
      warnings: plan.rejections.map((r) => `${r.code}: ${r.detail}`),
    });

    const basket = aggregateCandidateBasket(plan, {
      catalogue: options.catalogue ?? shadowCatalogue,
    });
    stages.push({
      stage: "AGGREGATE_PROCUREMENT",
      status: basket.readyForReview ? (basket.exceptions.length > 0 ? "WARNED" : "OK") : "REFUSED",
      detail: basket.readyForReview
        ? `Candidate basket: ${basket.lines.length} lines, ${basket.exceptions.length} exceptions. Nothing dispatched.`
        : (basket.exceptions[0]?.detail ?? "No candidate basket built."),
      metrics: {
        basketId: basket.basketId,
        lines: basket.lines.length,
        totalCost: basket.totalCost,
        exceptions: basket.exceptions.length,
        dispatched: false,
      },
      warnings: basket.exceptions.map((e) => `${e.code}: ${e.detail}`),
    });

    const ready = plan.executed && plan.eligibleForProcurement && basket.readyForReview;
    stages.push({
      stage: "APPROVAL_GATE",
      status: ready ? "OK" : "REFUSED",
      detail: ready
        ? "Shadow proposal (quantity plan + candidate basket) is ready for human review. Approval and purchase execution stay outside this runtime."
        : "No approvable proposal: the quantity run produced nothing eligible.",
      metrics: { required: true, granted: false, readyForReview: ready, dispatched: false },
      warnings: [],
    });

    return {
      ...base,
      cycleId: hashOf({
        scope: options.scope,
        asOf: options.asOf,
        sourceId: source.sourceId,
        snapshotId: snapshot.snapshotId,
        planId: plan.planId,
        basketId: basket.basketId,
      }),
      stages,
      source,
      projection,
      appendProposals,
      snapshot,
      handoff,
      plan,
      basket,
      approval: ready
        ? gate(true, "Awaiting human approval; the runtime never approves or purchases.")
        : gate(false, "Quantity run produced no eligible requirements."),
      isolatedItemKeys: [...isolated].sort(),
      status: plan.executed ? "COMPLETED" : "REFUSED",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stages.push({
      stage: "APPROVAL_GATE",
      status: "FAILED",
      detail: `Cycle aborted: ${message}`,
      metrics: { readyForReview: false },
      warnings: [message],
    });
    return {
      ...base,
      cycleId: hashOf({ scope: options.scope, asOf: options.asOf, failure: message }),
      stages,
      source,
      approval: gate(false, `Cycle failed before review: ${message}`),
      isolatedItemKeys: [...isolated].sort(),
      status: "FAILED",
    };
  }
}
