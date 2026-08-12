/**
 * Airtable control-plane persistence for scheduler claims + AGENT RUN.
 *
 * Every test drives the real request shapes through an injected fetch: no
 * network, no credentials, no live Airtable connection (none exists in this
 * workspace — external connector invocation remains the boundary).
 */

import { describe, expect, it } from "vitest";

import { runSchedulerCycle } from "./cycle";
import { cleanControlPlane } from "./fixtures";
import { weeklyAsOf, weeklyNow, weeklyPlan, weeklyPort, weeklyScope } from "../weekly-cycle";
import {
  assertWritableControlPlaneTable,
  createAirtableControlPlaneStore,
  describeControlPlanePersistence,
  resolveControlPlaneConfig,
  FORBIDDEN_WRITE_TABLES,
} from "./airtable-control-plane";
import type { ControlPlaneFetch } from "./airtable-control-plane";
import type { DirectiveClaim } from "./types";

const WORK = {
  port: weeklyPort,
  scope: weeklyScope,
  plan: weeklyPlan,
  asOf: weeklyAsOf,
  now: weeklyNow,
};

const CONFIG = {
  lovableApiKey: "lov-key",
  connectionKey: "conn-key",
  baseId: "appTEST",
  claimsTable: "SCHEDULER CLAIMS",
  agentRunTable: "AGENT RUN",
};

interface Call {
  url: string;
  method: string;
  body?: string;
}

function fakeAirtable(options: {
  claims?: Record<string, unknown>[];
  runs?: Record<string, unknown>[];
  failWritesWith?: { status: number; body: string };
  failReadsWith?: { status: number; body: string };
}): { fetchImpl: ControlPlaneFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: ControlPlaneFetch = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method, ...(init?.body ? { body: init.body } : {}) });
    if (method === "GET") {
      if (options.failReadsWith) {
        return {
          ok: false,
          status: options.failReadsWith.status,
          text: async () => options.failReadsWith!.body,
          json: async () => ({}),
        };
      }
      const isClaims = url.includes(encodeURIComponent("SCHEDULER CLAIMS"));
      const records = (isClaims ? (options.claims ?? []) : (options.runs ?? [])).map(
        (fields, i) => ({ id: `rec${i}`, fields }),
      );
      return { ok: true, status: 200, text: async () => "", json: async () => ({ records }) };
    }
    if (options.failWritesWith) {
      return {
        ok: false,
        status: options.failWritesWith.status,
        text: async () => options.failWritesWith!.body,
        json: async () => ({}),
      };
    }
    return { ok: true, status: 200, text: async () => "", json: async () => ({ records: [] }) };
  };
  return { fetchImpl, calls };
}

const CLAIM: DirectiveClaim = {
  claimId: "CLAIM-abc",
  directiveId: "DIR-1",
  cycleId: "CYCLE-1",
  claimedAt: "2026-01-05T09:00:00.000Z",
  expiresAt: "2026-01-05T09:15:00.000Z",
};

describe("Airtable control-plane configuration boundary", () => {
  it("reports NOT_CONFIGURED without inventing credentials", () => {
    const resolution = resolveControlPlaneConfig({});
    expect(resolution.status).toBe("NOT_CONFIGURED");
    expect(resolution.config).toBeNull();
    expect(resolution.missing).toContain("AIRTABLE_SCHEDULER_CLAIMS_TABLE");
    expect(describeControlPlanePersistence(resolution)).toContain("NOT configured");
  });

  it("resolves only when every declared key is present", () => {
    const resolution = resolveControlPlaneConfig({
      LOVABLE_API_KEY: "a",
      AIRTABLE_API_KEY: "b",
      AIRTABLE_FOOD_OS_BASE_ID: "app1",
      AIRTABLE_SCHEDULER_CLAIMS_TABLE: "SCHEDULER CLAIMS",
      AIRTABLE_AGENT_RUN_TABLE: "AGENT RUN",
    });
    expect(resolution.status).toBe("CONFIGURED");
  });
});

