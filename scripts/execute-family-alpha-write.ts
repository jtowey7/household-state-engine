import { canonicaliseAppend } from "../src/lib/event-writer/canonical";
import { authorizeAppend } from "../src/lib/event-writer/gate";
import { createAirtableRestAppendPort } from "../src/lib/event-writer/airtable-rest-append";
import { createHouseholdEventWriter } from "../src/lib/event-writer/writer";
import { assertReleaseIdentityStable } from "../src/lib/event-writer/release-identity";
import type { AppendAuthorization, AppendIntent } from "../src/lib/event-writer/types";

export type FamilyAlphaRelease = {
  releaseId: string;
  expectedSnapshotId: string;
  expectedReplayId: string;
  intent: AppendIntent;
  authorization: AppendAuthorization & {
    releaseId: string;
    expectedSnapshotId: string;
    expectedReplayId: string;
    expiresAt: string;
  };
  compensationPlan: {
    eventId: string;
    quantityDelta: number;
    unit: string;
    compensatesEventId: string;
  };
};

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
}

function parseJson<T>(name: string): T {
  const value = required(name);
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
}

function assertHuman(principal: string): void {
  if (/(scheduler|agent|bot|workflow|automation|system)/i.test(principal)) {
    throw new Error("Automated principals cannot approve Family Alpha Production writes");
  }
}

