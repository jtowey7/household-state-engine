/**
 * Food OS — TEST-only in-memory D1 double for the runtime household seam.
 *
 * Shared by the runtime-household and delivery-runtime integration suites so
 * there is ONE test double rather than drifting copies. It performs no I/O,
 * holds no connector and cannot reach Airtable or Production household state.
 */

import type { D1DatabaseLike, D1Result, D1Statement } from "./runtime-household";

export type TestRow = Record<string, unknown> & { sequence: number };

export type RuntimeHouseholdTestDb = D1DatabaseLike & {
  events: TestRow[];
  snapshots: Map<string, Record<string, unknown>>;
};

export function createRuntimeHouseholdTestDb(): RuntimeHouseholdTestDb {
  const events: TestRow[] = [];
  const snapshots = new Map<string, Record<string, unknown>>();
  let sequence = 0;

  const db: RuntimeHouseholdTestDb = {
    events,
    snapshots,
    prepare(sql: string): D1Statement {
      const bindings: unknown[] = [];
      const statement: D1Statement = {
        bind(...values: unknown[]) {
          bindings.push(...values);
          return statement;
        },
        async all(): Promise<D1Result> {
          if (sql.includes("FROM runtime_household_events") && sql.includes("event_hash")) {
            return {
              results: events
                .filter((row) => row['event_id'] === bindings[0])
                .sort((a, b) => a.sequence - b.sequence),
              success: true,
            };
          }
          if (sql.includes("FROM runtime_household_events")) {
            return { results: [...events].sort((a, b) => a.sequence - b.sequence), success: true };
          }
          if (sql.includes("FROM runtime_household_snapshots")) {
            return { results: [...snapshots.values()], success: true };
          }
          return { results: [], success: true };
        },
        async run(): Promise<D1Result> {
          if (sql.includes("INSERT INTO runtime_household_events")) {
            events.push({
              sequence: ++sequence,
              event_id: bindings[0],
              event_type: bindings[1],
              item_key: bindings[2],
              occurred_at: bindings[3],
              payload_json: bindings[4],
              supersedes_json: bindings[5],
              event_hash: bindings[6],
              recorded_at: bindings[7],
            });
          }
          if (sql.includes("INSERT OR REPLACE INTO runtime_household_snapshots")) {
            snapshots.set(String(bindings[0]), {
              snapshot_id: bindings[0],
              replay_id: bindings[1],
              replay_timestamp: bindings[2],
              reconciliation_status: bindings[3],
              event_count: bindings[4],
              snapshot_json: bindings[5],
              created_at: bindings[6],
            });
          }
          if (sql.includes("DELETE FROM runtime_household_events")) events.splice(0, events.length);
          if (sql.includes("DELETE FROM runtime_household_snapshots")) snapshots.clear();
          return { results: [], success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements: D1Statement[]): Promise<D1Result[]> {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };

  return db;
}
