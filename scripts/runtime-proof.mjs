const baseUrl = process.env.FOODOS_RUNTIME_URL || "https://household-state-engine.jtowey7.workers.dev";
const taskId = process.env.FOODOS_RUNTIME_TASK_ID || "CLOUDFLARE-01-SYNTHETIC";

const request = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: response.status, json };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const health = await fetch(`${baseUrl}/runtime/health`);
const healthBody = await health.json();
if (health.status !== 200 || healthBody.ok !== true) {
  throw new Error(`Health proof failed: HTTP ${health.status} ${JSON.stringify(healthBody)}`);
}

const householdStateBefore = await fetch(`${baseUrl}/runtime/household/state`);
const householdBeforeBody = await householdStateBefore.json();
if (householdStateBefore.status !== 200 || householdBeforeBody.ok !== true || householdBeforeBody.mode !== "TEST_ONLY") {
  throw new Error(`Household state read proof failed: HTTP ${householdStateBefore.status} ${JSON.stringify(householdBeforeBody)}`);
}

const householdItem = `runtime-proof-milk-${Date.now()}`;
const householdEvent = {
  eventId: `RUNTIME-HOUSEHOLD-${Date.now()}`,
  recordClass: "Test",
  eventType: "ITEM_STOCK_SET",
  itemKey: householdItem,
  occurredAt: new Date().toISOString(),
  payload: { quantity: 2, unit: "litre" },
};
const householdAppend = await request("/runtime/household/events", householdEvent);
if (householdAppend.status !== 200 || householdAppend.json.ok !== true || householdAppend.json.mode !== "TEST_ONLY") {
  throw new Error(`Household event append proof failed: ${JSON.stringify(householdAppend)}`);
}

const householdStateAfter = await fetch(`${baseUrl}/runtime/household/state`);
const householdAfterBody = await householdStateAfter.json();
const projectedItem = householdAfterBody.snapshot?.items?.find((item) => item.itemKey === householdItem);
if (
  householdStateAfter.status !== 200 ||
  householdAfterBody.ok !== true ||
  projectedItem?.quantity !== 2 ||
  householdAfterBody.eventCount !== householdBeforeBody.eventCount + 1
) {
  throw new Error(`Household materialisation proof failed: before=${JSON.stringify(householdBeforeBody)} append=${JSON.stringify(householdAppend)} after=${JSON.stringify(householdAfterBody)}`);
}

const householdDuplicate = await request("/runtime/household/events", householdEvent);
if (householdDuplicate.status !== 200 || householdDuplicate.json.duplicate !== true || householdDuplicate.json.conflict !== false) {
  throw new Error(`Household duplicate-idempotency proof failed: ${JSON.stringify(householdDuplicate)}`);
}

async function concurrentClaims(suffix) {
  const runId = `CONCURRENCY-${Date.now()}-${suffix}`;
  const [a, b] = await Promise.all([
    request("/runtime/claim", { taskId, runId: `${runId}-A`, agentId: "runtime-proof-A", leaseSeconds: 60 }),
    request("/runtime/claim", { taskId, runId: `${runId}-B`, agentId: "runtime-proof-B", leaseSeconds: 60 }),
  ]);
  return { a, b, runId };
}

let claims = await concurrentClaims("first");
let winners = [claims.a, claims.b].filter((result) => result.status === 200 && result.json.claimed === true).length;
let losers = [claims.a, claims.b].filter((result) => result.status === 200 && result.json.claimed === false).length;

if (winners === 0) {
  console.log("Synthetic task was already leased; waiting for stale-lease recovery before retrying concurrency proof.");
  await sleep(65_000);
  claims = await concurrentClaims("retry");
  winners = [claims.a, claims.b].filter((result) => result.status === 200 && result.json.claimed === true).length;
  losers = [claims.a, claims.b].filter((result) => result.status === 200 && result.json.claimed === false).length;
}

if (winners !== 1 || losers !== 1) {
  throw new Error(`Concurrency proof failed: A=${JSON.stringify(claims.a)} B=${JSON.stringify(claims.b)}`);
}

const winner = claims.a.json.claimed ? claims.a : claims.b;
const winnerRunId = winner.json.runId;
const evidence = JSON.stringify({ proof: "live-runtime", concurrency: "exactly-one-winner", source: "synthetic-only" });

const firstRun = await request("/runtime/run", {
  taskId,
  runId: winnerRunId,
  agentId: winner.json.agentId,
  outcome: "PASS",
  evidence,
});
const duplicateRun = await request("/runtime/run", {
  taskId,
  runId: winnerRunId,
  agentId: winner.json.agentId,
  outcome: "PASS",
  evidence,
});

if (firstRun.status !== 200 || firstRun.json.created !== true) {
  throw new Error(`First run persistence proof failed: ${JSON.stringify(firstRun)}`);
}
if (duplicateRun.status !== 200 || duplicateRun.json.idempotent !== true) {
  throw new Error(`Duplicate run idempotency proof failed: ${JSON.stringify(duplicateRun)}`);
}

console.log("Waiting for the 60-second synthetic lease to expire...");
await sleep(65_000);

const reclaimed = await request("/runtime/claim", {
  taskId,
  runId: `STALE-RECOVERY-${Date.now()}`,
  agentId: "runtime-proof-recovery",
  leaseSeconds: 60,
});

if (reclaimed.status !== 200 || reclaimed.json.claimed !== true) {
  throw new Error(`Stale-lease recovery proof failed: ${JSON.stringify(reclaimed)}`);
}

console.log(JSON.stringify({
  result: "PASS",
  health: healthBody,
  household: {
    mode: householdAfterBody.mode,
    itemKey: householdItem,
    append: householdAppend,
    duplicate: householdDuplicate,
    materialisedQuantity: projectedItem.quantity,
  },
  concurrency: { claimA: claims.a, claimB: claims.b },
  idempotency: { firstRun, duplicateRun },
  staleLeaseRecovery: reclaimed,
}, null, 2));
