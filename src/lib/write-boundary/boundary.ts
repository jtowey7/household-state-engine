/**
 * The append-only write boundary.
 *
 * Defaults to SIMULATION. A production append is possible only when an
 * approved runtime supplies a `ProductionWriteCapability` containing a real
 * append-only sink AND a human approval reference. There is no configuration
 * flag, environment variable, or default that can promote a simulated boundary
 * into a production one, and there is no silent fallback in either direction:
 * asking for a production append without the capability is a rejection, not a
 * simulated write.
 *
 * There is no update, delete, or upsert path anywhere in this module.
 */

import { draftEventRow } from "./draft";
import type {
  AppendIntent,
  AppendOnlySink,
  AppendPreview,
  AppendResult,
  HouseholdEventRowDraft,
  ProductionWriteCapability,
  WriteCapabilityMode,
} from "./types";

export interface WriteBoundaryConfig {
  /** Absent => SIMULATION. Present => production appends are permitted. */
  capability?: ProductionWriteCapability;
  now?: () => string;
  tableLabel?: string;
}

export interface AppendJournalEntry {
  eventId: string;
  payloadHash: string;
  outcome: AppendResult["outcome"];
  row: HouseholdEventRowDraft;
}

export interface AppendOnlyWriteBoundary {
  readonly mode: WriteCapabilityMode;
  /** Renders the exact row that would be appended. Never writes. */
  preview(intent: AppendIntent): AppendResult;
  /** Appends, simulates, no-ops on an identical duplicate, or refuses. */
  append(intent: AppendIntent): Promise<AppendResult>;
  /** Every accepted row, in emission order. Read-only provenance. */
  journal(): AppendJournalEntry[];
  /** Rows that a production capability would have sent, for approval review. */
  pending(): HouseholdEventRowDraft[];
}

/** In-memory append-only sink used by tests and the console simulation. */
export function createMemorySink(sinkId = "memory-append-only"): AppendOnlySink & {
  rows: HouseholdEventRowDraft[];
} {
  const rows: HouseholdEventRowDraft[] = [];
  return {
    sinkId,
    rows,
    async append(row) {
      rows.push(row);
    },
  };
}

export function createAppendOnlyWriteBoundary(
  config: WriteBoundaryConfig = {},
): AppendOnlyWriteBoundary {
  const mode: WriteCapabilityMode = config.capability ? "PRODUCTION_APPEND" : "SIMULATION";
  const now = config.now ?? (() => new Date().toISOString());
  // Event ID -> canonical payload hash of the accepted row.
  const identity = new Map<string, string>();
  const entries: AppendJournalEntry[] = [];
  const previewed: HouseholdEventRowDraft[] = [];

  const draft = (intent: AppendIntent) =>
    draftEventRow(intent, {
      now,
      tableLabel: config.tableLabel ?? "HOUSEHOLD EVENTS",
      approvalReference: config.capability?.approvalReference ?? null,
    });

  const rejected = (rejection: AppendResult["rejection"]): AppendResult => ({
    outcome: "REJECTED",
    preview: null,
    rejection,
    capability: mode,
    mutated: false,
  });

  function classify(preview: AppendPreview): AppendResult | null {
    const known = identity.get(preview.eventId);
    if (known === undefined) return null;
    if (known === preview.payloadHash) {
      return {
        outcome: "DUPLICATE_NOOP",
        preview,
        rejection: null,
        capability: mode,
        mutated: false,
      };
    }
    return {
      outcome: "CONFLICT",
      preview,
      rejection: {
        code: "REUSED_EVENT_ID_PAYLOAD_CONFLICT",
        detail: `Event ID ${preview.eventId} already carries a different canonical payload; no second mutation is emitted.`,
      },
      capability: mode,
      mutated: false,
    };
  }

  return {
    mode,
    preview(intent) {
      const result = draft(intent);
      if (!result.ok) return rejected(result.rejection);
      const clash = classify(result.preview);
      if (clash) return clash;
      return {
        outcome: mode === "PRODUCTION_APPEND" ? "APPENDED" : "SIMULATED",
        preview: result.preview,
        rejection: null,
        capability: mode,
        // preview() never mutates, whatever the capability.
        mutated: false,
      };
    },
    async append(intent) {
      const result = draft(intent);
      if (!result.ok) return rejected(result.rejection);
      const preview = result.preview;
      const clash = classify(preview);
      if (clash) return clash;

      if (intent.recordClass === "Production" && mode !== "PRODUCTION_APPEND") {
        // No silent fallback: a Production row is never quietly simulated.
        previewed.push(preview.row);
        identity.set(preview.eventId, preview.payloadHash);
        entries.push({
          eventId: preview.eventId,
          payloadHash: preview.payloadHash,
          outcome: "SIMULATED",
          row: preview.row,
        });
        return {
          outcome: "SIMULATED",
          preview,
          rejection: {
            code: "PRODUCTION_WRITE_UNAVAILABLE",
            detail:
              "No approved production append capability is supplied, so this Production row was drafted for approval only and nothing was written.",
          },
          capability: mode,
          mutated: false,
        };
      }

      if (mode === "PRODUCTION_APPEND" && intent.recordClass === "Test") {
        return rejected({
          code: "RECORD_CLASS_CAPABILITY_MISMATCH",
          detail: "A production append capability will not emit Test rows into production state.",
        });
      }

      identity.set(preview.eventId, preview.payloadHash);

      if (mode === "PRODUCTION_APPEND" && config.capability) {
        await config.capability.sink.append(preview.row);
        entries.push({
          eventId: preview.eventId,
          payloadHash: preview.payloadHash,
          outcome: "APPENDED",
          row: preview.row,
        });
        return { outcome: "APPENDED", preview, rejection: null, capability: mode, mutated: true };
      }

      previewed.push(preview.row);
      entries.push({
        eventId: preview.eventId,
        payloadHash: preview.payloadHash,
        outcome: "SIMULATED",
        row: preview.row,
      });
      return { outcome: "SIMULATED", preview, rejection: null, capability: mode, mutated: false };
    },
    journal() {
      return entries.map((e) => ({ ...e, row: { ...e.row } }));
    },
    pending() {
      return previewed.map((r) => ({ ...r }));
    },
  };
}
