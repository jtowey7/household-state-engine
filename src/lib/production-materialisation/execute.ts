/**
 * Executes an approved materialisation plan through a bounded port.
 *
 * Ordering guarantee: every INVENTORY write must succeed before any
 * HOUSEHOLD EVENTS `Replay status` is flipped. A failure before or during the
 * inventory write leaves replay status untouched, so a retry is safe.
 */

import type { MaterialisationExecution, MaterialisationPlan, MaterialisationPort } from "./types";

export async function executeInventoryMaterialisation(
  plan: MaterialisationPlan,
  port: MaterialisationPort,
): Promise<MaterialisationExecution> {
  let created = 0;
  let updated = 0;

  for (const line of plan.writes) {
    try {
      if (line.operation === "CREATE") {
        await port.createInventoryRow(line);
        created += 1;
      } else if (line.operation === "UPDATE") {
        if (!line.targetRecordId) {
          throw new Error(`Line for ${line.itemKey} is an UPDATE without a target record id.`);
        }
        await port.updateInventoryRow(line.targetRecordId, line);
        updated += 1;
      }
    } catch (error) {
      return {
        ok: false,
        code: "INVENTORY_WRITE_FAILED",
        detail: `INVENTORY write failed on ${line.itemKey}: ${error instanceof Error ? error.message : String(error)}`,
        materialisationId: plan.materialisationId,
        created,
        updated,
        replayStatusUpdated: false,
      };
    }
  }

  try {
    const { updatedEventIds } = await port.markEventsReplayed(plan.eventIdsToMarkReplayed);
    return {
      ok: true,
      materialisationId: plan.materialisationId,
      created,
      updated,
      unchanged: plan.lines.length - plan.writes.length,
      replayStatusUpdatedEventIds: updatedEventIds,
    };
  } catch (error) {
    return {
      ok: false,
      code: "REPLAY_STATUS_UPDATE_FAILED",
      detail: `Replay status update failed after a successful INVENTORY write: ${error instanceof Error ? error.message : String(error)}`,
      materialisationId: plan.materialisationId,
      created,
      updated,
      replayStatusUpdated: false,
    };
  }
}
