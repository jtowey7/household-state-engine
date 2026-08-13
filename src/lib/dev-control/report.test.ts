import { describe, expect, it } from "vitest";

import { buildDevControlReport } from "./report";
import { collectDevControlSignals } from "./signals";
import type { DevControlSignals } from "./types";

const CONFIGURED = {
  status: "CONFIGURED" as const,
  detail: "Connector configured.",
  missing: [] as string[],
};

async function signals(
  overrides: Partial<DevControlSignals> = {},
): Promise<DevControlSignals> {
  const base = await collectDevControlSignals({ connectivity: CONFIGURED });
  return { ...base, ...overrides };
}

describe("dev-control report", () => {
  it("is deterministic for the same signals", async () => {
    const s = await signals();
    expect(JSON.stringify(buildDevControlReport(s))).toBe(
      JSON.stringify(buildDevControlReport(s)),
    );
  });

  it("asserts the read-only boundary", async () => {
    const report = buildDevControlReport(await signals());
    expect(report.readOnly).toBe(true);
    expect(report.mutatedHouseholdState).toBe(false);
    expect(report.dispatched).toBe(false);
  });

  it("reports every live integration case as green evidence", async () => {
    const report = buildDevControlReport(await signals());
    const lab = report.evidence.find((e) => e.id === "EV-LAB");
    expect(lab?.green).toBe(true);
    expect(lab?.passed).toBe(lab?.total);
  });

  it("keeps the safety invariant evidence green", async () => {
    const report = buildDevControlReport(await signals());
    expect(report.evidence.find((e) => e.id === "EV-SAFETY")?.green).toBe(true);
  });

  it("raises an offline job and attention item when the connector is unconfigured", async () => {
    const s = await signals({
      connectivity: { status: "NOT_CONFIGURED", detail: "No credentials.", missing: ["AIRTABLE_API_KEY"] },
    });
    const report = buildDevControlReport(s);
    expect(report.jobs.some((j) => j.id === "CONNECTOR" && j.state === "OFFLINE")).toBe(true);
    const item = report.attention.find((a) => a.id === "ATT-CONNECTOR");
    expect(item?.severity).toBe("AMBER");
    expect(item?.rootCause).toContain("AIRTABLE_API_KEY");
  });

  it("surfaces the blocked scheduler wake-up with a root cause and work item", async () => {
    const report = buildDevControlReport(await signals());
    const item = report.attention.find((a) => a.id === "ATT-JOB-blocked");
    expect(item).toBeDefined();
    expect(item?.rootCause.length).toBeGreaterThan(0);
    expect(item?.workItem.ref).toBe("RB-5");
    expect(item?.component.path).toBe("src/lib/scheduler");
  });

  it("links every running row attention id to a real attention item", async () => {
    const report = buildDevControlReport(await signals());
    const ids = new Set(report.attention.map((a) => a.id));
    for (const row of report.running) {
      for (const id of row.attentionIds) expect(ids.has(id)).toBe(true);
    }
  });

  it("turns a refused source read into a red attention item", async () => {
    const report = buildDevControlReport(await signals());
    const item = report.attention.find((a) => a.id === "ATT-offline-LOAD_SOURCE");
    expect(item?.severity).toBe("RED");
    expect(item?.component.path).toBe("src/lib/production-adapter");
    expect(report.health).toBe("RED");
  });

  it("reports GREEN health when no scenario raises attention", async () => {
    const s = await signals();
    const clean: DevControlSignals = {
      ...s,
      weekly: s.weekly.filter(
        (w) =>
          w.run.status === "COMPLETED" &&
          w.run.isolatedItemKeys.length === 0 &&
          w.run.stages.every((st) => st.status === "OK" || st.status === "SKIPPED"),
      ),
      scheduler: s.scheduler.filter((x) => x.result.evidence.outcome === "EXECUTED"),
    };
    const report = buildDevControlReport(clean);
    expect(report.attention).toHaveLength(0);
    expect(report.health).toBe("GREEN");
    expect(report.headline).toContain("healthy");
  });

  it("exposes roadmap blocks with plain-English purpose and components", async () => {
    const report = buildDevControlReport(await signals());
    expect(report.roadmap.length).toBeGreaterThanOrEqual(6);
    for (const block of report.roadmap) {
      expect(block.purpose.length).toBeGreaterThan(20);
      expect(block.components.length).toBeGreaterThan(0);
    }
  });

  it("lists recent shifts newest first", async () => {
    const report = buildDevControlReport(await signals());
    const dates = report.shifts.map((s) => s.at);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
