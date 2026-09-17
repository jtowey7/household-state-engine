import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";
import { authorizeOperatorSession } from "../operator-read-auth";
import { createAirtableRestAppendPort, HOUSEHOLD_EVENTS_TABLE } from "../event-writer/airtable-rest-append";
import { createHouseholdEventWriter } from "../event-writer/writer";
import { releaseHouseholdIntake, type HouseholdIntakeReleaseResult } from "./intake";
import type { AppendAuthorization } from "../event-writer/types";
import type { HouseholdIntakeSubmission } from "./types";
import type { FetchLike } from "../production-adapter/airtable-rest-source";
import { createAirtableRestRowSource } from "../production-adapter/airtable-rest-source";
import { loadProductionState } from "../production-adapter/adapter";
import { replayEvents } from "../state-engine/engine";
import { createAirtableMaterialisationPort } from "../production-materialisation/airtable-port";
import { executeInventoryMaterialisation } from "../production-materialisation/execute";
import { planInventoryMaterialisation } from "../production-materialisation/plan";
import type { MaterialisationApproval, MaterialisationPlan } from "../production-materialisation/types";

const AIRTABLE_GATEWAY_URL = "https://connector-gateway.lovable.dev/airtable";
const AIRTABLE_DIRECT_URL = "https://api.airtable.com";
const MATERIALISATION_WINDOW_START = "1970-01-01T00:00:00.000Z";

