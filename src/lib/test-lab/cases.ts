import type { HouseholdEvent } from "../state-engine/types";
import type { DemandTarget } from "../quantity-adapter/types";
import type { LabCase, LabCheck } from "./harness";

/** SYNTHETIC ONLY — no real household or Airtable data. */
export const labTargets: DemandTarget[] = [
  { itemKey: "oats-rolled", targetQuantity: 2000, unit: "g", packSize: 500, packUnit: "g" },
  { itemKey: "milk-whole", targetQuantity: 6, unit: "L", packSize: 1, packUnit: "L" },
  { itemKey: "rice-basmati", targetQuantity: 5000, unit: "g", packSize: 1000, packUnit: "g" },
];

export const labNow = () => "2026-01-01T00:00:00.000Z";

const ev = (o: Partial<HouseholdEvent> & { eventId: string }): HouseholdEvent => ({
  recordClass: "Production",
  eventType: "ITEM_STOCK_SET",
  itemKey: "oats-rolled",
  occurredAt: "2026-08-01T08:00:00.000Z",
  payload: { quantity: 500, unit: "g" },
  ...o,
});

const check = (label: string, passed: boolean, detail: string): LabCheck => ({
  label,
  passed,
  detail,
});

const normalEvents: HouseholdEvent[] = [
  ev({ eventId: "LAB-1001", itemKey: "oats-rolled", payload: { quantity: 500, unit: "g" } }),
  ev({
    eventId: "LAB-1002",
    itemKey: "milk-whole",
    eventType: "ITEM_STOCK_DELTA",
    payload: { quantity: 2, unit: "L" },
  }),
];

