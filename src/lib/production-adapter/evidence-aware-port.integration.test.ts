import { describe, expect, it } from "vitest";
import { createEvidenceAwareAirtableProductionPort } from "./evidence-aware-port";
import { createFakeAirtableRowSource } from "./airtable-port";

const qualifiedDelivery = {
  id: "recQUALIFIED001",
  fields: {
    "Event ID": "EV-QUALIFIED-PORT-1",
    "Event type": "Delivery",
    "Occurred at": "2026-08-16T10:00:00Z",
    "Recorded at": "2026-08-16T10:01:00Z",
    Source: "Explicit user input",
    Actor: "Household",
    "Entity type": "Inventory",
    "Entity reference": "item:oats",
    Item: "oats",
    "Quantity delta": 2,
    Unit: "kg",
    Evidence: "approximately 2 kg",
    "State before": "0",
    "State after": "2",
    Confidence: "high",
    "Supersedes event ID": [],
    "Exception / reconciliation action": null,
    "Replay status": null,
    "Record class": "Production",
  },
};

describe("evidence-aware Production Airtable port", () => {
  it("preserves qualified Evidence through the loaded event without changing quantity", async () => {
    const source = createFakeAirtableRowSource({
      eventRows: [qualifiedDelivery],
      baseLabel: "food-os-evidence-port-test",
      provenance: "synthetic fixture — evidence-aware port integration test",
    });

    const port = createEvidenceAwareAirtableProductionPort({
      source,
      mode: "SYNTHETIC",
      portId: "evidence-aware-port-test",
    });

    const result = await port.read({
      windowStart: "2026-08-15T00:00:00Z",
      windowEnd: "2026-08-17T00:00:00Z",
      mode: "SYNTHETIC",
    });

    expect(result.openingEvents).toHaveLength(1);
    expect(result.openingEvents[0]?.eventId).toBe("EV-QUALIFIED-PORT-1");
    expect(result.openingEvents[0]?.payload).toMatchObject({
      quantity: 2,
      unit: "kg",
      evidencePrecision: "QUALIFIED_AMBIGUOUS",
    });
    expect(result.openingEvents[0]?.payload.quantity).toBe(2);
    expect(result.rejections).toEqual([]);
  });
});