export function createAirtableGatewayFetch(options: { connectionApiKey: string; gatewayApiKey: string; fetchImpl?: FetchLike }): FetchLike {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  return async (input, init) => {
    const url = input.replace(/^https:\/\/api\.airtable\.com/, AIRTABLE_GATEWAY_URL);
    return fetchImpl(url, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${options.gatewayApiKey}`, "X-Connection-Api-Key": options.connectionApiKey, Accept: "application/json" } });
  };
}

export function scopeMaterialisationPlan(plan: MaterialisationPlan, itemKey: string): MaterialisationPlan {
  const wanted = itemKey.trim().toLowerCase();
  const lines = plan.lines.filter((line) => line.itemKey.trim().toLowerCase() === wanted);
  const writes = plan.writes.filter((line) => line.itemKey.trim().toLowerCase() === wanted);
  const eventIds = new Set(lines.flatMap((line) => line.contributingEventIds));
  return { ...plan, lines, writes, eventIdsToMarkReplayed: plan.eventIdsToMarkReplayed.filter((eventId) => eventIds.has(eventId)), alreadyMaterialised: writes.length === 0 };
}

export interface ExplicitMaterialisationApproval {
  approval: MaterialisationApproval;
}

async function runtimeEnvironment(): Promise<Record<string, string | undefined>> {
  const cloudflareEnv: Record<string, string | undefined> = {};
  try {
    const cloudflareWorkers = (await import("cloudflare:workers")) as { env?: Record<string, unknown> };
    for (const [key, value] of Object.entries(cloudflareWorkers.env ?? {})) if (typeof value === "string") cloudflareEnv[key] = value;
  } catch {
    // Local/test execution falls back to process.env below.
  }
  return { ...(typeof process === "undefined" ? {} : (process.env as Record<string, string | undefined>)), ...cloudflareEnv };
}

export const releaseHumanDelivery = createServerFn({ method: "POST" })
  .validator((data: { submission: HouseholdIntakeSubmission; approvals: readonly AppendAuthorization[]; preparedAt: string; materialisation?: ExplicitMaterialisationApproval }) => data)
  .handler(async ({ data }): Promise<HouseholdIntakeReleaseResult & { materialisation?: unknown }> => {
    const env = await runtimeEnvironment();
    const authorization = await authorizeOperatorSession(new Request("https://foodos.local/runtime/household-input/release", { method: "POST", headers: { cookie: getRequestHeader("cookie") ?? "" } }), env);
    if (authorization) {
      setResponseStatus(authorization.status);
      return (await authorization.json()) as HouseholdIntakeReleaseResult;
    }

    const baseId = env["AIRTABLE_FOOD_OS_BASE_ID"];
    const credential = env["AIRTABLE_API_KEY"];
    if (!baseId || !credential) {
      setResponseStatus(503);
      return { ok: false, code: "CANONICALISATION_FAILED", detail: "Production Airtable connector is not configured; no household state was written." };
    }

    const lovableApiKey = env["LOVABLE_API_KEY"];
    const useGateway = Boolean(lovableApiKey);
    const gatewayFetch = useGateway ? createAirtableGatewayFetch({ connectionApiKey: credential, gatewayApiKey: lovableApiKey!, fetchImpl: fetch as unknown as FetchLike }) : (fetch as unknown as FetchLike);
    const apiUrl = useGateway ? AIRTABLE_GATEWAY_URL : AIRTABLE_DIRECT_URL;
    const port = createAirtableRestAppendPort({ baseId, apiKey: credential, fetchImpl: gatewayFetch, apiUrl, preflightEventId: true });
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const result = await releaseHouseholdIntake({ submission: data.submission, writer, approvals: data.approvals, now: () => data.preparedAt });

    if (!result.ok || data.submission.kind !== "STOCK_CORRECTION" || (result.appended === 0 && result.duplicates === 0)) {
      setResponseStatus(result.ok ? 200 : 422);
      setResponseHeader("Cache-Control", "no-store");
      return result;
    }

    // A household-event approval is NOT a materialisation approval. Never
    // derive or manufacture MaterialisationApproval here. The exact snapshot
    // and replay must be explicitly approved by a human before INVENTORY is
    // written. Until that second approval exists, the event append is the only
    // completed action and the UI must not claim inventory persistence.
    if (!data.materialisation?.approval) {
      setResponseStatus(200);
      setResponseHeader("Cache-Control", "no-store");
      return {
        ...result,
        materialisation: {
          ok: false,
          stage: "PLAN",
          code: "MISSING_HUMAN_APPROVAL",
          detail: "The household event was saved, but the resulting inventory snapshot has not received a separate explicit human approval; INVENTORY was not changed.",
        },
      };
    }

    const report = data.submission.report;
    const scope = { mode: "PRODUCTION_READ_ONLY" as const, datasetId: "FoodOS Production HOUSEHOLD EVENTS", windowStart: MATERIALISATION_WINDOW_START, windowEnd: data.preparedAt };
    const eventsTable = env["AIRTABLE_HOUSEHOLD_EVENTS_TABLE"] || HOUSEHOLD_EVENTS_TABLE;
    const readPort = createAirtableRestRowSource({ config: { apiKey: credential, baseId, eventsTable, apiUrl }, fetchImpl: gatewayFetch });
    const writePort = createAirtableMaterialisationPort({ apiKey: credential, baseId, eventsTable, fetchImpl: gatewayFetch, apiUrl });
    try {
      const loaded = await loadProductionState(readPort, scope);
      if (!loaded.ok) {
        const materialisation = { ok: false, stage: "LOAD", code: "SOURCE_LOAD_FAILED", detail: loaded.rejections.map((r) => `${r.code}: ${r.detail}`).join("; ") || "Production state load failed." };
        setResponseStatus(502); setResponseHeader("Cache-Control", "no-store"); return { ...result, materialisation };
      }
      const snapshot = replayEvents(loaded.openingEvents, { now: () => data.preparedAt });
      const fullPlan = planInventoryMaterialisation({ loaded, snapshot, existingInventory: await writePort.listInventory(), approval: data.materialisation.approval });
      if (!fullPlan.ok) {
        const materialisation = { ok: false, stage: "PLAN", code: fullPlan.code, detail: fullPlan.detail };
        setResponseStatus(409); setResponseHeader("Cache-Control", "no-store"); return { ...result, materialisation };
      }
      const scopedPlan = scopeMaterialisationPlan(fullPlan, report.itemKey);
      if (scopedPlan.lines.length === 0) {
        const materialisation = { ok: false, stage: "PLAN", code: "TARGET_NOT_IN_REPLAY", detail: `The approved stock event for ${report.itemKey} was not present in the canonical replay.` };
        setResponseStatus(409); setResponseHeader("Cache-Control", "no-store"); return { ...result, materialisation };
      }
      const execution = await executeInventoryMaterialisation(scopedPlan, writePort);
      const materialisation = execution.ok ? { ok: true, stage: "EXECUTE", materialisationId: execution.materialisationId, created: execution.created, updated: execution.updated, unchanged: execution.unchanged, replayStatusUpdatedEventIds: execution.replayStatusUpdatedEventIds } : { ok: false, stage: "EXECUTE", code: execution.code, detail: execution.detail, created: execution.created, updated: execution.updated };
      setResponseStatus(execution.ok ? 200 : 502); setResponseHeader("Cache-Control", "no-store"); return { ...result, materialisation };
    } catch (cause) {
      const materialisation = { ok: false, stage: "EXECUTE", code: "MATERIALISATION_FAILED", detail: cause instanceof Error ? cause.message : String(cause) };
      setResponseStatus(502); setResponseHeader("Cache-Control", "no-store"); return { ...result, materialisation };
    }
  });
