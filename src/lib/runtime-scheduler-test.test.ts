import { describe, expect, it } from "vitest";
import { runtimeHouseholdResponse } from "./runtime-household-response";

type Row = { evidence: string };

function memoryD1() {
  const rows = new Map<string, Row>();
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          args = values;
          return this;
        },
        async all() {
          if (sql.includes("SELECT evidence FROM runtime_runs")) {
            const row = rows.get(String(args[0]));
            return { results: row ? [row] : [], success: true };
          }
          return { results: [], success: true };
        },
        async run() {
          if (sql.includes("INSERT OR IGNORE INTO runtime_runs")) {
            const key = String(args[0]);
            if (!rows.has(key)) rows.set(key, { evidence: String(args[5]) });
          }
          return { results: [], success: true, meta: { changes: 1 } };
        },
      };
    },
    async batch() {
      return [];
    },
  };
}

describe("deployed TEST scheduler cycle endpoint", () => {
  it("proves the duplicate wake remains inert across separate HTTP invocations", async () => {
    const db = memoryD1();
    const request = () =>
      runtimeHouseholdResponse(
        new Request("https://foodos.test/runtime/test/scheduler-cycle", {
          method: "POST",
          body: JSON.stringify({ wakeAt: "2026-08-17T00:00:00.000Z" }),
        }),
        db,
      );

    const firstResponse = await request();
    expect(firstResponse?.status).toBe(200);
    const first = (await firstResponse?.json()) as {
      ok: boolean;
      mode: string;
      phase: string;
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
      };
    };

    expect(first.ok).toBe(true);
    expect(first.mode).toBe("TEST_ONLY");
    expect(first.phase).toBe("FIRST");
    expect(first.assertions.highestPriorityDirective).toBe(true);
    expect(first.assertions.executed).toBe(true);
    expect(first.assertions.replayCompleted).toBe(true);
    expect(first.assertions.quantityRequirementsProduced).toBeGreaterThan(0);
    expect(first.assertions.basketProduced).toBeTruthy();
    expect(first.assertions.approvalUnGranted).toBe(true);
    expect(first.assertions.mutatedHouseholdState).toBe(false);
    expect(first.assertions.appendedEvents).toBe(false);
    expect(first.assertions.dispatched).toBe(false);

    const duplicateResponse = await request();
    expect(duplicateResponse?.status).toBe(200);
    const duplicate = (await duplicateResponse?.json()) as {
      ok: boolean;
      mode: string;
      phase: string;
      assertions: {
        duplicateWakeInert: boolean;
        mutatedHouseholdState: boolean;
        appendedEvents: boolean;
        dispatched: boolean;
      };
      duplicate: { duplicateWakeOf: string | null; workPerformed: string };
    };

    expect(duplicate.ok).toBe(true);
    expect(duplicate.mode).toBe("TEST_ONLY");
    expect(duplicate.phase).toBe("DUPLICATE");
    expect(duplicate.assertions.duplicateWakeInert).toBe(true);
    expect(duplicate.assertions.mutatedHouseholdState).toBe(false);
    expect(duplicate.assertions.appendedEvents).toBe(false);
    expect(duplicate.assertions.dispatched).toBe(false);
    expect(duplicate.duplicate.duplicateWakeOf).toBeTruthy();
  });
});
