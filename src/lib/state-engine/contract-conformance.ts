/**
 * Event-contract conformance harness (QA/observability only).
 *
 * Reuses the real `replayEvents` engine against FIXED LOCAL synthetic fixtures
 * and reports pass/fail for each clause of the household event contract.
 * It re-implements no replay logic and touches no production data or network.
 */
import { replayEvents } from "./engine";
import {
  conflictFixture,
  duplicateFixture,
  supersessionFixture,
  testRecordFixture,
} from "./fixtures";
import type { HouseholdEvent, StateSnapshot } from "./types";

export const contractNow = () => "2026-01-01T00:00:00.000Z";

export interface ContractCheck {
  id: string;
  clause: string;
  passed: boolean;
  detail: string;
}

export interface ContractConformanceReport {
  checks: ContractCheck[];
  passed: number;
  failed: number;
  allPassed: boolean;
}

const replay = (events: readonly HouseholdEvent[]): StateSnapshot =>
  replayEvents(events, { now: contractNow });

const qty = (s: StateSnapshot, itemKey: string): number | undefined =>
  s.items.find((i) => i.itemKey === itemKey)?.quantity;

/** Runs every contract clause against fixed local fixtures. */
export function runContractConformance(): ContractConformanceReport {
  const checks: ContractCheck[] = [];

  // C1 — identical duplicate Event ID is idempotent.
  {
    const s = replay(duplicateFixture);
    const single = replay([duplicateFixture[0]!]);
    const passed =
      qty(s, "eggs-large") === 6 &&
      s.snapshotId === single.snapshotId &&
      s.exceptions.some((x) => x.code === "DUPLICATE_EVENT_IGNORED" && !x.blocking);
    checks.push({
      id: "C1",
      clause: "Identical duplicate Event ID is idempotent",
      passed,
      detail: `eggs-large on-hand ${qty(s, "eggs-large")} (single delivery ${qty(single, "eggs-large")}); snapshot identity ${s.snapshotId === single.snapshotId ? "unchanged" : "CHANGED"}; status ${s.reconciliationStatus}`,
    });
  }

  // C2 — reused Event ID with a different payload conflicts, no second mutation.
  {
    const s = replay(conflictFixture);
    const passed =
      qty(s, "rice-basmati") === 1000 &&
      s.reconciliationStatus === "BLOCKED" &&
      s.exceptions.some(
        (x) => x.code === "REUSED_EVENT_ID_PAYLOAD_CONFLICT" && x.blocking,
      );
    checks.push({
      id: "C2",
      clause: "Reused Event ID + changed payload → conflict, no second mutation",
      passed,
      detail: `rice-basmati held at first value ${qty(s, "rice-basmati")} (second payload 4000 not applied); status ${s.reconciliationStatus}`,
    });
  }

  // C3 — Record class = Test has zero effect.
  {
    const s = replay(testRecordFixture);
    const empty = replay([]);
    const passed =
      s.contributingEventIds.length === 0 &&
      s.items.length === 0 &&
      s.replayId === empty.replayId &&
      s.exceptions.every((x) => x.code === "TEST_RECORD_EXCLUDED" && !x.blocking);
    checks.push({
      id: "C3",
      clause: "Record class = Test has zero effect on materialised state",
      passed,
      detail: `contributing events ${s.contributingEventIds.length}; items ${s.items.length}; replay identity ${s.replayId === empty.replayId ? "identical to empty stream" : "DIVERGED"}`,
    });
  }

  // C4 — superseded events are excluded.
  {
    const s = replay(supersessionFixture);
    const passed =
      qty(s, "flour-plain") === 1500 &&
      !s.contributingEventIds.includes("EVT-5100") &&
      s.exceptions.some((x) => x.code === "SUPERSEDED_EVENT_NOT_APPLIED");
    checks.push({
      id: "C4",
      clause: "Superseded events are excluded from materialised state",
      passed,
      detail: `flour-plain ${qty(s, "flour-plain")}g from winner EVT-5101; contributing ${s.contributingEventIds.join(", ") || "none"}`,
    });
  }

  // C5 — unresolved conflicts stay explicit and block the affected item.
  {
    const s = replay([...conflictFixture, ...duplicateFixture]);
    const blocked = s.blockedItemKeys.includes("rice-basmati");
    const unrelatedClear = !s.blockedItemKeys.includes("eggs-large");
    const passed = blocked && unrelatedClear && s.reconciliationStatus === "BLOCKED";
    checks.push({
      id: "C5",
      clause: "Unresolved conflicts remain explicit and blocking",
      passed,
      detail: `status ${s.reconciliationStatus}; blocked items ${s.blockedItemKeys.join(", ") || "none"}; unrelated eggs-large ${unrelatedClear ? "unaffected" : "WRONGLY BLOCKED"}`,
    });
  }

  // C6 — replay is deterministic.
  {
    const stream = [...supersessionFixture, ...duplicateFixture, ...testRecordFixture];
    const a = replay(stream);
    const b = replay(stream);
    const passed =
      a.snapshotId === b.snapshotId &&
      a.replayId === b.replayId &&
      JSON.stringify(a) === JSON.stringify(b);
    checks.push({
      id: "C6",
      clause: "Replay is deterministic for an identical stream",
      passed,
      detail: `snapshot ${a.snapshotId.slice(0, 16)}… repeated byte-identically`,
    });
  }

  const failed = checks.filter((c) => !c.passed).length;
  return {
    checks,
    passed: checks.length - failed,
    failed,
    allPassed: failed === 0,
  };
}
