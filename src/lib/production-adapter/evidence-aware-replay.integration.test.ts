import { describe, expect, it } from "vitest";
import { replayEvents, toQuantityRequirementsHandoff } from "../state-engine/engine";
import { mapHouseholdEventRowsWithEvidencePrecision } from "./evidence-aware-mapper";

const row = (evidence: string | null) => ({
  id: "recREAL123456789",
  fields: {
    "Event ID": "EV-QUALIFIED-1",
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

describe("evidence-aware adapter to replay gate", () => {
  it("preserves qualified source evidence through replay and blocks quantity handoff", () => {
    const mapped = mapHouseholdEventRowsWithEvidencePrecision([
      row("approximately 2 kg"),
    ]);

    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.ok).toBe(true);
    if (!mapped[0]?.ok) return;

    const snapshot = replayEvents(mapped.flatMap((result) => (result.ok ? [result.event] : [])), {
      now: () => "2026-08-15T10:02:00Z",
    });
    const handoff = toQuantityRequirementsHandoff(snapshot);

    expect(snapshot.items[0]?.evidencePrecision).toBe("QUALIFIED_AMBIGUOUS");
    expect(snapshot.blockedItemKeys).toEqual(["oats"]);
    expect(snapshot.reconciliationStatus).toBe("BLOCKED");
    expect(handoff.readyForQuantityRun).toBe(false);
    expect(handoff.items).toEqual([]);
    expect(handoff.blockedItemKeys).toEqual(["oats"]);
  });

  it("allows exact source evidence through the same handoff", () => {
    const mapped = mapHouseholdEventRowsWithEvidencePrecision([
      row("delivery receipt"),
    ]);

    expect(mapped[0]?.ok).toBe(true);
    if (!mapped[0]?.ok) return;

    const snapshot = replayEvents(mapped.flatMap((result) => (result.ok ? [result.event] : [])), {
      now: () => "2026-08-15T10:02:00Z",
    });
    const handoff = toQuantityRequirementsHandoff(snapshot);

    expect(snapshot.items[0]?.evidencePrecision).toBe("EXACT");
    expect(snapshot.reconciliationStatus).toBe("CLEAN");
    expect(handoff.readyForQuantityRun).toBe(true);
    expect(handoff.items).toEqual([
      {
        itemKey: "oats",
        quantity: 2,
        unit: "kg",
        evidencePrecision: "EXACT",
        sourceEventIds: ["EV-QUALIFIED-1"],
      },
    ]);
    expect(handoff.blockedItemKeys).toEqual([]);
  });
});
