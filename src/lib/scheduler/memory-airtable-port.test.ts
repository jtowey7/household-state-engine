/**
 * Scheduler claim + AGENT RUN persistence driven through a *stateful*
 * in-memory Airtable port. No credentials, no network, no household tables.
 *
 * The stateless fetch double in `airtable-control-plane.test.ts` proves request
 * shapes; this file proves the durable behaviour across repeated calls:
 * idempotent retry, dedupe, collision, and explicit failure.
 */

import { describe, expect, it } from "vitest";

import { createAirtableControlPlaneStore, FORBIDDEN_WRITE_TABLES } from "./airtable-control-plane";
import { createInMemoryAirtablePort } from "./memory-airtable-port";
import { buildAgentRunRecord } from "./agent-run";
import { runSchedulerCycle } from "./cycle";
import { cleanControlPlane } from "./fixtures";
import { weeklyAsOf, weeklyNow, weeklyPlan, weeklyPort, weeklyScope } from "../weekly-cycle";
import type { DirectiveClaim } from "./types";

const CONFIG = {
  lovableApiKey: "lov-key",
  connectionKey: "conn-key",
  baseId: "appTEST",
  claimsTable: "SCHEDULER CLAIMS",
  agentRunTable: "AGENT RUN",
};

const WORK = {
  port: weeklyPort,
  scope: weeklyScope,
  plan: weeklyPlan,
  asOf: weeklyAsOf,
  now: weeklyNow,
};

const CLAIM: DirectiveClaim = {
  claimId: "CLAIM-abc",
  directiveId: "DIR-1",
  cycleId: "CYCLE-1",
  claimedAt: "2026-01-05T09:00:00.000Z",
  expiresAt: "2026-01-05T09:15:00.000Z",
};

function store(options?: Parameters<typeof createInMemoryAirtablePort>[0]) {
  const port = createInMemoryAirtablePort(options);
  return { port, store: createAirtableControlPlaneStore({ config: CONFIG, fetchImpl: port.fetchImpl }) };
}

describe("claim persistence through the in-memory Airtable port", () => {
  it("writes exactly one durable claim row", async () => {
    const { port, store: s } = store();
    const result = await s.persistClaim(CLAIM);
    expect(result.status).toBe("PERSISTED");
    const rows = port.rows("SCHEDULER CLAIMS");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fields).toMatchObject({
      "Claim ID": "CLAIM-abc",
      "Directive ID": "DIR-1",
      "Cycle ID": "CYCLE-1",
      "Record class": "Test",
    });
  });

  it("is idempotent on retry: the same claim never doubles", async () => {
    const { port, store: s } = store();
    await s.persistClaim(CLAIM);
    const retry = await s.persistClaim(CLAIM);
    expect(retry.status).toBe("ALREADY_HELD");
    expect(port.rows("SCHEDULER CLAIMS")).toHaveLength(1);
  });

  it("reads back its own durable claim as active", async () => {
    const { store: s } = store();
    await s.persistClaim(CLAIM);
    const read = await s.listActiveClaims("DIR-1", CLAIM.claimedAt);
    expect(read.status).toBe("OK");
    if (read.status !== "OK") return;
    expect(read.claims).toHaveLength(1);
    expect(read.claims[0]!.claimId).toBe("CLAIM-abc");
  });

  it("refuses to steal a live lease written by another cycle", async () => {
    const { port, store: s } = store();
    await s.persistClaim(CLAIM);
    const other = await s.persistClaim({ ...CLAIM, claimId: "CLAIM-other", cycleId: "CYCLE-2" });
    expect(other.status).toBe("COLLISION");
    if (other.status !== "COLLISION") return;
    expect(other.holder.cycleId).toBe("CYCLE-1");
    expect(port.rows("SCHEDULER CLAIMS")).toHaveLength(1);
  });

  it("lets a later cycle claim once the lease has expired", async () => {
    const { port, store: s } = store();
    await s.persistClaim(CLAIM);
    const later = await s.persistClaim({
      ...CLAIM,
      claimId: "CLAIM-later",
      cycleId: "CYCLE-2",
      claimedAt: "2026-01-05T10:00:00.000Z",
      expiresAt: "2026-01-05T10:15:00.000Z",
    });
    expect(later.status).toBe("PERSISTED");
    expect(port.rows("SCHEDULER CLAIMS")).toHaveLength(2);
  });

  it("does not scope-leak: a claim for another directive is not a collision", async () => {
    const { store: s } = store();
    await s.persistClaim(CLAIM);
    const other = await s.persistClaim({
      ...CLAIM,
      claimId: "CLAIM-dir2",
      directiveId: "DIR-2",
      cycleId: "CYCLE-2",
    });
    expect(other.status).toBe("PERSISTED");
  });

  it("reports a read failure explicitly rather than claiming success", async () => {
    const { port, store: s } = store({ failReadsWith: { status: 503, body: "upstream down" } });
    const result = await s.persistClaim(CLAIM);
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.detail).toContain("503");
    expect(port.writes()).toHaveLength(0);
  });

  it("reports a write failure explicitly and persists nothing", async () => {
    const { port, store: s } = store({ failWritesWith: { status: 422, body: "invalid field" } });
    const result = await s.persistClaim(CLAIM);
    expect(result.status).toBe("FAILED");
    expect(port.rows("SCHEDULER CLAIMS")).toHaveLength(0);
  });

  it("refuses to guess when the payload has no records array", async () => {
    const { store: s } = store({ malformedReads: true });
    const read = await s.listActiveClaims("DIR-1", CLAIM.claimedAt);
    expect(read.status).toBe("FAILED");
  });
});

