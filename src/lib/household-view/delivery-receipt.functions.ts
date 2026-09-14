import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseStatus } from "@tanstack/react-start/server";

import { authorizeOperatorSession } from "../operator-read-auth";
import { detectAppliedDeliveryReceipt, type DeliveryReceiptDetection } from "./delivery-receipt";

/**
 * Read-only check: does an Applied Production delivery receipt already exist
 * for this exact basket identity?
 *
 * Reuses the existing GET-only Airtable HOUSEHOLD EVENTS row source. It writes
 * nothing, proposes nothing, and fails closed: any configuration gap, read
 * failure or ambiguity reports "no receipt", which keeps the explicit human
 * confirmation journey in place.
 */
export type DeliveryReceiptRead =
  | { status: "CONFIRMED"; receipt: Extract<DeliveryReceiptDetection, { confirmed: true }> }
  | { status: "NOT_CONFIRMED"; detail: string };

async function runtimeEnvironment(): Promise<Record<string, string | undefined>> {
  const cloudflareEnv: Record<string, string | undefined> = {};
  try {
    const cloudflareWorkers = (await import("cloudflare:workers")) as { env?: Record<string, unknown> };
    for (const [key, value] of Object.entries(cloudflareWorkers.env ?? {})) {
      if (typeof value === "string") cloudflareEnv[key] = value;
    }
  } catch {
    /* local/test fallback */
  }
  return { ...(typeof process === "undefined" ? {} : (process.env as Record<string, string | undefined>)), ...cloudflareEnv };
}

export const getAppliedDeliveryReceipt = createServerFn({ method: "GET" })
  .inputValidator((data: { basketId: string; basketVersion: number; basketFingerprint: string }) => data)
  .handler(async ({ data }): Promise<DeliveryReceiptRead> => {
    const env = await runtimeEnvironment();
    const authorization = await authorizeOperatorSession(
      new Request("https://foodos.local/runtime/household/delivery-receipt", { headers: { cookie: getRequestHeader("cookie") ?? "" } }),
      env,
    );
    if (authorization) {
      setResponseStatus(authorization.status);
      return { status: "NOT_CONFIRMED", detail: "Operator session required." };
    }

    const { resolveAirtableConfig, createAirtableRestRowSource, readOnlyFetch } = await import(
      "../production-adapter/airtable-rest-source"
    );
    const resolution = resolveAirtableConfig(env);
    if (resolution.status === "NOT_CONFIGURED") {
      return { status: "NOT_CONFIRMED", detail: "Production connector is not configured." };
    }

    const source = createAirtableRestRowSource({
      config: resolution.config,
      fetchImpl: readOnlyFetch((input, init) => fetch(input, init as RequestInit) as never),
    });

    const now = new Date();
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const windowStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    try {
      const rows = await source.listEventRows({ mode: "PRODUCTION_READ_ONLY", datasetId: "household", windowStart, windowEnd });
      const detection = detectAppliedDeliveryReceipt(
        rows.map((row) => ({
          eventId: typeof row.fields["Event ID"] === "string" ? row.fields["Event ID"] : null,
          recordClass: typeof row.fields["Record class"] === "string" ? row.fields["Record class"] : null,
          replayStatus: typeof row.fields["Replay status"] === "string" ? row.fields["Replay status"] : null,
          occurredAt: typeof row.fields["Occurred at"] === "string" ? row.fields["Occurred at"] : null,
          evidence: typeof row.fields["Evidence"] === "string" ? row.fields["Evidence"] : null,
        })),
        { basketId: data.basketId, basketVersion: data.basketVersion, basketFingerprint: data.basketFingerprint },
      );
      if (!detection.confirmed) return { status: "NOT_CONFIRMED", detail: "No applied delivery receipt matches this basket." };
      return { status: "CONFIRMED", receipt: detection };
    } catch (cause) {
      return { status: "NOT_CONFIRMED", detail: cause instanceof Error ? cause.message : String(cause) };
    }
  });
