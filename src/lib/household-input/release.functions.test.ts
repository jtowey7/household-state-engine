import { describe, expect, it, vi } from "vitest";

import { createAirtableGatewayFetch, scopeMaterialisationPlan } from "./release.functions";
import type { MaterialisationPlan } from "../production-materialisation/types";

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe("Food release integration helpers", () => {
  it("routes Airtable requests through the managed connector gateway without exposing the connection key as the bearer", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: { method?: string; headers?: Record<string, string>; body?: string }) => response({ records: [] }));
    const gatewayFetch = createAirtableGatewayFetch({
      connectionApiKey: "connection-key",
      gatewayApiKey: "lovable-key",
      fetchImpl,
    });

    await gatewayFetch("https://api.airtable.com/v0/app/base", { method: "POST", headers: { Accept: "application/json" } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://connector-gateway.lovable.dev/airtable/v0/app/base");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer lovable-key",
      "X-Connection-Api-Key": "connection-key",
      Accept: "application/json",
    });
  });

  it("scopes an approved materialisation to the item the household just changed", () => {
    const plan: MaterialisationPlan = {
      ok: true,
      materialisationId: "mat-1",
      snapshotId: "snap-1",
      replayId: "replay-1",
      replayTimestamp: "2026-09-16T20:00:00.000Z",
      approvalId: "approval-1",
      lines: [
        { itemKey: "Ham", quantity: 100, unit: "g", removed: false, contributingEventIds: ["evt-ham"], operation: "CREATE", targetRecordId: null, notes: "ham" },
        { itemKey: "Milk", quantity: 2, unit: "litre", removed: false, contributingEventIds: ["evt-milk"], operation: "UPDATE", targetRecordId: "rec-milk", notes: "milk" },
      ],
      writes: [
        { itemKey: "Ham", quantity: 100, unit: "g", removed: false, contributingEventIds: ["evt-ham"], operation: "CREATE", targetRecordId: null, notes: "ham" },
        { itemKey: "Milk", quantity: 2, unit: "litre", removed: false, contributingEventIds: ["evt-milk"], operation: "UPDATE", targetRecordId: "rec-milk", notes: "milk" },
      ],
      eventIdsToMarkReplayed: ["evt-ham", "evt-milk"],
      alreadyMaterialised: false,
    };

    const scoped = scopeMaterialisationPlan(plan, "ham");
    expect(scoped.lines.map((line) => line.itemKey)).toEqual(["Ham"]);
    expect(scoped.writes.map((line) => line.itemKey)).toEqual(["Ham"]);
    expect(scoped.eventIdsToMarkReplayed).toEqual(["evt-ham"]);
  });
});
