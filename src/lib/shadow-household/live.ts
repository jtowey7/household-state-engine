/**
 * Food OS — live shadow-run entry point.
 *
 * This is the only place the runtime would touch real household data, and it
 * still cannot write: the connector is GET-only and the port has no write
 * member. When no Airtable connection is configured (the current state of this
 * workspace) it returns NOT_CONNECTED with the exact missing configuration —
 * it never substitutes fixtures for real data and never claims connectivity.
 */

import {
  createAirtableProductionPort,
  type AirtableRowSource,
} from "../production-adapter/airtable-port";
import {
  createAirtableRestRowSource,
  describeAirtableConnectivity,
  readOnlyFetch,
  resolveAirtableConfig,
  type FetchLike,
} from "../production-adapter/airtable-rest-source";
import { runWeeklyShadowCycle } from "../weekly-cycle/cycle";
import type { WeeklyCycleRun } from "../weekly-cycle/types";
import type { SourceScope } from "../production-adapter/types";
import type { ConsumptionPlan } from "../consumption/types";
import type { DemandTarget } from "../quantity-adapter/types";

export type LiveShadowOutcome =
  | { status: "NOT_CONNECTED"; detail: string; missing: string[]; run: null }
  | { status: "READ_FAILED"; detail: string; missing: []; run: null }
  | { status: "SHADOW_RUN_COMPLETE"; detail: string; missing: []; run: WeeklyCycleRun };

export interface LiveShadowOptions {
  scope: SourceScope;
  plan: Omit<ConsumptionPlan, "openingEvents">;
  demandTargets: DemandTarget[];
  asOf: string;
  now?: () => string;
  env?: Record<string, string | undefined>;
  /** Injected only by tests; production uses global fetch. */
  fetchImpl?: FetchLike;
  /** Injected only by tests that exercise the port without HTTP. */
  sourceOverride?: AirtableRowSource;
}

/**
 * Attempts a real read-only shadow cycle. Output is isolated: no household
 * record is written and no order is dispatched, regardless of outcome.
 */
export async function attemptLiveShadowRun(
  options: LiveShadowOptions,
): Promise<LiveShadowOutcome> {
  let source = options.sourceOverride;

  if (!source) {
    const resolution = resolveAirtableConfig(options.env);
    if (resolution.status === "NOT_CONFIGURED") {
      return {
        status: "NOT_CONNECTED",
        detail: describeAirtableConnectivity(resolution),
        missing: resolution.missing,
        run: null,
      };
    }
    const baseFetch =
      options.fetchImpl ??
      ((input, init) => fetch(input, init as RequestInit) as unknown as ReturnType<FetchLike>);
    source = createAirtableRestRowSource({
      config: resolution.config,
      fetchImpl: readOnlyFetch(baseFetch),
    });
  }

  const port = createAirtableProductionPort({
    source,
    mode: "PRODUCTION_READ_ONLY",
    portId: `airtable-live:${source.baseLabel}`,
  });

  const run = await runWeeklyShadowCycle({
    port,
    scope: { ...options.scope, mode: "PRODUCTION_READ_ONLY" },
    plan: options.plan,
    asOf: options.asOf,
    ...(options.now ? { now: options.now } : {}),
    demandTargets: options.demandTargets,
  });

  if (run.status !== "COMPLETED") {
    return {
      status: "READ_FAILED",
      detail: "Live read-only cycle did not complete; no state was written and nothing was ordered.",
      missing: [],
      run: null,
    };
  }

  return {
    status: "SHADOW_RUN_COMPLETE",
    detail: "Read-only shadow cycle completed. Output is isolated: no write, no dispatch.",
    missing: [],
    run,
  };
}
