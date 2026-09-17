import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";

import { authorizeOperatorSession } from "../operator-read-auth";
import { createAirtableRestAppendPort } from "../event-writer/airtable-rest-append";
import { createHouseholdEventWriter } from "../event-writer/writer";
import { prepareHouseholdIntake, releaseHouseholdIntake, type HouseholdIntakeReleaseResult } from "./intake";
import {
  computeHouseholdUpdateBinding,
  materialisationApprovalFromHouseholdConfirmation,
  withPendingEventRows,
  type HouseholdUpdateBinding,
} from "./materialise-binding";
import { createAirtableRestRowSource } from "../production-adapter/airtable-rest-source";
import { createEvidenceAwareAirtableProductionPort } from "../production-adapter/evidence-aware-production-port";
import { createAirtableMaterialisationPort } from "../production-materialisation/airtable-port";
import { runProductionMaterialisation } from "../production-materialisation/run";
import type { AppendAuthorization } from "../event-writer/types";
import type { HouseholdIntakeSubmission } from "./types";
import type { SourceScope } from "../production-adapter/types";
import type { FetchLike } from "../production-adapter/airtable-rest-source";

const GATEWAY_AIRTABLE_URL = "https://connector-gateway.lovable.dev/airtable";
const DIRECT_AIRTABLE_URL = "https://api.airtable.com";
const EVENTS_TABLE_FALLBACK = "HOUSEHOLD EVENTS";
const DATASET_ID = "FoodOS Production HOUSEHOLD EVENTS";
/** The household record starts well before FoodOS; read the whole stream. */
const WINDOW_START = "2020-01-01T00:00:00.000Z";

async function runtimeEnvironment(): Promise<Record<string, string | undefined>> {
  const cloudflareEnv: Record<string, string | undefined> = {};
  try {
    const cloudflareWorkers = (await import("cloudflare:workers")) as {
      env?: Record<string, unknown>;
    };
    for (const [key, value] of Object.entries(cloudflareWorkers.env ?? {})) {
      if (typeof value === "string") cloudflareEnv[key] = value;
    }
  } catch {
    // Local/test execution falls back to process.env below.
  }
  return {
    ...(typeof process === "undefined" ? {} : (process.env as Record<string, string | undefined>)),
    ...cloudflareEnv,
  };
}

interface AirtableRuntimeConfig {
  baseId: string;
  credential: string;
  lovableApiKey?: string;
  eventsTable: string;
}

function airtableRuntimeConfig(env: Record<string, string | undefined>): AirtableRuntimeConfig | null {
  const baseId = env["AIRTABLE_FOOD_OS_BASE_ID"];
  const credential = env["AIRTABLE_API_KEY"];
  const lovableApiKey = env["LOVABLE_API_KEY"]?.trim() || undefined;
  if (!baseId || !credential) return null;
  return {
    baseId,
    credential,
    lovableApiKey,
    eventsTable: env["AIRTABLE_HOUSEHOLD_EVENTS_TABLE"] ?? EVENTS_TABLE_FALLBACK,
  };
}

function scopeFor(windowEnd: string): SourceScope {
  return { mode: "PRODUCTION_READ_ONLY", datasetId: DATASET_ID, windowStart: WINDOW_START, windowEnd };
}

function airtableTransport(config: AirtableRuntimeConfig): { fetchImpl: FetchLike; apiUrl: string; gatewayApiKey?: string } {
  if (!config.lovableApiKey) {
    return { fetchImpl: fetch as unknown as FetchLike, apiUrl: DIRECT_AIRTABLE_URL };
  }
  const fetchImpl: FetchLike = async (input, init) => {
    const url = input.replace(/^https:\/\/api\.airtable\.com/, GATEWAY_AIRTABLE_URL);
    return fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${config.lovableApiKey}`,
        "X-Connection-Api-Key": config.credential,
        Accept: "application/json",
      },
    });
  };
  return { fetchImpl, apiUrl: GATEWAY_AIRTABLE_URL, gatewayApiKey: config.lovableApiKey };
}

async function authorizeHousehold(
  path: string,
  env: Record<string, string | undefined>,
): Promise<Response | undefined> {
  return authorizeOperatorSession(
    new Request(`https://foodos.local${path}`, {
      method: "POST",
      headers: { cookie: getRequestHeader("cookie") ?? "" },
    }),
    env,
  );
}

export type HouseholdUpdatePreview =
  | { ok: true; binding: HouseholdUpdateBinding }
  | { ok: false; detail: string };