describe("forbidden production write scope", () => {
  it.each(FORBIDDEN_WRITE_TABLES)("refuses to write %s", (table) => {
    expect(() => assertWritableControlPlaneTable(table)).toThrow(/Forbidden write scope/);
  });

  it("allows only the two control-plane tables", () => {
    expect(() => assertWritableControlPlaneTable("SCHEDULER CLAIMS")).not.toThrow();
    expect(() => assertWritableControlPlaneTable("AGENT RUN")).not.toThrow();
  });

  it("never issues a write to a household table during a full cycle", async () => {
    const { fetchImpl, calls } = fakeAirtable({});
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    await runSchedulerCycle({
      controlPlane: cleanControlPlane,
      wakeAt: "2026-01-05T09:00:00.000Z",
      work: WORK,
      persistence: store,
    });
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(
        write.url.includes(encodeURIComponent("SCHEDULER CLAIMS")) ||
          write.url.includes(encodeURIComponent("AGENT RUN")),
      ).toBe(true);
    }
    for (const table of FORBIDDEN_WRITE_TABLES) {
      expect(calls.some((c) => c.url.includes(encodeURIComponent(table)))).toBe(false);
    }
  });
});

describe("claim persistence", () => {
  it("persists a claim when no live lease exists", async () => {
    const { fetchImpl, calls } = fakeAirtable({});
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    const result = await store.persistClaim(CLAIM);
    expect(result.status).toBe("PERSISTED");
    const write = calls.find((c) => c.method === "POST");
    expect(JSON.parse(write!.body!).records[0].fields["Claim ID"]).toBe("CLAIM-abc");
    expect(JSON.parse(write!.body!).records[0].fields["Record class"]).toBe("Test");
  });

  it("refuses to steal a live lease held by another cycle", async () => {
    const { fetchImpl, calls } = fakeAirtable({
      claims: [
        {
          "Claim ID": "CLAIM-other",
          "Directive ID": "DIR-1",
          "Cycle ID": "CYCLE-OTHER",
          "Claimed at": "2026-01-05T08:59:00.000Z",
          "Expires at": "2026-01-05T09:14:00.000Z",
        },
      ],
    });
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    const result = await store.persistClaim(CLAIM);
    expect(result.status).toBe("COLLISION");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("treats an expired lease as reclaimable", async () => {
    const { fetchImpl } = fakeAirtable({
      claims: [
        {
          "Claim ID": "CLAIM-old",
          "Directive ID": "DIR-1",
          "Cycle ID": "CYCLE-OLD",
          "Claimed at": "2026-01-05T08:00:00.000Z",
          "Expires at": "2026-01-05T08:15:00.000Z",
        },
      ],
    });
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    expect((await store.persistClaim(CLAIM)).status).toBe("PERSISTED");
  });

  it("reports a connector failure explicitly instead of claiming success", async () => {
    const { fetchImpl } = fakeAirtable({ failWritesWith: { status: 422, body: "INVALID_FIELD" } });
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    const result = await store.persistClaim(CLAIM);
    expect(result.status).toBe("FAILED");
    expect(result.status === "FAILED" && result.detail).toContain("422");
  });
});

describe("AGENT RUN persistence", () => {
  const RUN = {
    "Run ID": "RUN-1",
    "Record class": "Test",
    Mode: "SYNTHETIC",
    "Cycle ID": "CYCLE-1",
    "Wake at": "2026-01-05T09:00:00.000Z",
    "Control plane snapshot": "SNAP-1",
    "Directive selected": "DIR-1",
    "Directive kind": "WEEKLY_SHADOW_CYCLE",
    "Claim ID": "CLAIM-abc",
    Outcome: "EXECUTED",
    "Work performed": "weekly shadow cycle",
    "Checks passed": 1,
    "Checks total": 1,
    "Proposal IDs": [],
    "Blocked actions": [],
    "Snapshot ID": "SNAP-1",
    "Replay ID": "REPLAY-1",
    "Reconciliation status": "CLEAN",
    "Plan ID": "PLAN-1",
    "Basket ID": "BASKET-1",
    "Next directive": null,
    "Duplicate wake of": null,
    "Mutated household state": false,
    "Appended events": false,
    Dispatched: false,
    "Requires human approval": true,
  } as never;

  it("appends a new run", async () => {
    const { fetchImpl, calls } = fakeAirtable({});
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    expect((await store.appendAgentRun(RUN)).status).toBe("PERSISTED");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("dedupes on the deterministic Run ID", async () => {
    const { fetchImpl, calls } = fakeAirtable({ runs: [{ "Run ID": "RUN-1" }] });
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    expect((await store.appendAgentRun(RUN)).status).toBe("DEDUPLICATED");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("surfaces a write failure with the provider status and body", async () => {
    const { fetchImpl } = fakeAirtable({ failWritesWith: { status: 500, body: "boom" } });
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    const result = await store.appendAgentRun(RUN);
    expect(result.status).toBe("FAILED");
    expect(result.status === "FAILED" && result.detail).toContain("boom");
  });
});

describe("scheduler cycle with durable persistence", () => {
  const base = {
    controlPlane: cleanControlPlane,
    wakeAt: "2026-01-05T09:00:00.000Z",
    work: WORK,
  };

  it("claims, executes and persists the AGENT RUN row", async () => {
    const { fetchImpl } = fakeAirtable({});
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    const result = await runSchedulerCycle({ ...base, persistence: store });
    expect(result.evidence.outcome).toBe("EXECUTED");
    expect(result.evidence.persistence).toEqual({
      claim: "PERSISTED",
      agentRun: "PERSISTED",
      detail: null,
    });
    expect(result.evidence.mutatedHouseholdState).toBe(false);
    expect(result.evidence.appendedEvents).toBe(false);
    expect(result.evidence.dispatched).toBe(false);
  });

  it("blocks with zero work when another cycle holds the durable lease", async () => {
    const first = await runSchedulerCycle(base);
    const directiveId = first.evidence.directiveSelected!;
    const { fetchImpl, calls } = fakeAirtable({
      claims: [
        {
          "Claim ID": "CLAIM-other",
          "Directive ID": directiveId,
          "Cycle ID": "CYCLE-OTHER",
          "Claimed at": "2026-01-05T08:59:00.000Z",
          "Expires at": "2026-01-05T09:14:00.000Z",
        },
      ],
    });
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    const result = await runSchedulerCycle({ ...base, persistence: store });
    expect(result.evidence.outcome).toBe("BLOCKED");
    expect(result.run).toBeNull();
    expect(result.evidence.proposalIds).toEqual([]);
    expect(result.evidence.blockedActions[0]?.reason).toBe("CLAIMED_BY_ANOTHER_CYCLE");
    expect(
      calls.some(
        (c) => c.method === "POST" && c.url.includes(encodeURIComponent("SCHEDULER CLAIMS")),
      ),
    ).toBe(false);
  });

  it("ends the wake-up with no work when the claim read fails", async () => {
    const { fetchImpl } = fakeAirtable({ failReadsWith: { status: 503, body: "gateway down" } });
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    const result = await runSchedulerCycle({ ...base, persistence: store });
    expect(result.evidence.outcome).toBe("REFUSED");
    expect(result.run).toBeNull();
    expect(result.evidence.persistence?.claim).toBe("FAILED");
  });

  it("never reports success when the AGENT RUN write fails", async () => {
    const { fetchImpl } = fakeAirtable({ failWritesWith: { status: 500, body: "write refused" } });
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    const result = await runSchedulerCycle({ ...base, persistence: store });
    expect(result.evidence.persistence?.agentRun).toBe("FAILED");
    expect(
      result.evidence.blockedActions.some((b) => b.reason.startsWith("AGENT_RUN_WRITE_FAILED")),
    ).toBe(true);
  });

  it("is idempotent on a duplicate wake: no second claim row, no second run row", async () => {
    const { fetchImpl } = fakeAirtable({});
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    const first = await runSchedulerCycle({ ...base, persistence: store });

    const replayFetch = fakeAirtable({
      claims: [
        {
          "Claim ID": first.evidence.claim?.claimId ?? "CLAIM-x",
          "Directive ID": first.evidence.directiveSelected,
          "Cycle ID": first.evidence.cycleId,
          "Claimed at": "2026-01-05T09:00:00.000Z",
          "Expires at": "2026-01-05T09:15:00.000Z",
        },
      ],
      runs: [{ "Run ID": first.agentRun!["Run ID"] }],
    });
    const replayStore = createAirtableControlPlaneStore({
      config: CONFIG,
      fetchImpl: replayFetch.fetchImpl,
    });
    const second = await runSchedulerCycle({
      ...base,
      persistence: replayStore,
      wakeLedger: [{ cycleId: first.evidence.cycleId, evidence: first.evidence }],
    });

    expect(second.evidence.duplicateWakeOf).toBe(first.evidence.cycleId);
    expect(second.evidence.persistence?.agentRun).toBe("DEDUPLICATED");
    expect(replayFetch.calls.some((c) => c.method === "POST")).toBe(false);
  });
});
