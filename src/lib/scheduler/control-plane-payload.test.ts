/**
 * Outbound payload refusal for the Airtable control-plane persistence seam.
 *
 * A malformed or partial control-plane row must be refused BEFORE any request
 * is built: no write is issued, and the result is an explicit FAILED — never a
 * silent success. Synthetic fixtures only; no credentials, no network.
 */

import { describe, expect, it } from "vitest";

import {
  assertWritableControlPlaneTable,
  CONTROL_PLANE_WRITABLE_TABLES,
  createAirtableControlPlaneStore,
  validateAgentRunPayload,
  validateClaimPayload,
} from "./airtable-control-plane";
import type { ControlPlaneFetch } from "./airtable-control-plane";
import { toAgentRunRecord } from "./agent-run";
import { runSchedulerCycle } from "./cycle";
import { cleanControlPlane } from "./fixtures";
import { weeklyAsOf, weeklyNow, weeklyPlan, weeklyPort, weeklyScope } from "../weekly-cycle";
import type { AgentRunRecord, DirectiveClaim } from "./types";

const CONFIG = {
  lovableApiKey: "lov-key",
  connectionKey: "conn-key",
  baseId: "appTEST",
  claimsTable: "SCHEDULER CLAIMS",
  agentRunTable: "AGENT RUNS",
};

function recordingFetch(): { fetchImpl: ControlPlaneFetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: ControlPlaneFetch = async (url, init) => {
    calls.push(`${(init?.method ?? "GET").toUpperCase()} ${url}`);
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

async function validAgentRun(): Promise<AgentRunRecord> {
  const result = await runSchedulerCycle({
    controlPlane: cleanControlPlane,
    wakeAt: "2026-01-05T09:00:00.000Z",
    work: { port: weeklyPort, scope: weeklyScope, plan: weeklyPlan, asOf: weeklyAsOf, now: weeklyNow },
  });
  return result.agentRun ?? toAgentRunRecord(result.evidence);
}

describe("canonical control-plane table bindings", () => {
  it("allows exactly the canonical scheduler control-plane tables", () => {
    expect(CONTROL_PLANE_WRITABLE_TABLES).toEqual(["SCHEDULER CLAIMS", "AGENT RUNS"]);
    expect(() => assertWritableControlPlaneTable("SCHEDULER CLAIMS")).not.toThrow();
    expect(() => assertWritableControlPlaneTable("AGENT RUNS")).not.toThrow();
  });

  it("rejects the legacy singular AGENT RUN table name", () => {
    expect(() => assertWritableControlPlaneTable("AGENT RUN")).toThrow("Forbidden write scope");
  });
});

describe("claim payload validation", () => {
  it("accepts a well-formed claim", () => {
    expect(validateClaimPayload(CLAIM)).toEqual([]);
  });

  it.each(["claimId", "directiveId", "cycleId", "claimedAt", "expiresAt"] as const)(
    "refuses a claim missing %s",
    (field) => {
      const partial = { ...CLAIM, [field]: "" };
      expect(validateClaimPayload(partial).join(" ")).toContain(field);
    },
  );

  it("refuses unparseable claim timestamps", () => {
    expect(validateClaimPayload({ ...CLAIM, expiresAt: "not-a-date" }).join(" ")).toContain(
      "parseable timestamp",
    );
  });

  it("issues no request when the claim is malformed", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    const result = await store.persistClaim({ ...CLAIM, cycleId: "" });
    expect(result.status).toBe("FAILED");
    expect(result.status === "FAILED" && result.detail).toContain("Refusing to persist");
    expect(calls).toEqual([]);
  });

  it("still persists a well-formed claim", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    const result = await store.persistClaim(CLAIM);
    expect(result.status).toBe("PERSISTED");
    expect(calls.some((c) => c.startsWith("POST"))).toBe(true);
  });
});

describe("AGENT RUNS payload validation", () => {
  it("accepts the record derived from a real cycle", async () => {
    expect(validateAgentRunPayload(await validAgentRun())).toEqual([]);
  });

  it("refuses a partial row missing required identity fields", async () => {
    const record = { ...(await validAgentRun()), "Run ID": "", "Cycle ID": "" };
    const problems = validateAgentRunPayload(record);
    expect(problems.join(" ")).toContain("Run ID");
    expect(problems.join(" ")).toContain("Cycle ID");
  });

  it("refuses a row that claims household mutation or dispatch", async () => {
    const base = await validAgentRun();
    expect(
      validateAgentRunPayload({ ...base, "Mutated household state": true }).join(" "),
    ).toContain("boundary invariant");
    expect(validateAgentRunPayload({ ...base, Dispatched: true }).join(" ")).toContain(
      "boundary invariant",
    );
    expect(validateAgentRunPayload({ ...base, "Appended events": true }).join(" ")).toContain(
      "boundary invariant",
    );
  });

  it("refuses a row that drops the human-approval boundary", async () => {
    const base = await validAgentRun();
    expect(
      validateAgentRunPayload({ ...base, "Requires human approval": false }).join(" "),
    ).toContain("approval boundary");
  });

  it("refuses a non-SYNTHETIC mode or unknown record class", async () => {
    const base = await validAgentRun();
    expect(validateAgentRunPayload({ ...base, Mode: "LIVE" }).join(" ")).toContain("SYNTHETIC");
    expect(validateAgentRunPayload({ ...base, "Record class": "Other" }).join(" ")).toContain(
      "Record class",
    );
  });

  it("refuses malformed counters and collections", async () => {
    const base = await validAgentRun();
    expect(validateAgentRunPayload({ ...base, "Checks passed": -1 }).join(" ")).toContain(
      "non-negative",
    );
    expect(validateAgentRunPayload({ ...base, "Proposal IDs": "PROP-1" }).join(" ")).toContain(
      "must be an array",
    );
  });

  it("issues no request when the AGENT RUNS row is malformed", async () => {
    const { fetchImpl, calls } = recordingFetch();
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    const base = await validAgentRun();
    const result = await store.appendAgentRun({
      ...base,
      Dispatched: true,
    } as unknown as AgentRunRecord);
    expect(result.status).toBe("FAILED");
    expect(result.status === "FAILED" && result.detail).toContain("Refusing to persist");
    expect(result.runId).toBe(base["Run ID"]);
    expect(calls).toEqual([]);
  });

  it("persists and then deduplicates a well-formed row", async () => {
    const base = await validAgentRun();
    const seen: Record<string, unknown>[] = [];
    const fetchImpl: ControlPlaneFetch = async (_url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({ records: seen.map((fields, i) => ({ id: `rec${i}`, fields })) }),
        };
      }
      seen.push(base as unknown as Record<string, unknown>);
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    };
    const store = createAirtableControlPlaneStore({ config: CONFIG, fetchImpl });
    expect((await store.appendAgentRun(base)).status).toBe("PERSISTED");
    expect((await store.appendAgentRun(base)).status).toBe("DEDUPLICATED");
    expect(seen).toHaveLength(1);
  });
});
