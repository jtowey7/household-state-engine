import { describe, it, expect } from "vitest";
import { replayEvents } from "@/lib/state-engine/engine";
const now = () => "2026-01-01T00:00:00.000Z";
const ev = (o: any) => ({ recordClass: "Production", eventType: "ITEM_STOCK_SET", itemKey: "salmon", occurredAt: "2026-01-01T00:00:00.000Z", payload: { quantity: 1, unit: "g" }, ...o });
describe("probe", () => {
  it("supersession cycle", () => {
    const r = replayEvents([
      ev({ eventId: "E1", supersedes: ["E2"], payload: { quantity: 780, unit: "g" } }),
      ev({ eventId: "E2", supersedes: ["E1"], payload: { quantity: 500, unit: "g" } }),
    ], { now });
    console.log(JSON.stringify({ status: r.reconciliationStatus, items: r.items, contributing: r.contributingEventIds, exc: r.exceptions.map(e=>e.code) }, null, 1));
  });
  it("self supersession", () => {
    const r = replayEvents([ev({ eventId: "E1", supersedes: ["E1"], payload: { quantity: 780, unit: "g" } })], { now });
    console.log(JSON.stringify({ status: r.reconciliationStatus, items: r.items, exc: r.exceptions.map(e=>e.code) }, null, 1));
  });
  it("supersedes an id that never arrives", () => {
    const r = replayEvents([ev({ eventId: "E2", supersedes: ["MISSING"], payload: { quantity: 500, unit: "g" } })], { now });
    console.log(JSON.stringify({ status: r.reconciliationStatus, items: r.items.map(i=>i.quantity), exc: r.exceptions.map(e=>e.code) }, null, 1));
  });
});
