/**
 * Food OS — production-state adapter (read-only port).
 *
 * Scope boundary: this module defines the ONLY sanctioned way the runtime may
 * read household state that claims to be production. It is write-refusing by
 * construction: there is no mutate/write method on the port, and the guard
 * below rejects any attempt to mix synthetic fixtures into a PRODUCTION scope
 * or to feed production rows into a SYNTHETIC scope.
 *
 * No connector is wired yet. `createMemoryProductionPort` is the local
 * implementation used by tests and the console; a real Airtable-backed port
 * only has to satisfy the same contract (see contract.ts).
 */

import type { HouseholdEvent } from "../state-engine/types";
import type { DemandTarget } from "../quantity-adapter/types";

export type SourceMode =
  /** Synthetic fixtures. Never allowed to claim production provenance. */
  | "SYNTHETIC"
  /** Real household state, read-only. Writes are impossible through this port. */
  | "PRODUCTION_READ_ONLY";

export interface SourceScope {
  mode: SourceMode;
  /** Stable identifier of the household/dataset being read. */
  datasetId: string;
  /** Inclusive ISO date the cycle window starts. */
  windowStart: string;
  /** Inclusive ISO date the cycle window ends. */
  windowEnd: string;
}

export interface ProductionReadResult {
  /** Opening balances / prior household events, already ordered. */
  openingEvents: HouseholdEvent[];
  /** Par levels used by the quantity bridge. */
  targets: DemandTarget[];
  /** Provenance label attached to every row by the source. */
  provenance: string;
  /** The mode the source itself claims. Must match the requested scope. */
  claimedMode: SourceMode;
}

/**
 * Read-only port. Deliberately has no write/update/delete member: the runtime
 * cannot mutate household state, and manual inventory correction is not a
 * substitute for events.
 */
export interface ProductionStatePort {
  readonly portId: string;
  readonly mode: SourceMode;
  read(scope: SourceScope): Promise<ProductionReadResult>;
}

export type SourceRejectionCode =
  /** Port mode and requested scope disagree. */
  | "MODE_MISMATCH"
  /** Synthetic-looking provenance inside a production read (or vice versa). */
  | "PROVENANCE_CONTAMINATION"
  /** Two different payloads shipped under one immutable Event ID. */
  | "DUPLICATE_EVENT_ID"
  /** Row is structurally unusable. */
  | "MALFORMED_EVENT"
  | "MALFORMED_TARGET"
  /** The port itself failed. */
  | "SOURCE_UNAVAILABLE";

export interface SourceRejection {
  code: SourceRejectionCode;
  itemKey: string | null;
  eventId: string | null;
  detail: string;
  /** Fatal rejections abort the read; otherwise only that row is quarantined. */
  fatal: boolean;
}

export interface LoadedProductionState {
  scope: SourceScope;
  portId: string;
  /** Rows that passed every guard, safe to replay. */
  openingEvents: HouseholdEvent[];
  targets: DemandTarget[];
  /** Item keys isolated by a non-fatal rejection; unrelated work continues. */
  quarantinedItemKeys: string[];
  rejections: SourceRejection[];
  /** False when a fatal rejection occurred — callers must not proceed. */
  ok: boolean;
  /** Deterministic hash of what was loaded. */
  sourceId: string;
  /** Always false. The adapter can never write back. */
  readonly writable: false;
}
