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
  /** Minimum number of non-zero signals required before a proposal can exist. */
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

  for (const signal of signals) {
    if (signal.direction === "match") continue;
    const key = `${signal.itemKey}|${signal.unit}|${signal.direction}`;
    const group = groups.get(key) ?? [];
    group.push(signal);
    groups.set(key, group);
  }

  const proposals: LearningProposal[] = [];
  for (const group of groups.values()) {
    if (group.length < minRepeatCount) continue;

    const relativeValues = group
      .map((signal) => signal.relativeDelta)
      .filter((value): value is number => value !== null);

    proposals.push({
      itemKey: group[0].itemKey,
      unit: group[0].unit,
      direction: group[0].direction,
      observationIds: group.map((signal) => signal.observationId),
      repeatCount: group.length,
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
