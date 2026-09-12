import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";

import { authorizeOperatorSession } from "../operator-read-auth";
import { createAirtableRestAppendPort } from "../event-writer/airtable-rest-append";
import { createHouseholdEventWriter } from "../event-writer/writer";
import { releaseHouseholdIntake, type HouseholdIntakeReleaseResult } from "./intake";
import type { AppendAuthorization } from "../event-writer/types";
import type { HouseholdIntakeSubmission } from "./types";
import type { FetchLike } from "../production-adapter/airtable-rest-source";

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

export const releaseHumanDelivery = createServerFn({ method: "POST" })
  .validator((data: {
    submission: HouseholdIntakeSubmission;
    approvals: readonly AppendAuthorization[];
    preparedAt: string;
  }) => data)
  .handler(async ({ data }): Promise<HouseholdIntakeReleaseResult> => {
    const env = await runtimeEnvironment();
    const authorization = await authorizeOperatorSession(
      new Request("https://foodos.local/runtime/household-input/release", {
        method: "POST",
        headers: { cookie: getRequestHeader("cookie") ?? "" },
      }),
      env,
    );
    if (authorization) {
      setResponseStatus(authorization.status);
      return (await authorization.json()) as HouseholdIntakeReleaseResult;
    }

    const baseId = env['AIRTABLE_FOOD_OS_BASE_ID'];
    const credential = env['AIRTABLE_API_KEY'];
    if (!baseId || !credential) {
      setResponseStatus(503);
      return {
        ok: false,
        code: "CANONICALISATION_FAILED",
        detail: "Production Airtable append connector is not configured; no household state was written.",
      };
    }

    const port = createAirtableRestAppendPort({
      baseId,
      apiKey: credential,
      fetchImpl: fetch as unknown as FetchLike,
      preflightEventId: true,
    });
    const writer = createHouseholdEventWriter({ mode: "PRODUCTION_WRITE", port });
    const result = await releaseHouseholdIntake({
      submission: data.submission,
      writer,
      approvals: data.approvals,
      now: () => data.preparedAt,
    });
    setResponseStatus(result.ok ? 200 : 422);
    setResponseHeader("Cache-Control", "no-store");
    return result;
  });