describe("AGENT RUN persistence through the in-memory Airtable port", () => {
  async function cycleRun() {
    const result = await runSchedulerCycle({
      snapshot: cleanControlPlane,
      wakeAt: "2026-01-05T09:00:00.000Z",
      work: WORK,
    });
    return buildAgentRunRecord(result.evidence);
  }

  it("appends a durable run row carrying provenance and boundary flags", async () => {
    const { port, store: s } = store();
    const record = await cycleRun();
    const result = await s.appendAgentRun(record);
    expect(result.status).toBe("PERSISTED");
    const rows = port.rows("AGENT RUN");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fields).toMatchObject({
      "Run ID": record["Run ID"],
      "Cycle ID": record["Cycle ID"],
      Mode: "SYNTHETIC",
      "Record class": "Test",
      "Mutated household state": false,
      "Appended events": false,
      Dispatched: false,
      "Requires human approval": true,
    });
  });

  it("dedupes a duplicate delivery on the deterministic Run ID", async () => {
    const { port, store: s } = store();
    const record = await cycleRun();
    await s.appendAgentRun(record);
    const again = await s.appendAgentRun(record);
    expect(again.status).toBe("DEDUPLICATED");
    expect(port.rows("AGENT RUN")).toHaveLength(1);
  });

  it("appends a genuinely different run as a second row", async () => {
    const { port, store: s } = store();
    const record = await cycleRun();
    await s.appendAgentRun(record);
    await s.appendAgentRun({ ...record, "Run ID": `${record["Run ID"]}-2` });
    expect(port.rows("AGENT RUN")).toHaveLength(2);
  });

  it("never reports success when the append write fails", async () => {
    const { port, store: s } = store({ failWritesWith: { status: 500, body: "airtable exploded" } });
    const record = await cycleRun();
    const result = await s.appendAgentRun(record);
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.detail).toContain("500");
    expect(port.rows("AGENT RUN")).toHaveLength(0);
  });
});

describe("write scope stays inside the control plane", () => {
  it("a full persisted cycle touches only SCHEDULER CLAIMS and AGENT RUN", async () => {
    const { port, store: s } = store();
    await runSchedulerCycle({
      snapshot: cleanControlPlane,
      wakeAt: "2026-01-05T09:00:00.000Z",
      work: WORK,
      persistence: s,
    });
    const touched = new Set(port.calls.map((c) => c.table));
    for (const forbidden of FORBIDDEN_WRITE_TABLES) expect(touched.has(forbidden)).toBe(false);
    expect([...touched].sort()).toEqual(["AGENT RUN", "SCHEDULER CLAIMS"]);
    expect(port.rows("SCHEDULER CLAIMS")).toHaveLength(1);
    expect(port.rows("AGENT RUN")).toHaveLength(1);
  });

  it("a duplicate wake-up adds no second claim row and no second run row", async () => {
    const { port, store: s } = store();
    const input = {
      snapshot: cleanControlPlane,
      wakeAt: "2026-01-05T09:00:00.000Z",
      work: WORK,
      persistence: s,
    };
    await runSchedulerCycle(input);
    await runSchedulerCycle(input);
    expect(port.rows("SCHEDULER CLAIMS")).toHaveLength(1);
    expect(port.rows("AGENT RUN")).toHaveLength(1);
  });
});
