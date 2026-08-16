import { describe, expect, it } from "vitest";
import { existingEventMap } from "./execute-production-baseline";

const event = (eventId: string, item: string, quantityDelta: number) => ({
  id: `rec-${eventId}-${item}-${quantityDelta}`,
  fields: {
    "fld0eOLFhMirrp3sp": eventId,
    "fldofNnuJSzaZBgO9": "Correction",
    "fldllmvZqSOV8wRVB": "2026-08-16T00:00:00.000Z",
    "flddW9gBfP3MeaLbT": item,
    "fldyzlpssmG8TykGG": quantityDelta,
    "fld3t0OMEE5XmMg85": "units",
    "fldxqIfgRcM4b673v": String(quantityDelta),
    "fldzu1QfNZwhGAeln": "Production",
  },
});

describe("existingEventMap", () => {
  it("coalesces identical duplicate Event IDs", () => {
    const result = existingEventMap([
      event("BASELINE:milk", "milk", 2),
      event("BASELINE:milk", "milk", 2),
    ]);

    expect(result.size).toBe(1);
  });

  it("rejects conflicting duplicate Event IDs instead of letting the last row win", () => {
    expect(() =>
      existingEventMap([
        event("BASELINE:milk", "milk", 2),
        event("BASELINE:milk", "milk", 3),
      ]),
    ).toThrow(/conflicting payloads/);
  });

  it("fails closed when duplicate Event IDs cannot be fingerprinted", () => {
    expect(() =>
      existingEventMap([
        {
          id: "rec-1",
          fields: { "fld0eOLFhMirrp3sp": "BASELINE:milk" },
        },
        {
          id: "rec-2",
          fields: { "fld0eOLFhMirrp3sp": "BASELINE:milk" },
        },
      ]),
    ).toThrow(/cannot be proven/);
  });
});
