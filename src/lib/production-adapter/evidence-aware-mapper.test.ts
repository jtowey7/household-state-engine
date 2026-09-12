import { describe, expect, it } from "vitest";
import { mapHouseholdEventRowWithEvidencePrecision } from "./evidence-aware-mapper";

const row = (evidence: string | null) => ({
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

describe("evidence-aware Airtable mapper", () => {
  it("preserves qualified evidence without changing quantity", () => {
    const result = mapHouseholdEventRowWithEvidencePrecision(row("approximately 2 kg"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.payload.quantity).toBe(2);
    expect(result.event.payload.unit).toBe("kg");
    expect(result.event.payload.evidencePrecision).toBe("QUALIFIED_AMBIGUOUS");
  });

  it("marks unqualified evidence as exact without altering the event", () => {
    const result = mapHouseholdEventRowWithEvidencePrecision(row("delivery receipt"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.event.payload.quantity).toBe(2);
    expect(result.event.payload.evidencePrecision).toBe("EXACT");
  });

  it("does not enrich rejected rows", () => {
    const bad = row("approximately 2 kg");
    (bad.fields as Record<string, unknown>)["Quantity delta"] = null;
    const result = mapHouseholdEventRowWithEvidencePrecision(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MISSING_QUANTITY_DELTA");
  });
});
