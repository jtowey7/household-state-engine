import { describe, expect, it } from "vitest";
import { replayEvents, toQuantityRequirementsHandoff } from "./engine";
import { revalidateQuantityRequirementsHandoff } from "./quantity-handoff-auth";

const snapshot = replayEvents(
  [
    {
      eventId: "stock-sugar-1",
      recordClass: "Production",
      eventType: "ITEM_STOCK_SET",
      itemKey: "sugar",
      occurredAt: "2026-09-03T22:00:00.000Z",
      payload: { quantity: 2, unit: "kg" },
    },
  ],
  { now: () => "2026-09-03T22:01:00.000Z" },
);

const canonical = toQuantityRequirementsHandoff(snapshot);

describe("quantity handoff origin revalidation", () => {
  it("accepts the canonical handoff derived from the same snapshot", () => {
    expect(revalidateQuantityRequirementsHandoff(snapshot, canonical)).toEqual({
      valid: true,
      code: null,
      detail: "Quantity handoff is bound to the supplied authoritative StateSnapshot.",
    });
  });

  it("rejects payload drift even when snapshotId and replayId are retained", () => {
    const forged = {
      ...canonical,
      items: canonical.items.map((item) => ({ ...item, quantity: item.quantity + 1 })),
    };

    const result = revalidateQuantityRequirementsHandoff(snapshot, forged);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("HANDOFF_PAYLOAD_DRIFT");
  });

  it("rejects a handoff from a different snapshot before trusting its payload", () => {
    const otherSnapshot = replayEvents(
      [
        {
          eventId: "stock-sugar-2",
          recordClass: "Production",
          eventType: "ITEM_STOCK_SET",
          itemKey: "sugar",
          occurredAt: "2026-09-03T22:02:00.000Z",
          payload: { quantity: 5, unit: "kg" },
        },
      ],
      { now: () => "2026-09-03T22:03:00.000Z" },
    );

    const result = revalidateQuantityRequirementsHandoff(
      snapshot,
      toQuantityRequirementsHandoff(otherSnapshot),
    );
    expect(result.valid).toBe(false);
    expect(result.code).toBe("HANDOFF_SNAPSHOT_ID_MISMATCH");
  });
});
