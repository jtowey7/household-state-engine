import { describe, expect, it, vi } from "vitest";
import { buildExistingEventLedger, createAirtableRestAppendPort } from "./airtable-rest-append";
import type { CanonicalAppendRecord } from "./types";

function record(eventId = "evt-1", payloadHash = "hash-1"): CanonicalAppendRecord {
  return {
    eventId,
    payloadHash,
    __canonical: "HOUSEHOLD_EVENTS",
    row: {
      "Event ID": eventId,
      "Event type": "Consumption",
      "Occurred at": "2026-08-16T08:00:00.000Z",
      "Recorded at": "2026-08-16T08:01:00.000Z",
      Source: "TEST",
      Actor: "Food OS test",
      "Entity type": "Inventory item",
      "Entity reference": "item-1",
      Item: "milk",
      "Quantity delta": -1,
      Unit: "litre",
      Evidence: "explicit test input",
      "State before": "",
      "State after": "",
      Confidence: "Confirmed",
      "Supersedes event ID": [],
      "Exception / reconciliation action": "",
      "Replay status": "Not replayed",
      "Record class": "Production",
    },
  };
}

function response(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe("createAirtableRestAppendPort", () => {
  it("appends only to HOUSEHOLD EVENTS and records the returned connector id", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: { method?: string; body?: string }) => response({ records: [{ id: "rec-event-1" }] }));
    const port = createAirtableRestAppendPort({ baseId: "app-test", apiKey: "secret", fetchImpl });
    const ack = await port.append(record());
    expect(ack.connectorRecordId).toBe("rec-event-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain("/tbluDjPNJ3hxUpWxN");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body)).records[0].fields["Event ID"]).toBe("evt-1");
    expect(JSON.parse(String(init?.body)).records[0].fields.Item).toBe("milk");
  });

  it("treats the same Event ID and payload as an idempotent duplicate", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: { method?: string; body?: string }) => response({ records: [{ id: "rec-event-1" }] }));
    const existing = new Map([["evt-1", "hash-1"]]);
    const port = createAirtableRestAppendPort({ baseId: "app-test", apiKey: "secret", fetchImpl, existing });
    const ack = await port.append(record());
    expect(ack.duplicate).toBe(true);
    expect(ack.connectorRecordId).toBe("existing:evt-1");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects Event ID reuse with a different payload", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: { method?: string; body?: string }) => response({ records: [{ id: "rec-event-1" }] }));
    const existing = new Map([["evt-1", "hash-old"]]);
    const port = createAirtableRestAppendPort({ baseId: "app-test", apiKey: "secret", fetchImpl, existing });
    await expect(port.append(record("evt-1", "hash-new"))).rejects.toMatchObject({ code: "REUSED_EVENT_ID_PAYLOAD_CONFLICT" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serializes concurrent identical appends so only one Airtable record is created", async () => {
    let release!: (value: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => { release = resolve; });
    const fetchImpl = vi.fn(() => responsePromise);
    const port = createAirtableRestAppendPort({ baseId: "app-test", apiKey: "secret", fetchImpl });
    const first = port.append(record("evt-concurrent", "hash-concurrent"));
    const second = port.append(record("evt-concurrent", "hash-concurrent"));
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release(response({ records: [{ id: "rec-concurrent" }] }));
    const [firstAck, secondAck] = await Promise.all([first, second]);
    expect(firstAck.connectorRecordId).toBe("rec-concurrent");
    expect(secondAck.connectorRecordId).toBe("rec-concurrent");
    expect(secondAck.duplicate).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a conflicting concurrent payload before a second append can be sent", async () => {
    let release!: (value: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => { release = resolve; });
    const fetchImpl = vi.fn(() => responsePromise);
    const port = createAirtableRestAppendPort({ baseId: "app-test", apiKey: "secret", fetchImpl });
    const first = port.append(record("evt-concurrent", "hash-one"));
    await expect(port.append(record("evt-concurrent", "hash-two"))).rejects.toMatchObject({ code: "REUSED_EVENT_ID_PAYLOAD_CONFLICT" });
    release(response({ records: [{ id: "rec-concurrent" }] }));
    await first;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("recovers an accepted append when the POST response is lost before acknowledgement", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("network reset after server accepted request"))
      .mockResolvedValueOnce(response({ records: [{ id: "rec-recovered", fields: {
        "Event ID": "evt-recovery", "Event type": "Consumption", "Occurred at": "2026-08-16T08:00:00.000Z",
        Item: "milk", "Quantity delta": -1, Unit: "litre", "State after": "", "Supersedes event ID": [], "Record class": "Production",
      } }] }));
    const port = createAirtableRestAppendPort({ baseId: "app-test", apiKey: "secret", fetchImpl });
    const ack = await port.append(record("evt-recovery", "c6424069052689df9af94c79258a7244"));
    expect(ack.connectorRecordId).toBe("rec-recovered");
    expect(ack.duplicate).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]![1]?.method).toBe("GET");
  });
});

describe("buildExistingEventLedger", () => {
  it("reads Airtable REST field names and preserves the payload hash for duplicate detection", () => {
    const existing = buildExistingEventLedger([{ id: "rec-event-1", fields: {
      "Event ID": "evt-1", "Event type": "Consumption", "Occurred at": "2026-08-16T08:00:00.000Z",
      Item: "milk", "Quantity delta": -1, Unit: "litre", "State after": "9", "Supersedes event ID": [], "Record class": "Production",
    } }]);
    expect(existing.get("evt-1")).not.toBeNull();
    expect(existing.get("evt-1")).toMatch(/^[a-f0-9]+$/);
  });
});
