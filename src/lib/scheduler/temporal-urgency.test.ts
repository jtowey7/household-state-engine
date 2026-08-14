import { describe, expect, it } from "vitest";
import { selectWork } from "./control-plane";
import { classifyTemporalUrgency } from "./temporal-urgency";

const wakeAt = "2026-08-14T08:00:00.000Z";

function directive(
  directiveId: string,
  priority: "P0" | "P1" | "P2",
  dueAt?: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    directiveId,
    title: directiveId,
    kind: "STOCK_EXCEPTION_REVIEW" as const,
    priority,
    status: "READY" as const,
    actionPolicy: "PREPARE" as const,
    ...(dueAt ? { dueAt } : {}),
    ...overrides,
  };
}

describe("temporal urgency", () => {
  it.each([
    ["NORMAL", "2026-08-15T08:01:00.000Z"],
    ["TIME-SENSITIVE", "2026-08-14T12:01:00.000Z"],
    ["DEADLINE", "2026-08-14T10:00:00.000Z"],
    ["OVERDUE", "2026-08-14T07:00:00.000Z"],
    ["MISSED", "2026-08-12T07:00:00.000Z"],
  ])("classifies %s deterministically", (state, dueAt) => {
    expect(classifyTemporalUrgency({ dueAt, wakeAt }).state).toBe(state);
  });

  it("rejects invalid timestamps instead of inventing urgency", () => {
    expect(() =>
      classifyTemporalUrgency({ dueAt: "not-a-date", wakeAt }),
    ).toThrow("valid ISO timestamps");
  });
});

describe("deadline-driven selection", () => {
  it("lets a consequential P1 deadline outrank a normal P0", () => {
    const result = selectWork(
      {
        mode: "SYNTHETIC",
        snapshotId: "SNAPSHOT-TEMPORAL-01",
        readAt: wakeAt,
        directives: [
          directive("P0-NORMAL", "P0"),
          directive("P1-DEADLINE", "P1", "2026-08-14T09:00:00.000Z"),
        ],
      },
      { wakeAt },
    );

    expect(result.selected).toBe(true);
    if (result.selected) expect(result.directive.directiveId).toBe("P1-DEADLINE");
  });

  it("does not promote blocked or execute-policy work because it has a deadline", () => {
    const result = selectWork(
      {
        mode: "SYNTHETIC",
        snapshotId: "SNAPSHOT-TEMPORAL-02",
        readAt: wakeAt,
        directives: [
          directive("P0-NORMAL", "P0"),
          directive("P1-BLOCKED-DEADLINE", "P1", "2026-08-14T09:00:00.000Z", {
            status: "BLOCKED",
            blockedReason: "Waiting for evidence",
          }),
          directive("P1-EXECUTE-DEADLINE", "P1", "2026-08-14T09:00:00.000Z", {
            actionPolicy: "EXECUTE",
          }),
        ],
      },
      { wakeAt },
    );

    expect(result.selected).toBe(true);
    if (result.selected) expect(result.directive.directiveId).toBe("P0-NORMAL");
  });

  it("does not let a missed directive outrank viable normal work", () => {
    const result = selectWork(
      {
        mode: "SYNTHETIC",
        snapshotId: "SNAPSHOT-TEMPORAL-03",
        readAt: wakeAt,
        directives: [
          directive("P0-NORMAL", "P0"),
          directive("P1-MISSED", "P1", "2026-08-12T07:00:00.000Z"),
        ],
      },
      { wakeAt },
    );

    expect(result.selected).toBe(true);
    if (result.selected) expect(result.directive.directiveId).toBe("P0-NORMAL");
  });
});