export const previewHouseholdUpdate = createServerFn({ method: "POST" })
  .validator((data: { submission: HouseholdIntakeSubmission; preparedAt: string }) => data)
  .handler(async ({ data }): Promise<HouseholdUpdatePreview> => {
    const env = await runtimeEnvironment();
    const authorization = await authorizeHousehold("/runtime/household-input/preview", env);
    if (authorization) {
      setResponseStatus(authorization.status);
      return { ok: false, detail: "FoodOS is not connected to your household record just now." };
    }

    const config = airtableRuntimeConfig(env);
    if (!config) {
      setResponseStatus(503);
      return { ok: false, detail: "FoodOS is not connected to your household record just now." };
    }

    const prepared = prepareHouseholdIntake(data.submission, { now: () => data.preparedAt });
    if (!prepared.ok) return { ok: false, detail: prepared.detail };

    const transport = airtableTransport(config);
    const source = withPendingEventRows(
      createAirtableRestRowSource({
        config: {
          apiKey: config.credential,
          baseId: config.baseId,
          eventsTable: config.eventsTable,
          apiUrl: transport.apiUrl,
        },
        gatewayApiKey: transport.gatewayApiKey,
        fetchImpl: transport.fetchImpl,
      }),
      prepared.records,
    );
    const readPort = createEvidenceAwareAirtableProductionPort({
      source,
      mode: "PRODUCTION_READ_ONLY",
      portId: "airtable-production-household-events",
    });

    const binding = await computeHouseholdUpdateBinding({
      readPort,
      scope: scopeFor(data.preparedAt),
      replayClock: data.preparedAt,
    });
    setResponseHeader("Cache-Control", "no-store");
    if (!binding.ok) {
      setResponseStatus(502);
      return binding;
    }
    return binding;
  });

export interface HouseholdUpdateInventoryResult {
  updated: boolean;
  detail: string;
}

export type HouseholdReleaseResponse = HouseholdIntakeReleaseResult & {
  inventory?: HouseholdUpdateInventoryResult;
};

export const releaseHumanDelivery = createServerFn({ method: "POST" })
  .validator((data: {
    submission: HouseholdIntakeSubmission;
    approvals: readonly AppendAuthorization[];
    preparedAt: string;
    binding?: HouseholdUpdateBinding;
    confirmation?: { approvalId: string; approvedBy: string; approvedAt: string };
  }) => data)
  .handler(async ({ data }): Promise<HouseholdReleaseResponse> => {
    const env = await runtimeEnvironment();
    const authorization = await authorizeHousehold("/runtime/household-input/release", env);
    if (authorization) {
      setResponseStatus(authorization.status);
      return (await authorization.json()) as HouseholdIntakeReleaseResult;
    }

    const config = airtableRuntimeConfig(env);
    if (!config) {
      setResponseStatus(503);
      return {
        ok: false,
        code: "CANONICALISATION_FAILED",
        detail: "Production Airtable append connector is not configured; no household state was written.",
      };
    }

    const transport = airtableTransport(config);
    const port = createAirtableRestAppendPort({
      baseId: config.baseId,
      apiKey: config.credential,
      gatewayApiKey: transport.gatewayApiKey,
      apiUrl: transport.apiUrl,
      fetchImpl: transport.fetchImpl,
      preflightEventId: true,
    });
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const result = await releaseHouseholdIntake({
      submission: data.submission,
      writer,
      approvals: data.approvals,
      now: () => data.preparedAt,
    });
    setResponseHeader("Cache-Control", "no-store");

    if (!result.ok || !(result.written || result.duplicates > 0)) {
      setResponseStatus(result.ok ? 200 : 422);
      return result;
    }

    if (!data.binding || !data.confirmation) {
      return {
        ...result,
        inventory: {
          updated: false,
          detail: "FoodOS recorded this change but could not update your food list just now.",
        },
      };
    }

    const readPort = createEvidenceAwareAirtableProductionPort({
      source: createAirtableRestRowSource({
        config: {
          apiKey: config.credential,
          baseId: config.baseId,
          eventsTable: config.eventsTable,
          apiUrl: transport.apiUrl,
        },
        gatewayApiKey: transport.gatewayApiKey,
        fetchImpl: transport.fetchImpl,
      }),
      mode: "PRODUCTION_READ_ONLY",
      portId: "airtable-production-household-events",
    });
    const writePort = createAirtableMaterialisationPort({
      apiKey: config.credential,
      gatewayApiKey: transport.gatewayApiKey,
      apiUrl: transport.apiUrl,
      baseId: config.baseId,
      eventsTable: config.eventsTable,
      fetchImpl: transport.fetchImpl,
    });

    const materialised = await runProductionMaterialisation({
      readPort,
      writePort,
      scope: scopeFor(data.binding.windowEnd),
      replayClock: data.binding.replayClock,
      approval: materialisationApprovalFromHouseholdConfirmation(data.binding, data.confirmation),
    });

    return {
      ...result,
      inventory: materialised.ok
        ? { updated: true, detail: "Your food list is up to date." }
        : {
            updated: false,
            detail:
              "FoodOS recorded this change, but your food list has moved on since you confirmed it, so nothing was overwritten. Try again in a moment.",
          },
    };
  });
