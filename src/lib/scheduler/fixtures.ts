import type { ControlPlaneSnapshot } from "./types";

/** SYNTHETIC control-plane snapshot — Airtable-shaped, no real directives. */
export const cleanControlPlane: ControlPlaneSnapshot = {
  mode: "SYNTHETIC",
  snapshotId: "CP-SYNTH-0001",
  readAt: "2026-08-03T20:00:00.000Z",
  directives: [
    {
      directiveId: "DIR-030",
      title: "Archive last week's basket",
      kind: "UNSUPPORTED",
      priority: "P2",
      status: "READY",
      actionPolicy: "PREPARE",
    },
    {
      directiveId: "DIR-010",
      title: "Weekly shadow cycle",
      kind: "WEEKLY_SHADOW_CYCLE",
      priority: "P0",
      status: "READY",
      actionPolicy: "PREPARE",
    },
    {
      directiveId: "DIR-020",
      title: "Meal completion sweep",
      kind: "MEAL_COMPLETION_SWEEP",
      priority: "P1",
      status: "READY",
      actionPolicy: "PREPARE",
      dependsOn: ["DIR-010"],
    },
    {
      directiveId: "DIR-001",
      title: "Synthetic smoke directive (test class)",
      kind: "WEEKLY_SHADOW_CYCLE",
      priority: "P0",
      status: "READY",
      actionPolicy: "EXECUTE",
      recordClass: "Test",
    },
  ],
};

/** Every open directive is blocked or dependency-gated. */
export const blockedControlPlane: ControlPlaneSnapshot = {
  mode: "SYNTHETIC",
  snapshotId: "CP-SYNTH-0002",
  readAt: "2026-08-03T20:00:00.000Z",
  directives: [
    {
      directiveId: "DIR-010",
      title: "Weekly shadow cycle",
      kind: "WEEKLY_SHADOW_CYCLE",
      priority: "P0",
      status: "BLOCKED",
      actionPolicy: "PREPARE",
      blockedReason: "Household confirmed an unresolved stock conflict; awaiting a human decision.",
    },
    {
      directiveId: "DIR-020",
      title: "Meal completion sweep",
      kind: "MEAL_COMPLETION_SWEEP",
      priority: "P1",
      status: "READY",
      actionPolicy: "PREPARE",
      dependsOn: ["DIR-010"],
    },
  ],
};
