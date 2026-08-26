const baseUrl = "https://household-state-engine.jtowey7.workers.dev";

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    const contentType = response.headers.get("content-type") ?? "unknown";
    const cfRay = response.headers.get("cf-ray") ?? "missing";
    const server = response.headers.get("server") ?? "missing";
    const bodyPreview = text.slice(0, 4000).replace(/\s+/g, " ").trim();
    throw new Error(
      `${path} returned non-JSON HTTP ${response.status} content-type=${contentType} cf-ray=${cfRay} server=${server}: ${bodyPreview}`,
    );
  }

  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function reset() {
  const response = await request("/runtime/test/reset", {});
  assert(response.status === 200, `TEST reset failed: ${JSON.stringify(response)}`);
  assert(response.payload.mode === "TEST_ONLY", `TEST reset returned wrong mode: ${JSON.stringify(response)}`);
  assert(response.payload.status === "READY", `TEST reset did not return READY: ${JSON.stringify(response)}`);
}

async function itemState(itemKey) {
  const state = await request("/runtime/household/state");
  assert(state.status === 200 && state.payload.ok === true && state.payload.mode === "TEST_ONLY", `State read failed: ${JSON.stringify(state)}`);
  return { state, item: state.payload.snapshot?.items?.find((item) => item.itemKey === itemKey) };
}

const health = await request("/runtime/health");
assert(health.status === 200 && health.payload.ok === true, `Runtime health failed: ${JSON.stringify(health)}`);

const basicKey = `runtime-proof-household-basic-${Date.now()}`;
await reset();

const setEvent = {
  eventId: `${basicKey}-set`,
  recordClass: "Test",
  eventType: "ITEM_STOCK_SET",
  itemKey: basicKey,
  occurredAt: "2026-08-14T14:00:00.000Z",
  payload: { quantity: 2, unit: "litre" },
};

const deltaEvent = {
  eventId: `${basicKey}-consume`,
  recordClass: "Test",
  eventType: "ITEM_STOCK_DELTA",
  itemKey: basicKey,
  occurredAt: "2026-08-14T14:05:00.000Z",
  payload: { quantity: -1, unit: "litre" },
};

const first = await request("/runtime/household/events", setEvent);
assert(first.status === 200 && first.payload.appended === true, `Initial event failed: ${JSON.stringify(first)}`);
assert(first.payload.snapshot?.items?.find((item) => item.itemKey === basicKey)?.quantity === 2, `Initial state was not materialised: ${JSON.stringify(first)}`);

const second = await request("/runtime/household/events", deltaEvent);
assert(second.status === 200 && second.payload.appended === true, `Delta event failed: ${JSON.stringify(second)}`);
const itemAfterDelta = second.payload.snapshot?.items?.find((item) => item.itemKey === basicKey);
assert(itemAfterDelta?.quantity === 1, `Expected quantity 1 after delta: ${JSON.stringify(second)}`);
assert(itemAfterDelta?.contributingEventIds?.length === 2, `Expected two contributing events: ${JSON.stringify(second)}`);

const duplicate = await request("/runtime/household/events", setEvent);
assert(duplicate.status === 200 && duplicate.payload.duplicate === true && duplicate.payload.appended === false, `Duplicate was not idempotent: ${JSON.stringify(duplicate)}`);
assert(duplicate.payload.snapshot?.items?.find((item) => item.itemKey === basicKey)?.quantity === 1, `Duplicate changed state: ${JSON.stringify(duplicate)}`);

const conflict = await request("/runtime/household/events", {
  ...setEvent,
  payload: { quantity: 3, unit: "litre" },
});
assert(conflict.status === 200 && conflict.payload.conflict === true && conflict.payload.appended === false, `Conflicting Event ID was not blocked: ${JSON.stringify(conflict)}`);
assert(conflict.payload.snapshot?.reconciliationStatus === "BLOCKED", `Conflict did not block replay: ${JSON.stringify(conflict)}`);
assert(conflict.payload.snapshot?.blockedItemKeys?.includes(basicKey), `Conflict item was not blocked: ${JSON.stringify(conflict)}`);

const productionEvent = await request("/runtime/household/events", {
  ...setEvent,
  eventId: `${basicKey}-production-attempt`,
  recordClass: "Production",
});
assert(productionEvent.status === 400, `Production event was not rejected at HTTP boundary: ${JSON.stringify(productionEvent)}`);

