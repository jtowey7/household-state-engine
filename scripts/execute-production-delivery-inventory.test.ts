import { describe, expect, it } from "vitest";
import { buildDeliveryProjection, buildInventoryUpdates } from "./execute-production-delivery-inventory";
import type { AirtableRow } from "../src/lib/production-adapter/airtable-port";

const mapRows: AirtableRow[] = [
  { id: "map-cucumber", fields: { "Recipe item alias": "cucumber", "Canonical household item key": "Tesco Whole Cucumber Each", "Recipe unit": "item", "Canonical unit": "each", Active: true } },
];

const event = (id: string, quantity: number): AirtableRow => ({
  id: `rec-${id}`,
  fields: {
    "Event ID": id,
    "Event type": "Delivery",
    "Occurred at": "2026-09-09T07:01:01.824Z",
    Item: "cucumber",
    "Quantity delta": quantity,
    Unit: "each",
    Evidence: "DELIVERY-EVIDENCE:cbf2853db337947148d5dd8be87c4b0e",
    "Record class": "Production",
  },
});

describe("production delivery inventory materialisation", () => {
  it("uses delivery units verbatim and maps only item identity", () => {
    const projection = buildDeliveryProjection([event("E1", 4)], mapRows);
    expect(projection).toEqual([{
      item: "Tesco Whole Cucumber Each",
      quantity: 4,
      unit: "each",
      sourceEventIds: ["E1"],
      occurredAt: "2026-09-09T07:01:01.824Z",
    }]);
  });

  it("aggregates multiple delivery events for one mapped item without inventing conversion", () => {
    const projection = buildDeliveryProjection([event("E1", 4), event("E2", 2)], mapRows);
    expect(projection[0]!.quantity).toBe(6);
    expect(projection[0]!.sourceEventIds).toEqual(["E1", "E2"]);
  });

  it("marks an already-materialised event set as a no-op", () => {
    const projection = buildDeliveryProjection([event("E1", 4)], mapRows);
    const first = buildInventoryUpdates(projection, [{ id: "inv-1", fields: { Item: "Tesco Whole Cucumber Each", Quantity: 2, Unit: "each", Notes: "" } }], "2026-09-09");
    expect(first[0]!.applied).toBe(true);

    const second = buildInventoryUpdates(projection, [{
      id: "inv-1",
      fields: {
        Item: "Tesco Whole Cucumber Each",
        Quantity: 6,
        Unit: "each",
        Notes: first[0]!.fields.Notes,
      },
    }], "2026-09-09");
    expect(second[0]!.applied).toBe(false);
    expect(second[0]!.fields).toEqual({});
  });

  it("fails closed on a unit mismatch in the existing inventory row", () => {
    const projection = buildDeliveryProjection([event("E1", 4)], mapRows);
    expect(() => buildInventoryUpdates(projection, [{
      id: "inv-1",
      fields: { Item: "Tesco Whole Cucumber Each", Quantity: 2, Unit: "kg", Notes: "" },
    }], "2026-09-09")).toThrow(/unit kg differs from delivered each/);
  });
});
