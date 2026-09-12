import { describe, expect, it } from "vitest";
import { createEvidenceAwareAirtableProductionPort } from "./evidence-aware-production-port";
import { createFakeAirtableRowSource } from "./airtable-port";

const source = createFakeAirtableRowSource({
  eventRows: [
    {
      id: "recREAL123456789",
      fields: {
        "Event ID": "EV-1",
        "Event type": "Delivery",
        "Occurred at": "2026-08-15T10:00:00Z",
        "Recorded at": "2026-08-15T10:01:00Z",
        Source: "Explicit user input",
        Actor: "James",
        "Entity type": "Inventory",
        "Entity reference": "item:oats",
        Item: "oats",
        "Quantity delta": 2,
        Unit: "kg",
        Evidence: "approximately 2 kg",
        "State before": "0",
        "State after": "2",
        Confidence: "Confirmed",
        "Supersedes event ID": "",
        "Exception / reconciliation action": "",
        "Replay status": "Pending",
        "Record class": "Production",
      },
    },
  ],
  baseLabel: "synthetic-port-test",
  provenance: "synthetic fixture — fake Airtable row source",
});

describe("evidence-aware Airtable production port", () => {
  it("preserves Evidence precision at the port boundary without changing quantity", async () => {
    const port = createEvidenceAwareAirtableProductionPort({ source, mode: "SYNTHETIC" });
    const result = await port.read({ mode: "SYNTHETIC", datasetId: "synthetic", windowStart: "2026-08-15T00:00:00Z", windowEnd: "2026-08-17T00:00:00Z" });

    expect(result.openingEvents).toHaveLength(1);
    expect(result.openingEvents[0]?.payload.quantity).toBe(2);
    expect(result.openingEvents[0]?.payload.unit).toBe("kg");
    expect(result.openingEvents[0]?.payload.evidencePrecision).toBe("QUALIFIED_AMBIGUOUS");
  });
});
