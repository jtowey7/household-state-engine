import { hashOf } from "../state-engine/hash";
import { replayEvents, toQuantityRequirementsHandoff } from "../state-engine/engine";
import { projectConsumptionEvents } from "../consumption/projector";
import { buildDeliveryInventoryTransition } from "../state-engine/delivery-inventory";
import type { DeliveryInventoryTransition } from "../state-engine/delivery-inventory";
import type { HouseholdEvent } from "../state-engine/types";
import { adaptSnapshotToQuantityRun } from "../quantity-adapter/adapter";
import { loadProductionState } from "../production-adapter/adapter";
import { aggregateCandidateBasket } from "../procurement/adapter";
import { shadowCatalogue } from "../procurement/fixtures";
import { proposeAppends } from "../event-writer/propose";
import type { AppendProposal } from "../event-writer/propose";
import { proposeMealCompletionConsumption } from "../meal-completion/adapter";
import type { MealCompletionProposalRun } from "../meal-completion/types";
import { proposeStockExceptionCorrections } from "../inventory-exception/adapter";
import type { StockExceptionProposalRun } from "../inventory-exception/types";
import { evaluateCycleFeedbackGate } from "../feedback/cycle-gate";
import type { CycleFeedbackGate } from "../feedback/cycle-gate";
import { createHouseholdEventWriter } from "../event-writer/writer";
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
    mealProposals: null as MealCompletionProposalRun | null,
    exceptionProposals: null as StockExceptionProposalRun | null,
    deliveryTransitions: [] as DeliveryInventoryTransition[],
    feedbackGate: null as CycleFeedbackGate | null,
    mutatedHouseholdState: false as const,
    appendedEvents: false as const,
    dispatched: false as const,
  };

  const source = await loadProductionState(options.port, options.scope);
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
      "RECEIVE_DELIVERY",
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

    const deliveryTransitions: DeliveryInventoryTransition[] = [];
    const deliveryWarnings: string[] = [];
    const knownEventIds = new Set(source.openingEvents.map((e) => e.eventId));
    for (const event of projection.events) knownEventIds.add(event.eventId);
    const deliveryEvents: HouseholdEvent[] = [];
    let duplicateDeliveryEvents = 0;
    let substitutedLines = 0;
    for (const delivery of options.deliveries ?? []) {
      try {
        const transition = buildDeliveryInventoryTransition(delivery);
        deliveryTransitions.push(transition);
        substitutedLines += delivery.lines.filter((l) => l.substituted === true).length;
        for (const event of transition.events) {
          if (knownEventIds.has(event.eventId)) {
            duplicateDeliveryEvents += 1;
            continue;
          }
          knownEventIds.add(event.eventId);
          deliveryEvents.push(event);
        }
      } catch (error) {
        deliveryWarnings.push(
          `DELIVERY_REFUSED: ${delivery.deliveryId} — ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }


    // Sealed human delivery evidence enters the SAME cycle path as reconciled
    // deliveries. It is verified, canonicalised into HOUSEHOLD EVENTS append
    // intents, and proposed only. No Airtable I/O, no write, no dispatch.
    const evidenceRecords: CanonicalAppendRecord[] = [];
    const evidenceIds = new Set<string>();
    let refusedEvidence = 0;
    let duplicateEvidenceRecords = 0;
    for (const evidence of options.deliveryEvidence ?? []) {
      const handoff = prepareDeliveryEvidenceHandoff(evidence, options.now ?? (() => options.asOf));
      if (!handoff.ok) {
        refusedEvidence += 1;
        deliveryWarnings.push(
          `DELIVERY_EVIDENCE_REFUSED: ${evidence.evidenceId} — ${handoff.code}: ${handoff.detail}`,
        );
        continue;
      }
      evidenceIds.add(evidence.evidenceId);
      for (const record of handoff.records) {
        if (knownEventIds.has(record.eventId) || evidenceRecords.some((r) => r.eventId === record.eventId)) {
          duplicateEvidenceRecords += 1;
          continue;
        }
        evidenceRecords.push(record);
      }
    }


    stages.push({
      stage: "RECEIVE_DELIVERY",
      status:
        (options.deliveries ?? []).length === 0
          ? "SKIPPED"
          : deliveryWarnings.length > 0 || duplicateDeliveryEvents > 0
            ? "WARNED"
            : "OK",
      detail:
        (options.deliveries ?? []).length === 0
          ? "No reconciled delivery supplied for this cycle."
          : `${deliveryTransitions.length} reconciled delivery/deliveries received as ${deliveryEvents.length} append-only stock receipts. Nothing was written.`,
      metrics: {
        deliveries: (options.deliveries ?? []).length,
        received: deliveryTransitions.length,
        refused: deliveryWarnings.length,
        receiptEvents: deliveryEvents.length,
        duplicateReceipts: duplicateDeliveryEvents,
        substitutedLines,
        mutatedProductionState: false,
        written: 0,
      },
      warnings: [
        ...deliveryWarnings,
        ...(duplicateDeliveryEvents > 0
          ? [`DUPLICATE_DELIVERY_RECEIPT_IGNORED: ${duplicateDeliveryEvents} receipt event(s) already present.`]
          : []),
      ],
    });

    const appendProposals = proposeAppends([...projection.events, ...deliveryEvents], {
      now: options.now ?? (() => options.asOf),
      existingEventIds: source.openingEvents.map((e) => e.eventId),
    });
    const mealProposals = proposeMealCompletionConsumption(options.mealCompletions ?? [], {
      now: options.now ?? (() => options.asOf),
      knownProposals: options.knownMealProposals ?? [],
    });
    const exceptionProposals = proposeStockExceptionCorrections(options.stockExceptions ?? [], {
      now: options.now ?? (() => options.asOf),
      knownProposals: options.knownStockExceptions ?? [],
    });
    const proposeWriter = createHouseholdEventWriter({ mode: "PROPOSE" });
    const alreadyProposed = new Set(appendProposals.map((p) => p.record?.eventId).filter(Boolean));
    for (const mp of mealProposals.proposals) {
      if (alreadyProposed.has(mp.eventId)) continue;
      alreadyProposed.add(mp.eventId);
      appendProposals.push({
        sourceEventId: `${mp.completionId}::${mp.itemKey}`,
        record: mp.record,
        receipt: proposeWriter.propose(mp.record),
        rejection: null,
        requiresHumanAuthorization: true,
      });
    }

    for (const ep of exceptionProposals.proposals) {
      if (ep.recordClass !== "Production") continue;
      if (alreadyProposed.has(ep.eventId)) continue;
      alreadyProposed.add(ep.eventId);
      appendProposals.push({
        sourceEventId: ep.proposalKey,
        record: ep.record,
        receipt: proposeWriter.propose(ep.record),
        rejection: null,
        requiresHumanAuthorization: true,
      });
    }

    stages.push({
      stage: "PROPOSE_APPEND",
      status: appendProposals.some((p) => p.rejection) ? "WARNED" : "OK",
      detail: `${appendProposals.filter((p) => p.record).length} HOUSEHOLD EVENTS rows proposed for human authorisation. Nothing was written.`,
      metrics: {
        proposed: appendProposals.filter((p) => p.record).length,
        notProposable: appendProposals.filter((p) => p.rejection).length,
        written: 0,
        mealProposals: mealProposals.proposals.length,
        mealProposalsDeduped: mealProposals.deduped.length,
        mealProposalExceptions: mealProposals.exceptions.length,
        exceptionCorrections: exceptionProposals.proposals.length,
        exceptionCorrectionsDeduped: exceptionProposals.deduped.length,
        exceptionCorrectionsRefused: exceptionProposals.rejections.length,
        requiresHumanAuthorization: true,
      },
      warnings: [
        ...appendProposals
          .filter((p) => p.rejection)
          .map((p) => `${p.rejection?.code}: ${p.sourceEventId}`),
        ...mealProposals.exceptions.map((e) => `${e.code}: ${e.mealId}${e.itemKey ? `/${e.itemKey}` : ""}`),
        ...exceptionProposals.rejections.map((r) => `${r.code}: ${r.exceptionId}${r.itemKey ? `/${r.itemKey}` : ""}`),
      ],
    });

    const snapshot = replayEvents(
      [...projection.events, ...deliveryEvents],
      options.now ? { now: options.now } : {},
    );
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

    const feedbackGate = evaluateCycleFeedbackGate(options.feedbackReports ?? [], {
      itemKeys: demandTargets.map((t) => t.itemKey),
      ...(options.feedbackSubjectItemKeys
        ? { subjectItemKeys: options.feedbackSubjectItemKeys }
        : {}),
    });
    for (const key of feedbackGate.isolatedItemKeys) isolated.add(key);
    stages.push({
      stage: "FEEDBACK_GATE",
      status: !feedbackGate.allowed
        ? "REFUSED"
        : feedbackGate.isolatedItemKeys.length > 0 || feedbackGate.review.exceptions.length > 0
          ? "WARNED"
          : "OK",
      detail: feedbackGate.allowed
        ? `Feedback review ${feedbackGate.review.status}: ${feedbackGate.preferenceProposals.length} durable preference proposal(s), ${feedbackGate.isolatedItemKeys.length} item(s) isolated. Nothing applied.`
        : `Downstream refused before quantity planning: ${feedbackGate.refusedAreas.join(", ")}.`,
      metrics: {
        gateId: feedbackGate.gateId,
        reviewId: feedbackGate.review.reviewId,
        reviewStatus: feedbackGate.review.status,
        reports: (options.feedbackReports ?? []).length,
        preferenceProposals: feedbackGate.preferenceProposals.length,
        isolatedItems: feedbackGate.isolatedItemKeys.length,
        refusedAreas: feedbackGate.refusedAreas.length,
        applied: false,
        dispatched: false,
      },
      warnings: [
        ...feedbackGate.blockingReasons,
        ...feedbackGate.review.exceptions.map((e: { code: string; subject: string }) => `${e.code}: ${e.subject}`),
      ],
    });

    if (!feedbackGate.allowed) {
      for (const stage of ["QUANTITY_PLAN", "AGGREGATE_PROCUREMENT"] as const) {
        stages.push({
          stage,
          status: "SKIPPED",
          detail: "Skipped: the feedback propagation gate refused the affected area(s).",
          metrics: {},
          warnings: [],
        });
      }
      stages.push({
        stage: "APPROVAL_GATE",
        status: "REFUSED",
        detail:
          "No approvable proposal: a hard feedback constraint blocks quantity/procurement until it is enforced and proven.",
        metrics: { required: true, granted: false, readyForReview: false, dispatched: false },
        warnings: [],
      });
      return {
        ...base,
        cycleId: hashOf({
          scope: options.scope,
          asOf: options.asOf,
          sourceId: source.sourceId,
          snapshotId: snapshot.snapshotId,
          feedbackGateId: feedbackGate.gateId,
        }),
        stages,
        source,
        projection,
        appendProposals,
        mealProposals,
        exceptionProposals,
        deliveryTransitions,
        feedbackGate,
        snapshot,
        handoff,
        approval: gate(
          false,
          `Feedback gate refused ${feedbackGate.refusedAreas.join(", ")} before planning.`,
        ),
        isolatedItemKeys: [...isolated].sort(),
        status: "REFUSED",
      };
    }

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
      status: basket.readyForReview ? (basket.complete && basket.exceptions.length === 0 ? "OK" : "WARNED") : "REFUSED",
      detail: basket.readyForReview
        ? `Candidate basket: ${basket.lines.length} lines, ${basket.exceptions.length} exceptions. Nothing dispatched.`
        : (basket.exceptions[0]?.detail ?? "No candidate basket built."),
      metrics: {
        basketId: basket.basketId,
        lines: basket.lines.length,
        totalCost: basket.totalCost,
        exceptions: basket.exceptions.length,
        coverageComplete: basket.complete,
        unsourcedItems: basket.coverage.unsourcedItemKeys.length,
        readyForApproval: basket.readyForApproval,
        dispatched: false,
      },
      warnings: basket.exceptions.map((e) => `${e.code}: ${e.detail}`),
    });

    // A proposal is reviewable only when it is also approval-ready. This keeps
    // the cycle's human gate aligned with the canonical basket writer and
    // prevents an incomplete/unsourced basket from being represented as an
    // actionable Family Alpha approval candidate.
    const ready = plan.executed && plan.eligibleForProcurement && basket.readyForApproval;
    stages.push({
      stage: "APPROVAL_GATE",
      status: ready ? "OK" : "REFUSED",
      detail: ready
        ? "Shadow proposal (quantity plan + complete candidate basket) is ready for human review. Approval and purchase execution stay outside this runtime."
        : "No approval-ready proposal: the quantity run or candidate basket is incomplete/ineligible.",
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
        feedbackGateId: feedbackGate.gateId,
        planId: plan.planId,
        basketId: basket.basketId,
      }),
      stages,
      source,
      projection,
      appendProposals,
      mealProposals,
      exceptionProposals,
      deliveryTransitions,
      feedbackGate,
      snapshot,
      handoff,
      plan,
      basket,
      approval: ready
        ? gate(
            true,
            "Awaiting human approval; the runtime never approves or purchases.",
          )
        : gate(false, "No approval-ready candidate basket was produced."),
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