/**
 * Food OS — durable handoff sealing and verification.
 *
 * The scheduler is stateless: continuity between wake-ups exists only as a
 * handoff record persisted in the control plane. That record is untrusted
 * input on the next wake-up, so it is sealed with a content digest and
 * verified against the freshly read control-plane snapshot before any
 * directive is treated as already satisfied.
 *
 * Failure modes handled explicitly (never silently):
 *  - TAMPERED_HANDOFF      digest does not match contents -> refuse to resume
 *  - WRONG_MODE            handoff not produced in SYNTHETIC mode -> refuse
 *  - SNAPSHOT_ROTATED      control plane moved on -> resume with a warning
 *  - UNKNOWN_DIRECTIVE     completed ID absent from the plane -> dropped
 *  - TEST_CLASS_DIRECTIVE  Test-class row in the handoff -> dropped
 */

import { hashOf } from "../state-engine/hash";
import type {
  ControlPlaneSnapshot,
  HandoffRecord,
  HandoffVerdict,
  HandoffWarning,
  SchedulerCycleEvidence,
} from "./types";

function digestOf(record: Omit<HandoffRecord, "digest">): string {
  return hashOf({
    mode: record.mode,
    cycleId: record.cycleId,
    snapshotId: record.snapshotId,
    producedAt: record.producedAt,
    completedDirectiveIds: [...record.completedDirectiveIds].sort(),
    nextDirectiveId: record.nextDirectiveId,
  }).slice(0, 32);
}

/** Seal the evidence handoff into a durable, integrity-checked record. */
export function sealHandoff(evidence: SchedulerCycleEvidence): HandoffRecord {
  const body = {
    mode: "SYNTHETIC" as const,
    cycleId: evidence.cycleId,
    snapshotId: evidence.controlPlaneSnapshotId,
    producedAt: evidence.wakeAt,
    completedDirectiveIds: [...evidence.nextHandoff.completedDirectiveIds].sort(),
    nextDirectiveId: evidence.nextHandoff.nextDirectiveId,
  };
  return { ...body, digest: digestOf(body) };
}

/** Verify an inbound handoff against the control plane read this wake-up. */
export function verifyHandoff(
  snapshot: ControlPlaneSnapshot,
  record: HandoffRecord,
): HandoffVerdict {
  const { digest, ...body } = record;
  if (digest !== digestOf(body)) {
    return {
      accepted: false,
      refusal: {
        code: "TAMPERED_HANDOFF",
        detail: "Handoff digest does not match its contents; refusing to resume from it.",
      },
    };
  }
  if (record.mode !== "SYNTHETIC") {
    return {
      accepted: false,
      refusal: {
        code: "WRONG_MODE",
        detail: "Handoff was not produced by a SYNTHETIC cycle; refusing to resume from it.",
      },
    };
  }

  const warnings: HandoffWarning[] = [];
  if (record.snapshotId !== snapshot.snapshotId) {
    warnings.push({
      code: "SNAPSHOT_ROTATED",
      detail: `Handoff was produced from ${record.snapshotId}; this wake-up read ${snapshot.snapshotId}.`,
    });
  }

  const byId = new Map(snapshot.directives.map((d) => [d.directiveId, d]));
  const completed: string[] = [];
  for (const id of [...record.completedDirectiveIds].sort()) {
    const directive = byId.get(id);
    if (!directive) {
      warnings.push({
        code: "UNKNOWN_DIRECTIVE",
        detail: `Completed directive ${id} is not in the current control plane; ignored.`,
        directiveId: id,
      });
      continue;
    }
    if ((directive.recordClass ?? "Production") === "Test") {
      warnings.push({
        code: "TEST_CLASS_DIRECTIVE",
        detail: `Directive ${id} is Record class = Test; it cannot affect production selection.`,
        directiveId: id,
      });
      continue;
    }
    completed.push(id);
  }

  return { accepted: true, completedDirectiveIds: completed, warnings };
}
