import { describe, expect, it } from "vitest";
import { runtimeHouseholdResponse } from "./runtime-household-response";

describe("deployed TEST scheduler cycle endpoint", () => {
  it("executes the canonical scheduler chain and proves duplicate wake inertness", async () => {
    const response = await runtimeHouseholdResponse(
      new Request("https://foodos.test/runtime/test/scheduler-cycle", {
        method: "POST",
        body: JSON.stringify({ wakeAt: "2026-08-17T00:00:00.000Z" }),
      }),
      {} as never,
    );

    expect(response?.status).toBe(200);
    const body = (await response?.json()) as {
      ok: boolean;
      mode: string;
      assertions: {
        highestPriorityDirective: boolean;
        executed: boolean;
        replayCompleted: boolean;
        quantityRequirementsProduced: number;
        basketProduced: string | null;
        approvalUnGranted: boolean;
        mutatedHouseholdState: boolean;
        appendedEvents: boolean;
        dispatched: boolean;
        duplicateWakeInert: boolean;
      };
    };

    expect(body.ok).toBe(true);
    expect(body.mode).toBe("TEST_ONLY");
    expect(body.assertions.highestPriorityDirective).toBe(true);
    expect(body.assertions.executed).toBe(true);
    expect(body.assertions.replayCompleted).toBe(true);
    expect(body.assertions.quantityRequirementsProduced).toBeGreaterThan(0);
    expect(body.assertions.basketProduced).toBeTruthy();
    expect(body.assertions.approvalUnGranted).toBe(true);
    expect(body.assertions.mutatedHouseholdState).toBe(false);
    expect(body.assertions.appendedEvents).toBe(false);
    expect(body.assertions.dispatched).toBe(false);
    expect(body.assertions.duplicateWakeInert).toBe(true);
  });
});