const basicState = await itemState(basicKey);
assert(basicState.item?.quantity === 1, `Durable basic replay state changed unexpectedly: ${JSON.stringify(basicState.state)}`);

const supersessionKey = `runtime-proof-household-supersession-${Date.now()}`;
await reset();
const supersededId = `${supersessionKey}-original`;
const supersedingId = `${supersessionKey}-replacement`;
const original = await request("/runtime/household/events", {
  eventId: supersededId,
  recordClass: "Test",
  eventType: "ITEM_STOCK_SET",
  itemKey: supersessionKey,
  occurredAt: "2026-08-14T15:00:00.000Z",
  payload: { quantity: 2, unit: "kg" },
});
assert(original.status === 200 && original.payload.appended === true, `Supersession original failed: ${JSON.stringify(original)}`);
const replacement = await request("/runtime/household/events", {
  eventId: supersedingId,
  recordClass: "Test",
  eventType: "ITEM_STOCK_SET",
  itemKey: supersessionKey,
  occurredAt: "2026-08-14T15:01:00.000Z",
  payload: { quantity: 5, unit: "kg" },
  supersedes: [supersededId],
});
assert(replacement.status === 200 && replacement.payload.appended === true, `Superseding event failed: ${JSON.stringify(replacement)}`);
const supersessionItem = replacement.payload.snapshot?.items?.find((item) => item.itemKey === supersessionKey);
assert(supersessionItem?.quantity === 5, `Supersession did not replace state: ${JSON.stringify(replacement)}`);
assert(replacement.payload.snapshot?.contributingEventIds?.includes(supersedingId), `Superseding event did not contribute: ${JSON.stringify(replacement)}`);
assert(replacement.payload.snapshot?.ignoredEventIds?.includes(supersededId), `Superseded event was not ignored: ${JSON.stringify(replacement)}`);

const unitConflictKey = `runtime-proof-household-unit-${Date.now()}`;
await reset();
const unitSet = await request("/runtime/household/events", {
  eventId: `${unitConflictKey}-set`,
  recordClass: "Test",
  eventType: "ITEM_STOCK_SET",
  itemKey: unitConflictKey,
  occurredAt: "2026-08-14T16:00:00.000Z",
  payload: { quantity: 2, unit: "kg" },
});
assert(unitSet.status === 200 && unitSet.payload.appended === true, `Unit baseline failed: ${JSON.stringify(unitSet)}`);
const unitDelta = await request("/runtime/household/events", {
  eventId: `${unitConflictKey}-delta`,
  recordClass: "Test",
  eventType: "ITEM_STOCK_DELTA",
  itemKey: unitConflictKey,
  occurredAt: "2026-08-14T16:01:00.000Z",
  payload: { quantity: -1, unit: "litre" },
});
assert(unitDelta.status === 200 && unitDelta.payload.appended === true, `Unit-conflict delta was not accepted into TEST ledger: ${JSON.stringify(unitDelta)}`);
const unitItem = unitDelta.payload.snapshot?.items?.find((item) => item.itemKey === unitConflictKey);
assert(unitItem?.blocked === true, `Unit conflict did not block the item: ${JSON.stringify(unitDelta)}`);
assert(unitDelta.payload.snapshot?.reconciliationStatus === "BLOCKED", `Unit conflict did not block replay: ${JSON.stringify(unitDelta)}`);
assert(unitDelta.payload.snapshot?.blockedItemKeys?.includes(unitConflictKey), `Unit conflict item missing from blocked set: ${JSON.stringify(unitDelta)}`);

const finalState = await itemState(unitConflictKey);
assert(finalState.item?.blocked === true, `Durable unit-conflict state lost its block: ${JSON.stringify(finalState.state)}`);

console.log(JSON.stringify({
  ok: true,
  checks: [
    "health",
    "receipt/set append",
    "consumption delta replay",
    "duplicate Event ID idempotency",
    "conflicting Event ID blocks replay",
    "Production event rejected",
    "supersession replaces prior event",
    "unit conflict blocks affected item",
    "durable TEST replay state",
  ],
  finalReconciliationStatus: finalState.state.payload.snapshot.reconciliationStatus,
}, null, 2));
