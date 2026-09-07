import { loadProductionState } from "../src/lib/production-adapter/adapter";
import { createEvidenceAwareAirtableProductionPort } from "../src/lib/production-adapter/evidence-aware-port";
import { createAirtableRestRowSource, resolveAirtableConfig, type FetchLike } from "../src/lib/production-adapter/airtable-rest-source";
import { replayEvents } from "../src/lib/state-engine/engine";

function readArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required argument ${name}`);
  }
  return value;
}

const asOf = readArg("--as-of");
const baseId = readArg("--base");

if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  throw new Error(`--as-of must be YYYY-MM-DD, received ${asOf}`);
}

process.env.AIRTABLE_FOOD_OS_BASE_ID = baseId;
process.env.AIRTABLE_HOUSEHOLD_EVENTS_TABLE = "HOUSEHOLD EVENTS";

const resolution = resolveAirtableConfig();
if (resolution.status !== "CONFIGURED") {
  throw new Error(`Airtable connector not configured (missing: ${resolution.missing.join(", ")})`);
}

const fetchImpl = fetch as unknown as FetchLike;
const source = createAirtableRestRowSource({
  config: resolution.config,
  fetchImpl,
  provenance: `airtable read-only GET ${resolution.config.baseId}/${resolution.config.eventsTable}`,
});

const scope = {
  mode: "PRODUCTION_READ_ONLY" as const,
  datasetId: baseId,
  windowStart: "1970-01-01",
  windowEnd: asOf,
};

const port = createEvidenceAwareAirtableProductionPort({
  source,
  mode: "PRODUCTION_READ_ONLY",
  portId: "airtable-production-household-events",
});

const loaded = await loadProductionState(port, scope);
if (!loaded.ok) {
  console.error(JSON.stringify({ ok: false, mode: scope.mode, sourceId: loaded.sourceId, rejections: loaded.rejections }, null, 2));
  process.exit(1);
}

const replayClock = `${asOf}T23:59:59.999Z`;
const snapshot = replayEvents(loaded.openingEvents, { now: () => replayClock });

// Independently identify the canonical Production Delivery rows from the same
// read-only source. This proves the delivery acceptance target against the
// materialised snapshot rather than assuming that every stock delta is a Delivery.
const rawRows = await source.listEventRows(scope);
const deliveryRows = rawRows.filter((row) => {
  const fields = row.fields;
  return fields["Record class"] === "Production" && fields["Event type"] === "Delivery" && typeof fields["Event ID"] === "string";
});

const deliveryEventIds = deliveryRows.map((row) => row.fields["Event ID"] as string);
const contributingCounts = new Map<string, number>();
for (const eventId of snapshot.contributingEventIds) {
  contributingCounts.set(eventId, (contributingCounts.get(eventId) ?? 0) + 1);
}

const deliveryContributionCounts = Object.fromEntries(
  deliveryEventIds.map((eventId) => [eventId, contributingCounts.get(eventId) ?? 0]),
);
const missingDeliveryEventIds = deliveryEventIds.filter((eventId) => (contributingCounts.get(eventId) ?? 0) !== 1);
const duplicateContributorIds = snapshot.contributingEventIds.filter(
  (eventId, index, all) => all.indexOf(eventId) !== index,
);

const deliveryItemKeys = [...new Set(
  deliveryRows
    .map((row) => row.fields.Item)
    .filter((item): item is string => typeof item === "string"),
)];
const deliveryItems = snapshot.items.filter((item) => deliveryItemKeys.includes(item.itemKey));

if (deliveryEventIds.length !== 22) {
  throw new Error(`Expected exactly 22 canonical Production Delivery events in the cutoff window; found ${deliveryEventIds.length}.`);
}
if (missingDeliveryEventIds.length > 0) {
  throw new Error(`Delivery exactly-once proof failed for Event IDs: ${missingDeliveryEventIds.join(", ")}`);
}
if (duplicateContributorIds.length > 0) {
  throw new Error(`Snapshot contains duplicate contributing Event IDs: ${[...new Set(duplicateContributorIds)].join(", ")}`);
}

console.log(JSON.stringify({
  ok: true,
  mode: scope.mode,
  writable: loaded.writable,
  scope,
  sourceId: loaded.sourceId,
  replayId: snapshot.replayId,
  snapshotId: snapshot.snapshotId,
  replayTimestamp: snapshot.replayTimestamp,
  sourceEventCount: loaded.openingEvents.length,
  sourceRejectionCount: loaded.rejections.length,
  quarantinedItemKeys: loaded.quarantinedItemKeys,
  reconciliationStatus: snapshot.reconciliationStatus,
  blockedItemKeys: snapshot.blockedItemKeys,
  contributingEventCount: snapshot.contributingEventIds.length,
  ignoredEventCount: snapshot.ignoredEventIds.length,
  canonicalDeliveryEventCount: deliveryEventIds.length,
  deliveryContributionCounts,
  duplicateContributorIds: [...new Set(duplicateContributorIds)],
  deliveryItems,
  quantityRequirementsReady: snapshot.reconciliationStatus !== "BLOCKED",
  provenance: source.provenance,
}, null, 2));
