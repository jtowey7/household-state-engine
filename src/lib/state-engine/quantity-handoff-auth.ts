import { hashOf } from "./hash";
import { toQuantityRequirementsHandoff } from "./engine";
import type { QuantityRequirementsHandoff, StateSnapshot } from "./types";

export type QuantityHandoffRevalidationCode =
  | "HANDOFF_SNAPSHOT_ID_MISMATCH"
  | "HANDOFF_REPLAY_ID_MISMATCH"
  | "HANDOFF_PAYLOAD_DRIFT";

export interface QuantityHandoffRevalidation {
  valid: boolean;
  code: QuantityHandoffRevalidationCode | null;
  detail: string;
}

/**
 * Revalidates a handoff against the authoritative StateSnapshot that produced it.
 *
 * The handoff contains identity fields, but those fields are untrusted when a
 * caller supplies a handoff directly. This function therefore derives the
 * canonical handoff again from the snapshot and compares the complete payload,
 * not just snapshotId/replayId supplied by the caller.
 */
export function revalidateQuantityRequirementsHandoff(
  snapshot: StateSnapshot,
  handoff: QuantityRequirementsHandoff,
): QuantityHandoffRevalidation {
  if (handoff.snapshotId !== snapshot.snapshotId) {
    return {
      valid: false,
      code: "HANDOFF_SNAPSHOT_ID_MISMATCH",
      detail: "Quantity handoff snapshotId does not match the authoritative StateSnapshot.",
    };
  }

  if (handoff.replayId !== snapshot.replayId) {
    return {
      valid: false,
      code: "HANDOFF_REPLAY_ID_MISMATCH",
      detail: "Quantity handoff replayId does not match the authoritative StateSnapshot.",
    };
  }

  const expected = toQuantityRequirementsHandoff(snapshot);
  const expectedDigest = hashOf(expected);
  const actualDigest = hashOf(handoff);
  if (expectedDigest !== actualDigest) {
    return {
      valid: false,
      code: "HANDOFF_PAYLOAD_DRIFT",
      detail: "Quantity handoff payload differs from the canonical handoff derived from the StateSnapshot.",
    };
  }

  return {
    valid: true,
    code: null,
    detail: "Quantity handoff is bound to the supplied authoritative StateSnapshot.",
  };
}
