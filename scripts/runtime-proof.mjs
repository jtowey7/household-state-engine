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

const health = await fetch(`${baseUrl}/runtime/health`);
const healthBody = await health.json();
if (health.status !== 200 || healthBody.ok !== true) {
  throw new Error(`Health proof failed: HTTP ${health.status} ${JSON.stringify(healthBody)}`);
}

const runId = `CONCURRENCY-${Date.now()}`;
const [a, b] = await Promise.all([
  request("/runtime/claim", { taskId, runId: `${runId}-A`, agentId: "runtime-proof-A", leaseSeconds: 300 }),
  request("/runtime/claim", { taskId, runId: `${runId}-B`, agentId: "runtime-proof-B", leaseSeconds: 300 }),
]);

const winners = [a, b].filter((result) => result.status === 200 && result.json.claimed === true).length;
const losers = [a, b].filter((result) => result.status === 200 && result.json.claimed === false).length;
if (winners !== 1 || losers !== 1) {
  throw new Error(`Concurrency proof failed: A=${JSON.stringify(a)} B=${JSON.stringify(b)}`);
}

console.log(JSON.stringify({ health: healthBody, claimA: a, claimB: b, result: "PASS" }, null, 2));