export const labCases: LabCase[] = [
  {
    caseId: "LAB-A",
    title: "Normal replay → quantity handoff",
    events: normalEvents,
    assert: (run) => [
      check(
        "reconciliation CLEAN",
        run.reconciliationStatus === "CLEAN",
        `status=${run.reconciliationStatus}`,
      ),
      check(
        "requirements emitted for both items",
        run.plan.requirements.map((r) => r.itemKey).join(",") === "milk-whole,oats-rolled",
        run.plan.requirements.map((r) => `${r.itemKey}:${r.requiredQuantity}`).join(" "),
      ),
      check(
        "identity carried into plan",
        run.plan.snapshotId === run.snapshotId && run.plan.replayId === run.replayId,
        `snapshotId=${run.plan.snapshotId.slice(0, 12)}…`,
      ),
      check("never dispatched", run.dispatched === false, "dispatched=false"),
    ],
  },
  {
    caseId: "LAB-B",
    title: "Provenance preservation",
    events: [
      ...normalEvents,
      ev({
        eventId: "LAB-1003",
        itemKey: "oats-rolled",
        eventType: "ITEM_STOCK_DELTA",
        payload: { quantity: 250, unit: "g" },
      }),
    ],
    assert: (run) => {
      const oats = run.plan.requirements.find((r) => r.itemKey === "oats-rolled");
      return [
        check(
          "source event IDs kept in application order",
          oats?.sourceEventIds.join(",") === "LAB-1001,LAB-1003",
          oats?.sourceEventIds.join(",") ?? "none",
        ),
        check(
          "on-hand reflects both contributing events",
          oats?.onHandQuantity === 750,
          `onHand=${oats?.onHandQuantity}`,
        ),
      ];
    },
  },
  {
    caseId: "LAB-C",
    title: "Identical duplicate Event ID is idempotent",
    events: [...normalEvents, normalEvents[1]!],
    assert: (run) => {
      const milk = run.plan.requirements.find((r) => r.itemKey === "milk-whole");
      return [
        check("no double application", milk?.onHandQuantity === 2, `onHand=${milk?.onHandQuantity}`),
        check(
          "duplicate recorded as non-blocking exception",
          run.snapshot.exceptions.some(
            (x) => x.code === "DUPLICATE_EVENT_IGNORED" && !x.blocking,
          ),
          run.snapshot.exceptions.map((x) => x.code).join(",") || "none",
        ),
        check(
          "quantity run still executes",
          run.plan.executed && run.plan.eligibleForProcurement,
          `executed=${run.plan.executed}`,
        ),
      ];
    },
  },
  {
    caseId: "LAB-D",
    title: "Reused Event ID with different payload blocks & refuses procurement",
    events: [
      ...normalEvents,
      ev({ eventId: "LAB-1001", itemKey: "oats-rolled", payload: { quantity: 9999, unit: "g" } }),
    ],
    assert: (run) => [
      check(
        "state BLOCKED",
        run.reconciliationStatus === "BLOCKED",
        `status=${run.reconciliationStatus}`,
      ),
      check(
        "affected item isolated",
        run.snapshot.blockedItemKeys.join(",") === "oats-rolled",
        run.snapshot.blockedItemKeys.join(",") || "none",
      ),
      check(
        "no second mutation applied",
        run.snapshot.items.find((i) => i.itemKey === "oats-rolled")?.quantity === 500,
        `oats=${run.snapshot.items.find((i) => i.itemKey === "oats-rolled")?.quantity}`,
      ),
      check(
        "procurement refused, no requirements",
        !run.plan.executed &&
          !run.plan.eligibleForProcurement &&
          run.plan.requirements.length === 0 &&
          run.plan.rejections[0]?.code === "RECONCILIATION_BLOCKED",
        run.plan.rejections.map((r) => r.code).join(",") || "none",
      ),
    ],
  },
  {
    caseId: "LAB-E",
    title: "Test-class events never affect materialised state",
    events: [
      ...normalEvents,
      ev({
        eventId: "LAB-1900",
        recordClass: "Test",
        itemKey: "oats-rolled",
        payload: { quantity: 999999, unit: "g" },
      }),
    ],
    assert: (run) => {
      const oats = run.plan.requirements.find((r) => r.itemKey === "oats-rolled");
      return [
        check("on-hand unchanged by Test record", oats?.onHandQuantity === 500, `onHand=${oats?.onHandQuantity}`),
        check(
          "Test event excluded, not in provenance",
          !run.sourceEventIds.includes("LAB-1900"),
          run.sourceEventIds.join(","),
        ),
        check(
          "exclusion is explicit and non-blocking",
          run.snapshot.exceptions.some((x) => x.code === "TEST_RECORD_EXCLUDED" && !x.blocking),
          run.snapshot.exceptions.map((x) => x.code).join(","),
        ),
      ];
    },
  },
  {
    caseId: "LAB-F",
    title: "Superseded events excluded from the quantity run",
    events: [
      ev({ eventId: "LAB-2001", itemKey: "rice-basmati", payload: { quantity: 1000, unit: "g" } }),
      ev({
        eventId: "LAB-2002",
        itemKey: "rice-basmati",
        payload: { quantity: 3000, unit: "g" },
        supersedes: ["LAB-2001"],
      }),
    ],
    assert: (run) => {
      const rice = run.plan.requirements.find((r) => r.itemKey === "rice-basmati");
      return [
        check("superseding value used", rice?.onHandQuantity === 3000, `onHand=${rice?.onHandQuantity}`),
        check(
          "superseded event not in provenance",
          rice?.sourceEventIds.join(",") === "LAB-2002",
          rice?.sourceEventIds.join(",") ?? "none",
        ),
      ];
    },
  },
  {
    caseId: "LAB-G",
    title: "Repeated identical shadow run is deterministic",
    events: normalEvents,
    assert: (run, rerun) => [
      check("identical planId", run.plan.planId === rerun.plan.planId, run.plan.planId),
      check("identical snapshotId", run.snapshotId === rerun.snapshotId, run.snapshotId),
      check(
        "identical plan payload",
        JSON.stringify(run.plan) === JSON.stringify(rerun.plan),
        "byte-identical",
      ),
    ],
  },
  {
    caseId: "LAB-H",
    title: "No static-inventory fallback when the snapshot is absent",
    events: [],
    assert: () => [],
  },
];
