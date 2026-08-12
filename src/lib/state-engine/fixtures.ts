import type { HouseholdEvent } from "./types";

/**
 * SYNTHETIC test fixtures only. No real household production data.
 * Used exclusively by the State Engine Test Console.
 */
export const baseFixture: HouseholdEvent[] = [
  {
    eventId: "EVT-1001",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "oats-rolled",
    occurredAt: "2026-08-01T08:00:00.000Z",
    payload: { quantity: 1200, unit: "g", note: "synthetic fixture" },
  },
  {
    eventId: "EVT-1002",
    recordClass: "Production",
    eventType: "ITEM_STOCK_DELTA",
    itemKey: "milk-whole",
    occurredAt: "2026-08-01T09:15:00.000Z",
    payload: { quantity: 2, unit: "L", note: "synthetic fixture" },
  },
  {
    eventId: "EVT-1002",
    recordClass: "Production",
    eventType: "ITEM_STOCK_DELTA",
    itemKey: "milk-whole",
    occurredAt: "2026-08-01T09:15:00.000Z",
    payload: { quantity: 2, unit: "L", note: "synthetic fixture" },
  },
  {
    eventId: "EVT-1003",
    recordClass: "Test",
    eventType: "ITEM_STOCK_SET",
    itemKey: "oats-rolled",
    occurredAt: "2026-08-01T10:00:00.000Z",
    payload: { quantity: 999999, unit: "g", note: "must have zero effect" },
  },
];

export const duplicateFixture: HouseholdEvent[] = [
  {
    eventId: "EVT-2100",
    recordClass: "Production",
    eventType: "ITEM_STOCK_DELTA",
    itemKey: "eggs-large",
    occurredAt: "2026-08-02T08:00:00.000Z",
    payload: { quantity: 6, unit: "count" },
  },
  {
    eventId: "EVT-2100",
    recordClass: "Production",
    eventType: "ITEM_STOCK_DELTA",
    itemKey: "eggs-large",
    occurredAt: "2026-08-02T08:00:00.000Z",
    payload: { quantity: 6, unit: "count" },
  },
];

export const conflictFixture: HouseholdEvent[] = [
  {
    eventId: "EVT-3100",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "rice-basmati",
    occurredAt: "2026-08-03T08:00:00.000Z",
    payload: { quantity: 1000, unit: "g" },
  },
  {
    eventId: "EVT-3100",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "rice-basmati",
    occurredAt: "2026-08-03T08:00:00.000Z",
    payload: { quantity: 4000, unit: "g" },
  },
];

export const testRecordFixture: HouseholdEvent[] = [
  {
    eventId: "EVT-4100",
    recordClass: "Test",
    eventType: "ITEM_STOCK_SET",
    itemKey: "coffee-beans",
    occurredAt: "2026-08-04T08:00:00.000Z",
    payload: { quantity: 500, unit: "g", note: "test class — zero effect" },
  },
];

export const supersessionFixture: HouseholdEvent[] = [
  {
    eventId: "EVT-5100",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "flour-plain",
    occurredAt: "2026-08-05T08:00:00.000Z",
    payload: { quantity: 500, unit: "g" },
  },
  {
    eventId: "EVT-5101",
    recordClass: "Production",
    eventType: "ITEM_STOCK_SET",
    itemKey: "flour-plain",
    occurredAt: "2026-08-05T09:00:00.000Z",
    payload: { quantity: 1500, unit: "g" },
    supersedes: ["EVT-5100"],
  },
];

export const quickFixtures = [
  { id: "duplicate", label: "Duplicate event", events: duplicateFixture },
  { id: "conflict", label: "Payload conflict", events: conflictFixture },
  { id: "test", label: "Test event", events: testRecordFixture },
  { id: "supersession", label: "Supersession", events: supersessionFixture },
] as const;
