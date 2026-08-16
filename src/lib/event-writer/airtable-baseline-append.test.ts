import { describe, expect, it } from "vitest";
import { canonicaliseAppend } from "./canonical";
import { createAirtableBaselineAppendTransport } from "./airtable-baseline-append";
import type { CanonicalAppendRecord } from "./types";
import type { AppendIntent } from "../write-boundary/types";

const now = () => "2026-08-14T22:00:00.000Z";

function baselineRecord(): CanonicalAppendRecord {
  const intent: AppendIntent = {
    eventType: "Receipt",
    item: "oats",
    occurredAt: "2026-08-14T22:00:00.000Z",
    quantityDelta: 1000,
    unit: "g",
    source: "INVENTORY_SNAPSHOT",
    actor: "Food OS baseline",
    entityType: "Inventory item",
    entityReference: "rec-oats",
    evidence: "Current INVENTORY snapshot reviewed and reconciled",
    confidence: "High",
    stateBefore: 0,
    recordClass: "Production",
  };
  const result = canonicaliseAppend(intent, { now });
  if (!result.ok) throw new Error(`fixture failed: ${result.rejection.code}`);
  return {
    ...result.record,
    eventId: "BASELINE:2026-08-14T22:00:00.000Z:fixture",
  };
}

function transportWithResponses(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  let index = 0;
  const fetchImpl = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    calls.push({ method: (init.method ?? "GET").toUpperCase(), url, body: init.body });
    const response = responses[index++];
    if (!response) throw new Error("unexpected fetch call");
    return {
      ok: response.ok,
      status: response.status,
      async text() {
        return JSON.stringify(response.body);
      },
      async json() {
        return response.body;
      },
    };
  };
  return { fetchImpl, calls };
}

describe("Airtable baseline append transport", () => {
  it("refuses non-baseline Event IDs before any HTTP call", async () => {
    const { fetchImpl, calls } = transportWithResponses([]);
    const transport = createAirtableBaselineAppendTransport({
      apiKey: "test",
      baseId: "appmqDptH3taN8uby",
      fetchImpl,
    });
    const record = { ...baselineRecord(), eventId: "EVENT:not-a-baseline" };
    await expect(transport(record)).rejects.toThrow("refuses non-baseline Event IDs");
    expect(calls).toHaveLength(0);
  });

  it("preflights by Event ID then POSTs exactly one new record", async () => {
    const { fetchImpl, calls } = transportWithResponses([
      { ok: true, status: 200, body: { records: [] } },
      { ok: true, status: 200, body: { records: [{ id: "rec-created" }] } },
    ]);
    const transport = createAirtableBaselineAppendTransport({
      apiKey: "test",
      baseId: "appmqDptH3taN8uby",
      fetchImpl,
    });
    const ack = await transport(baselineRecord());
    expect(ack.connectorRecordId).toBe("rec-created");
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    expect(calls[1]?.body).toContain("BASELINE:2026-08-14T22:00:00.000Z:fixture");
  });

  it("serializes an empty Supersedes event ID array as Airtable-compatible blank text", async () => {
    const { fetchImpl, calls } = transportWithResponses([
      { ok: true, status: 200, body: { records: [] } },
      { ok: true, status: 200, body: { records: [{ id: "rec-created" }] } },
    ]);
    const transport = createAirtableBaselineAppendTransport({
      apiKey: "test",
      baseId: "appmqDptH3taN8uby",
      fetchImpl,
    });
    await transport(baselineRecord());
    const postBody = JSON.parse(calls[1]?.body ?? "{}");
    expect(postBody.records[0].fields["Supersedes event ID"]).toBe("");
  });

  it("returns an idempotent duplicate acknowledgement without POST", async () => {
    const record = baselineRecord();
    const expectedFields = {
      ...record.row,
      "Event ID": record.eventId,
      "Supersedes event ID": record.row["Supersedes event ID"].join(","),
    };
    const { fetchImpl, calls } = transportWithResponses([
      { ok: true, status: 200, body: { records: [{ id: "rec-existing", fields: expectedFields }] } },
    ]);
    const transport = createAirtableBaselineAppendTransport({
      apiKey: "test",
      baseId: "appmqDptH3taN8uby",
      fetchImpl,
    });
    const ack = await transport(record);
    expect(ack.duplicate).toBe(true);
    expect(ack.connectorRecordId).toBe("rec-existing");
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("blocks an existing Event ID with a different payload", async () => {
    const record = baselineRecord();
    const conflicting = { ...record.row, "Event ID": record.eventId, Item: "rice" };
    const { fetchImpl, calls } = transportWithResponses([
      { ok: true, status: 200, body: { records: [{ id: "rec-existing", fields: conflicting }] } },
    ]);
    const transport = createAirtableBaselineAppendTransport({
      apiKey: "test",
      baseId: "appmqDptH3taN8uby",
      fetchImpl,
    });
    await expect(transport(record)).rejects.toThrow("already exists with a different payload");
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("coalesces concurrent first-time appends for the same Event ID into one POST", async () => {
    const record = baselineRecord();
    const { fetchImpl, calls } = transportWithResponses([
      { ok: true, status: 200, body: { records: [] } },
      { ok: true, status: 200, body: { records: [] } },
      { ok: true, status: 200, body: { records: [{ id: "rec-created" }] } },
    ]);
    const transport = createAirtableBaselineAppendTransport({
      apiKey: "test",
      baseId: "appmqDptH3taN8uby",
      fetchImpl,
    });

    const [first, second] = await Promise.all([transport(record), transport(record)]);

    expect(first.connectorRecordId).toBe("rec-created");
    expect(second.connectorRecordId).toBe("rec-created");
    expect(second.duplicate).toBe(true);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("rejects a concurrent conflicting payload before a second POST", async () => {
    const record = baselineRecord();
    const conflicting = { ...record, row: { ...record.row, Item: "rice" } };
    const { fetchImpl, calls } = transportWithResponses([
      { ok: true, status: 200, body: { records: [] } },
      { ok: true, status: 200, body: { records: [] } },
      { ok: true, status: 200, body: { records: [{ id: "rec-created" }] } },
    ]);
    const transport = createAirtableBaselineAppendTransport({
      apiKey: "test",
      baseId: "appmqDptH3taN8uby",
      fetchImpl,
    });

    const first = transport(record);
    const second = transport(conflicting);

    await expect(second).rejects.toThrow("already being appended with a different payload");
    await first;
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });
});
