const baseUrl = "https://household-state-engine.jtowey7.workers.dev";
const itemKey = `runtime-proof-household-${Date.now()}`;

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
    throw new Error(`${path} returned non-JSON HTTP ${response.status}: ${text}`);
  }

  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await request("/runtime/health");
assert(health.status === 200 && health.payload.ok === true, `Runtime health failed: ${JSON.stringify(health)}`);

const setEvent = {
  eventId: `${itemKey}-set`,
  recordClass: "Test",
  eventType: "ITEM_STOCK_SET",
  itemKey,
  occurredAt: "2026-08-14T14:00:00.000Z",
  payload: { quantity: 2, unit: "litre" },
};

const deltaEvent = {
  eventId: `${itemKey}-consume`,
  recordClass: "Test",
  eventType: "ITEM_STOCK_DELTA",
  itemKey,
  occurredAt: "2026-08-14T14:05:00.000Z",
  payload: { quantity: -1, unit: "litre" },
};

const first = await request("/runtime/household/events", setEvent);
assert(first.status === 200 && first.payload.appended === true, `Initial event failed: ${JSON.stringify(first)}`);
const firstItem = first.payload.snapshot?.items?.find((item) => item.itemKey === itemKey);
assert(firstItem?.quantity === 2, `Initial item state was not materialised: ${JSON.stringify(first)}`);
assert(firstItem?.blocked === false, `Initial item was unexpectedly blocked: ${JSON.stringify(first)}`);
assert(!first.payload.snapshot?.blockedItemKeys?.includes(itemKey), `Initial replay blocked the proof item: ${JSON.stringify(first)}`);

const second = await request("/runtime/household/events", deltaEvent);
assert(second.status === 200 && second.payload.appended === true, `Delta event failed: ${JSON.stringify(second)}`);
const itemAfterDelta = second.payload.snapshot?.items?.find((item) => item.itemKey === itemKey);
assert(itemAfterDelta?.quantity === 1, `Expected quantity 1 after delta: ${JSON.stringify(second)}`);
assert(itemAfterDelta?.contributingEventIds?.length === 2, `Expected two contributing events: ${JSON.stringify(second)}`);

const duplicate = await request("/runtime/household/events", setEvent);
assert(duplicate.status === 200 && duplicate.payload.duplicate === true && duplicate.payload.appended === false, `Duplicate was not idempotent: ${JSON.stringify(duplicate)}`);
const duplicateItem = duplicate.payload.snapshot?.items?.find((item) => item.itemKey === itemKey);
assert(duplicateItem?.quantity === 1, `Duplicate changed materialised state: ${JSON.stringify(duplicate)}`);

const conflict = await request("/runtime/household/events", {
  ...setEvent,
  payload: { quantity: 3, unit: "litre" },
});
assert(conflict.status === 200 && conflict.payload.conflict === true && conflict.payload.appended === false, `Conflicting Event ID was not blocked: ${JSON.stringify(conflict)}`);
assert(conflict.payload.snapshot?.reconciliationStatus === "BLOCKED", `Conflict did not block replay: ${JSON.stringify(conflict)}`);
assert(conflict.payload.snapshot?.blockedItemKeys?.includes(itemKey), `Conflict item was not blocked: ${JSON.stringify(conflict)}`);

const productionEvent = await request("/runtime/household/events", {
  ...setEvent,
  eventId: `${itemKey}-production-attempt`,
  recordClass: "Production",
});
assert(productionEvent.status === 400, `Production event was not rejected at HTTP boundary: ${JSON.stringify(productionEvent)}`);

const state = await request("/runtime/household/state");
assert(state.status === 200 && state.payload.ok === true && state.payload.mode === "TEST_ONLY", `State read failed: ${JSON.stringify(state)}`);
const stateItem = state.payload.snapshot?.items?.find((item) => item.itemKey === itemKey);
assert(stateItem?.quantity === 1, `Durable replay state changed unexpectedly: ${JSON.stringify(state)}`);

console.log(JSON.stringify({
  ok: true,
  itemKey,
  checks: [
    "health",
    "receipt/set append",
    "item-scoped initial replay",
    "consumption delta replay",
    "duplicate Event ID idempotency",
    "conflicting Event ID blocks replay",
    "Production event rejected",
    "durable state replay",
  ],
  finalQuantity: stateItem.quantity,
  reconciliationStatus: state.payload.snapshot.reconciliationStatus,
}, null, 2));