async function currentMainSha(): Promise<string> {
  const response = await fetch("https://api.github.com/repos/jtowey7/household-state-engine/commits/main", {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`Current main identity unavailable: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { sha?: string };
  if (!payload.sha?.trim()) throw new Error("Current main identity response was missing SHA");
  return payload.sha.trim();
}

async function runtimeBuildSha(): Promise<string> {
  const response = await fetch(
    "https://household-state-engine.jtowey7.workers.dev/runtime-build-id.txt",
  );
  if (!response.ok) {
    throw new Error(`Production runtime identity unavailable: HTTP ${response.status}`);
  }
  const runtimeSha = (await response.text()).trim();
  if (!runtimeSha) throw new Error("Production runtime identity response was empty");
  return runtimeSha;
}

async function main(): Promise<void> {
  const baseId = required("AIRTABLE_BASE_ID");
  const apiKey = required("AIRTABLE_API_KEY");
  const readToken = required("FOODOS_PRODUCTION_READ_TOKEN");
  const expectedMainSha = required("EXPECTED_MAIN_SHA");
  const release = parseJson<FamilyAlphaRelease>("FAMILY_ALPHA_RELEASE_JSON");

  const runtimeIdentity = await runtimeBuildSha();
  if (runtimeIdentity !== expectedMainSha) {
    throw new Error(`Production runtime identity drift: expected ${expectedMainSha}, received ${runtimeIdentity}`);
  }

  assertHuman(release.authorization.approvedBy);
  if (!release.releaseId.trim() || release.authorization.releaseId !== release.releaseId) {
    throw new Error("Release identity mismatch");
  }
  if (release.authorization.expectedSnapshotId !== release.expectedSnapshotId) {
    throw new Error("Approval snapshot binding mismatch");
  }
  if (release.authorization.expectedReplayId !== release.expectedReplayId) {
    throw new Error("Approval replay binding mismatch");
  }

  const nowMs = Date.now();
  const approvedAt = Date.parse(release.authorization.approvedAt);
  const expiresAt = Date.parse(release.authorization.expiresAt);
  if (
    !Number.isFinite(approvedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= approvedAt ||
    nowMs < approvedAt ||
    nowMs >= expiresAt
  ) {
    throw new Error("Approval is outside its valid time window");
  }

  if (release.intent.recordClass !== "Production") {
    throw new Error("Family Alpha runtime release must be Production-class");
  }
  if (
    !release.compensationPlan.compensatesEventId ||
    !release.compensationPlan.eventId ||
    release.compensationPlan.eventId === release.authorization.eventId
  ) {
    throw new Error("Compensation plan must be distinct and bound to the forward event");
  }
  if (release.compensationPlan.compensatesEventId !== release.authorization.eventId) {
    throw new Error("Compensation plan is not bound to the approved forward event");
  }
  if (release.compensationPlan.quantityDelta !== -(release.intent.quantityDelta ?? 0)) {
    throw new Error("Compensation plan is not the exact inverse quantity");
  }
  if (release.compensationPlan.unit !== (release.intent.unit ?? "")) {
    throw new Error("Compensation plan unit does not match the forward event");
  }

  const replayUrl =
    "https://household-state-engine.jtowey7.workers.dev/runtime/production/replay?windowStart=2026-08-15T00:00:00.000Z&windowEnd=2026-08-15T23:59:59.999Z&replayClock=2026-08-16T00:00:00.000Z&datasetId=FoodOS%20Production%20HOUSEHOLD%20EVENTS";
  const unauth = await fetch(replayUrl);
  if (unauth.status !== 401) {
    throw new Error(`Production replay endpoint is not fail-closed: expected 401, received ${unauth.status}`);
  }

  const replayResponse = await fetch(replayUrl, {
    headers: { Authorization: `Bearer ${readToken}` },
  });
  if (!replayResponse.ok) {
    throw new Error(`Production replay read failed: HTTP ${replayResponse.status}`);
  }
  const replay = (await replayResponse.json()) as {
    ok?: boolean;
    mode?: string;
    snapshot?: {
      snapshotId?: string;
      replayId?: string;
      reconciliationStatus?: string;
    };
    quarantinedItemKeys?: string[];
    quantityRequirementsHandoff?: { readyForQuantityRun?: boolean };
  };

  if (replay.ok !== true || replay.mode !== "PRODUCTION_READ_ONLY") {
    throw new Error("Fresh Production replay is not proven read-only");
  }
  if (replay.snapshot?.snapshotId !== release.expectedSnapshotId) {
    throw new Error("Snapshot drift: approved snapshot does not match fresh replay");
  }
  if (replay.snapshot?.replayId !== release.expectedReplayId) {
    throw new Error("Replay drift: approved replay does not match fresh replay");
  }
  if (replay.snapshot.reconciliationStatus === "BLOCKED") {
    throw new Error("Production replay is blocked");
  }
  if (replay.quantityRequirementsHandoff?.readyForQuantityRun !== true) {
    throw new Error("Quantity handoff is not ready");
  }
  if ((replay.quarantinedItemKeys ?? []).length !== 0) {
    throw new Error("Production replay has quarantined items");
  }

  const canonical = canonicaliseAppend(release.intent, {
    now: () => new Date().toISOString(),
    approvalReference: release.authorization.authorizationId,
  });
  if (!canonical.ok) {
    throw new Error(`Canonicalisation refused: ${canonical.rejection.code} — ${canonical.rejection.detail}`);
  }
  const record = canonical.record;

  if (
    release.authorization.eventId !== record.eventId ||
    release.authorization.payloadHash !== record.payloadHash
  ) {
    throw new Error("Approval is not bound to the exact canonical event payload");
  }

  const gate = authorizeAppend({
    record,
    target: "PRODUCTION_WRITE",
    decision: release.authorization.decision,
    approvedBy: release.authorization.approvedBy,
    approvedAt: release.authorization.approvedAt,
    evidenceSource: release.authorization.evidenceSource,
    evidenceDetail: release.authorization.evidenceDetail,
    actionPolicyReference: release.authorization.actionPolicyReference,
    authorizationId: release.authorization.authorizationId,
    credentialAvailable: true,
  });
  if (!gate.granted) {
    throw new Error(`Release gate refused: ${gate.refusal.code} — ${gate.refusal.detail}`);
  }

  // Recheck both release identities immediately before the only Production write.
  // The runtime identity must be fetched again: the first check can become stale
  // if the deployed Worker changes after preflight but before the append.
  const finalMainSha = await currentMainSha();
  const finalRuntimeSha = await runtimeBuildSha();
  assertReleaseIdentityStable(expectedMainSha, finalMainSha, finalRuntimeSha);

  const port = createAirtableRestAppendPort({
    baseId,
    apiKey,
    preflightEventId: true,
  });
  const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
  const receipt = await writer.append(record, release.authorization);
  if (receipt.outcome !== "APPENDED_PRODUCTION" || receipt.written !== true) {
    throw new Error(`Production append did not complete: ${JSON.stringify(receipt)}`);
  }

  const verifyFormula = `{Event ID}='${record.eventId.replace(/'/g, "\\'")}'`;
  const verifyUrl = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent("tbluDjPNJ3hxUpWxN")}?filterByFormula=${encodeURIComponent(verifyFormula)}&maxRecords=2`;
  const verifyResponse = await fetch(verifyUrl, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!verifyResponse.ok) {
    throw new Error(`Post-write verification failed: HTTP ${verifyResponse.status}`);
  }
  const verified = (await verifyResponse.json()) as {
    records?: Array<{ id?: string; fields?: Record<string, unknown> }>;
  };
  const matches = (verified.records ?? []).filter(
    (row) => row.fields?.["Event ID"] === record.eventId,
  );
  if (matches.length !== 1) {
    throw new Error(`Post-write verification expected exactly one Event ID match, received ${matches.length}`);
  }

  const fields = matches[0].fields ?? {};
  for (const [name, expected] of Object.entries(record.row)) {
    const actual = fields[name];
    if (Array.isArray(expected)) {
      const actualList = Array.isArray(actual)
        ? actual.map(String)
        : typeof actual === "string" && actual.trim()
          ? actual.split(",").map((value) => value.trim())
          : [];
      if (JSON.stringify(actualList) !== JSON.stringify(expected)) {
        throw new Error(`Post-write field mismatch: ${name}`);
      }
    } else if (actual !== expected) {
      throw new Error(`Post-write field mismatch: ${name}`);
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      releaseId: release.releaseId,
      eventId: receipt.eventId,
      payloadHash: receipt.payloadHash,
      outcome: receipt.outcome,
      written: receipt.written,
      connectorRecordId: receipt.connector?.connectorRecordId,
      inventoryMutated: receipt.inventoryMutated,
      compensationPlanRecorded: true,
      runtimeIdentity: finalRuntimeSha,
    }),
  );
}

await main();
