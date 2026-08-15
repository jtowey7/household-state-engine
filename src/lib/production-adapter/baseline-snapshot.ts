import { hashOf } from "../state-engine/hash";

export interface BaselineSnapshotRow {
  id: string;
  fields: Record<string, unknown>;
}

export interface BaselineSnapshotFingerprintInput {
  inventory: BaselineSnapshotRow[];
  reconciliations: BaselineSnapshotRow[];
}

/**
 * Fingerprint the logical baseline inputs, not Airtable's transport encoding.
 * Airtable may return requested fields keyed by immutable field ID or display
 * name; those are equivalent source state and must not produce different
 * authority fingerprints.
 */
export function baselineSnapshotFingerprint(input: BaselineSnapshotFingerprintInput): string {
  return hashOf({
    inventory: input.inventory
      .map((row) => ({ id: row.id, fields: row.fields }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    reconciliations: input.reconciliations
      .map((row) => ({ id: row.id, fields: row.fields }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}
