import { describe, expect, it } from "vitest";
import { createEvidenceAwareAirtableProductionPort } from "./evidence-aware-port";
import { createFakeAirtableRowSource } from "./airtable-port";

const row = (evidence: string) => ({
  id: "recLIVE123456789",
  fields: {
    "Event ID": "EV-LIVE-1",
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
    Evidence: evidence,
    "State before": "0",
    "State after": "2",
    Confidence: "high",
    "Supersedes event ID": [],
    "Exception / reconciliation action": null,
    "Replay status": null,
    "Record class": "Production",
  },
});

describe("evidence-aware Airtable production port", () => {
  it("carries qualified evidence into the event payload without changing quantity", async () => {
    const source = createFakeAirtableRowSource({
      eventRows: [row("approximately 2 kg")],
      baseLabel: "airtable-production-contract",
      provenance: "contract test — source shape is production-labelled but no network is used",
    });
    const port = createEvidenceAwareAirtableProductionPort({
      source,
      mode: "PRODUCTION_READ_ONLY",
    });

    const result = await port.read({
      mode: "PRODUCTION_READ_ONLY",
      datasetId: "household",
      windowStart: "2026-08-15",
      windowEnd: "2026-08-15",
    });

    expect(result.openingEvents).toHaveLength(1);
    expect(result.openingEvents[0]?.payload.quantity).toBe(2);
    expect(result.openingEvents[0]?.payload.unit).toBe("kg");
    expect(result.openingEvents[0]?.payload.evidencePrecision).toBe("QUALIFIED_AMBIGUOUS");
  });
});
