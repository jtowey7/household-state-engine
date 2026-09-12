import { describe, expect, it } from "vitest";
import { analyseInventoryOutcomes, type OutcomeObservation } from "./variance";

const observation = (
  overrides: Partial<OutcomeObservation> = {},
): OutcomeObservation => ({
  observationId: "OBS-1",
  itemKey: "chicken",
  expectedQuantity: 600,
  observedQuantity: 500,
  unit: "g",
  occurredAt: "2026-09-01T06:00:00.000Z",
  source: "delivery",
  ...overrides,
});

describe("governed inventory variance learning", () => {
  it("emits a transparent signal for a single variance but no learning proposal", () => {
    const result = analyseInventoryOutcomes([observation()]);

    expect(result.signals[0]).toMatchObject({
      delta: -100,
      direction: "under",
      relativeDelta: -1 / 6,
    });
    expect(result.proposals).toEqual([]);
  });

  it("requires repeat evidence before proposing a durable learning change", () => {
    const result = analyseInventoryOutcomes([
      observation({ observationId: "OBS-1" }),
      observation({ observationId: "OBS-2", observedQuantity: 450 }),
    ]);

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      itemKey: "chicken",
      direction: "under",
      repeatCount: 2,
      evidence: "repeatable-variance",
      promoted: false,
      observationIds: ["OBS-1", "OBS-2"],
    });
  });

  it("does not count an identical duplicate observation twice toward repeat evidence", () => {
    const result = analyseInventoryOutcomes([
      observation({ observationId: "OBS-1" }),
      observation({ observationId: "OBS-1" }),
    ]);

    expect(result.proposals).toEqual([]);
  });

  it("fails closed when the same observation id carries conflicting evidence", () => {
    expect(() =>
      analyseInventoryOutcomes([
        observation({ observationId: "OBS-1", observedQuantity: 500, source: "delivery" }),
        observation({ observationId: "OBS-1", observedQuantity: 450, source: "stock" }),
        observation({ observationId: "OBS-2", observedQuantity: 400 }),
      ]),
    ).toThrow("Conflicting observations for OBS-1");
  });

  it("does not allow a conflicting duplicate to be hidden by group differences", () => {
    expect(() =>
      analyseInventoryOutcomes([
        observation({ observationId: "OBS-1", observedQuantity: 500, itemKey: "chicken" }),
        observation({ observationId: "OBS-1", observedQuantity: 700, itemKey: "rice" }),
      ]),
    ).toThrow("Conflicting observations for OBS-1");
  });

  it("does not combine unrelated items, units, or directions into evidence", () => {
    const result = analyseInventoryOutcomes([
      observation({ observationId: "OBS-1" }),
      observation({ observationId: "OBS-2", itemKey: "rice" }),
      observation({ observationId: "OBS-3", observedQuantity: 700 }),
      observation({ observationId: "OBS-4", unit: "kg" }),
    ]);

    expect(result.proposals).toEqual([]);
  });

  it("keeps zero-expected outcomes non-promotable rather than inventing a percentage", () => {
    const result = analyseInventoryOutcomes([
      observation({ observationId: "OBS-1", expectedQuantity: 0, observedQuantity: 1 }),
      observation({ observationId: "OBS-2", expectedQuantity: 0, observedQuantity: 2 }),
    ]);

    expect(result.proposals[0]!.meanRelativeDelta).toBeNull();
    expect(result.signals.every((signal) => signal.relativeDelta === null)).toBe(true);
  });

  it("rejects negative quantities instead of silently normalising bad evidence", () => {
    expect(() =>
      analyseInventoryOutcomes([
        observation({ expectedQuantity: -1 }),
      ]),
    ).toThrow("Quantities must be non-negative");
  });

  it("rejects a policy that could promote from a single observation", () => {
    expect(() => analyseInventoryOutcomes([observation()], { minRepeatCount: 1 })).toThrow(
      "minRepeatCount must be an integer >= 2",
    );
  });
});
