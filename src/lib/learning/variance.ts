export type VarianceDirection = "under" | "over" | "match";

export interface OutcomeObservation {
  observationId: string;
  itemKey: string;
  expectedQuantity: number;
  observedQuantity: number;
  unit: string;
  occurredAt: string;
  source: "delivery" | "stock" | "consumption";
}

export interface VarianceSignal {
  observationId: string;
  itemKey: string;
  unit: string;
  source: OutcomeObservation["source"];
  expectedQuantity: number;
  observedQuantity: number;
  delta: number;
  direction: VarianceDirection;
  relativeDelta: number | null;
}

export interface LearningProposal {
  itemKey: string;
  unit: string;
  direction: Exclude<VarianceDirection, "match">;
  observationIds: string[];
  repeatCount: number;
  meanRelativeDelta: number | null;
  evidence: "repeatable-variance";
  promoted: false;
}

export interface LearningResult {
  signals: VarianceSignal[];
  proposals: LearningProposal[];
}

export interface LearningOptions {
  /** Minimum number of distinct non-zero observations required before a proposal can exist. */
  minRepeatCount?: number;
}

/**
 * Compare expected and observed outcomes without mutating household state.
 * This is deliberately a pure, proposal-only learning boundary.
 */
export function analyseInventoryOutcomes(
  observations: readonly OutcomeObservation[],
  options: LearningOptions = {},
): LearningResult {
  const minRepeatCount = options.minRepeatCount ?? 2;
  if (!Number.isInteger(minRepeatCount) || minRepeatCount < 2) {
    throw new Error("minRepeatCount must be an integer >= 2");
  }

  const signals = observations.map(toSignal);
  const groups = new Map<string, VarianceSignal[]>();
  const seen = new Map<string, VarianceSignal>();

  for (const signal of signals) {
    const prior = seen.get(signal.observationId);
    if (prior && !sameObservation(prior, signal)) {
      throw new Error(
        `Conflicting observations for ${signal.observationId}`,
      );
    }
    seen.set(signal.observationId, signal);

    if (signal.direction === "match") continue;
    const key = `${signal.itemKey}|${signal.unit}|${signal.direction}`;
    const group = groups.get(key) ?? [];
    group.push(signal);
    groups.set(key, group);
  }

  const proposals: LearningProposal[] = [];
  for (const group of groups.values()) {
    const distinctGroup = [...new Map(group.map((signal) => [signal.observationId, signal])).values()];
    if (distinctGroup.length < minRepeatCount) continue;

    const relativeValues = distinctGroup
      .map((signal) => signal.relativeDelta)
      .filter((value): value is number => value !== null);

    const head = distinctGroup[0]!;
    if (head.direction === "match") continue;
    proposals.push({
      itemKey: head.itemKey,
      unit: head.unit,
      direction: head.direction,
      observationIds: distinctGroup.map((signal) => signal.observationId),
      repeatCount: distinctGroup.length,
      meanRelativeDelta:
        relativeValues.length > 0
          ? relativeValues.reduce((sum, value) => sum + value, 0) /
            relativeValues.length
          : null,
      evidence: "repeatable-variance",
      promoted: false,
    });
  }

  return { signals, proposals };
}

function sameObservation(a: VarianceSignal, b: VarianceSignal): boolean {
  return (
    a.itemKey === b.itemKey &&
    a.unit === b.unit &&
    a.source === b.source &&
    a.expectedQuantity === b.expectedQuantity &&
    a.observedQuantity === b.observedQuantity &&
    a.delta === b.delta &&
    a.direction === b.direction &&
    a.relativeDelta === b.relativeDelta
  );
}

function toSignal(observation: OutcomeObservation): VarianceSignal {
  if (!Number.isFinite(observation.expectedQuantity)) {
    throw new Error(`Invalid expected quantity for ${observation.observationId}`);
  }
  if (!Number.isFinite(observation.observedQuantity)) {
    throw new Error(`Invalid observed quantity for ${observation.observationId}`);
  }
  if (observation.expectedQuantity < 0 || observation.observedQuantity < 0) {
    throw new Error(`Quantities must be non-negative for ${observation.observationId}`);
  }

  const delta = observation.observedQuantity - observation.expectedQuantity;
  const direction: VarianceDirection =
    delta === 0 ? "match" : delta < 0 ? "under" : "over";

  return {
    observationId: observation.observationId,
    itemKey: observation.itemKey,
    unit: observation.unit,
    source: observation.source,
    expectedQuantity: observation.expectedQuantity,
    observedQuantity: observation.observedQuantity,
    delta,
    direction,
    relativeDelta:
      observation.expectedQuantity === 0
        ? null
        : delta / observation.expectedQuantity,
  };
}
