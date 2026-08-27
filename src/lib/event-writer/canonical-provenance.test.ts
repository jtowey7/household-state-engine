import { describe, expect, it } from "vitest";
import {
  authorizeAppend,
  canonicaliseAppend,
  createFakeAppendPort,
  createHouseholdEventWriter,
  isCanonicalAppendRecord,
} from "./index";
import type { AppendIntent } from "../write-boundary/types";

const now = () => "2026-08-27T07:00:00.000Z";

const intent: AppendIntent = {
  eventType: "Consumption",
  item: "Chicken",
  occurredAt: "2026-08-27T06:30:00.000Z",
  quantityDelta: -1,
  unit: "kg",
  source: "QA transaction evidence",
  actor: "James",
  evidence: "Strong transaction evidence",
  recordClass: "Production",
};

function canonical() {
  const result = canonicaliseAppend(intent, { now });
  if (!result.ok) throw new Error(`fixture must canonicalise: ${result.rejection.code}`);
  return result.record;
}

describe("canonical append provenance", () => {
  it("rejects a structurally forged record even when Event ID and payload hash are copied", async () => {
    const record = canonical();
    const forged = {
      ...record,
      row: {
        ...record.row,
        Item: "Salmon",
        "Quantity delta": -2,
      },
    };

    expect(isCanonicalAppendRecord(forged)).toBe(false);

    const release = authorizeAppend({
      record,
      target: "PRODUCTION_WRITE",
      decision: "APPROVED",
      approvedBy: "James",
      evidenceSource: "STRONG_TRANSACTION_EVIDENCE",
      evidenceDetail: "Strong transaction evidence",
      policyIdentity: "family-alpha-household-event:v1",
      policyVersion: 1,
      credentialAvailable: true,
    });
    expect(release.granted).toBe(true);
    if (!release.granted) return;

    const port = createFakeAppendPort();
    const receipt = await createHouseholdEventWriter({
      mode: release.writerMode,
      port,
    }).append(forged, release.authorization);

    expect(receipt.outcome).toBe("REJECTED");
    expect(receipt.rejection?.code).toBe("NOT_CANONICAL");
    expect(port.ledger()).toHaveLength(0);
  });

  it("freezes the canonical record so approved payload cannot be mutated in place", () => {
    const record = canonical();
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.row)).toBe(true);
    expect(Object.isFrozen(record.row["Supersedes event ID"])).toBe(true);
    expect(record.row.Item).toBe("Chicken");
  });
});
