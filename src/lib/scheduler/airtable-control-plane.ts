/**
 * Food OS — Airtable control-plane persistence for scheduler claims and
 * AGENT RUNS evidence.
 *
 * BOUNDARY (explicit, not aspirational): no Airtable connection exists in this
 * workspace, so nothing here is live. This file is the narrowest reusable
 * adapter contract for the connector gateway plus the deterministic behaviour
 * the scheduler depends on. Every HTTP call goes through an injected
 * `fetchImpl`, so the tests exercise the real request shapes with no network.
 *
 * Safety properties enforced here:
 * - WRITE SCOPE: only the two control-plane tables are writable. Any attempt to
 *   write HOUSEHOLD EVENTS / INVENTORY / SHOPPING / MEAL PLANS (or anything
 *   else) throws before a request is built.
 * - CLAIM OWNERSHIP: a claim is persisted only after a fresh read shows no
 *   live lease held by another cycle; a collision is reported, never stolen.
 *   Expired leases follow the existing `claimDirective` protocol.
 * - AGENT RUNS append/dedupe: existing Run ID => no second row, deterministic
 *   run identity preserved.
 * - FAILURE: every non-OK response or malformed payload becomes an explicit
 *   FAILED result carrying the provider status/body. Nothing is ever reported
 *   as persisted when it was not, and no partial write is retried blindly —
 *   both writes are idempotent on their natural key, so a retry is a no-op.
 */

import type {
  AgentRunPersistResult,
  AgentRunRecord,
  ClaimPersistResult,
  DirectiveClaim,
  SchedulerPersistence,
} from "./types";

export const AIRTABLE_GATEWAY_URL = "https://connector-gateway.lovable.dev/airtable";

/** The only tables this adapter may write. Control plane, never household. */
export const CONTROL_PLANE_WRITABLE_TABLES = ["SCHEDULER CLAIMS", "AGENT RUNS"] as const;

/** Production household tables. Writing any of these is a programming error. */
export const FORBIDDEN_WRITE_TABLES = [
  "HOUSEHOLD EVENTS",
  "INVENTORY",
  "SHOPPING",
  "MEAL PLANS",
  "MEALS",
  "RECIPES",
] as const;

export const SCHEDULER_CLAIM_FIELDS = [
  "Claim ID",
  "Directive ID",
  "Cycle ID",
  "Claimed at",
  "Expires at",
  "Record class",
] as const;

export const AGENT_RUN_KEY_FIELD = "Run ID";

export const CONTROL_PLANE_ENV_KEYS = {
  lovableApiKey: "LOVABLE_API_KEY",
  connectionKey: "AIRTABLE_API_KEY",
  baseId: "AIRTABLE_FOOD_OS_BASE_ID",
  claimsTable: "AIRTABLE_SCHEDULER_CLAIMS_TABLE",
  agentRunTable: "AIRTABLE_AGENT_RUN_TABLE",
} as const;

export interface ControlPlaneConfig {
  lovableApiKey: string;
  connectionKey: string;
  baseId: string;
  claimsTable: string;
  agentRunTable: string;
  gatewayUrl?: string;
}

export type ControlPlaneConfigResolution =
  | { status: "CONFIGURED"; config: ControlPlaneConfig; missing: [] }
  | { status: "NOT_CONFIGURED"; config: null; missing: string[] };

/** Credential boundary. Reads only declared keys, never throws, never invents. */
export function resolveControlPlaneConfig(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): ControlPlaneConfigResolution {
  const read = (key: string): string | undefined => {
    const raw = env[key];
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
  };
  const values = {
    lovableApiKey: read(CONTROL_PLANE_ENV_KEYS.lovableApiKey),
    connectionKey: read(CONTROL_PLANE_ENV_KEYS.connectionKey),
    baseId: read(CONTROL_PLANE_ENV_KEYS.baseId),
    claimsTable: read(CONTROL_PLANE_ENV_KEYS.claimsTable),
    agentRunTable: read(CONTROL_PLANE_ENV_KEYS.agentRunTable),
  };
  const missing = (Object.keys(values) as (keyof typeof values)[])
    .filter((k) => values[k] === undefined)
    .map((k) => CONTROL_PLANE_ENV_KEYS[k]);
  if (missing.length > 0) return { status: "NOT_CONFIGURED", config: null, missing };
  return {
    status: "CONFIGURED",
    missing: [],
    config: {
      lovableApiKey: values.lovableApiKey!,
      connectionKey: values.connectionKey!,
      baseId: values.baseId!,
      claimsTable: values.claimsTable!,
      agentRunTable: values.agentRunTable!,
    },
  };
}

export function describeControlPlanePersistence(
  resolution: ControlPlaneConfigResolution,
): string {
  return resolution.status === "CONFIGURED"
    ? "Airtable control-plane persistence configured — writes are restricted to SCHEDULER CLAIMS and AGENT RUNS."
    : `Airtable control-plane persistence NOT configured (missing: ${resolution.missing.join(", ")}). Scheduler claims and AGENT RUNS rows are not being persisted anywhere.`;
}

/** Hard write-scope guard. Throws rather than issuing a household write. */
export function assertWritableControlPlaneTable(table: string): void {
  const normalised = table.trim().toUpperCase();
  const allowed = CONTROL_PLANE_WRITABLE_TABLES.some((t) => t === normalised);
  if (!allowed) {
    throw new Error(
      `Forbidden write scope: "${table}" is not a control-plane table. The scheduler may only write ${CONTROL_PLANE_WRITABLE_TABLES.join(" / ")}; household production state is never mutated.`,
    );
  }
}

export type ControlPlaneFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface ControlPlaneStoreOptions {
  config: ControlPlaneConfig;
  /** Injected so contract tests never touch the network. */
  fetchImpl: ControlPlaneFetch;
}

interface ListResponse {
  records?: { id?: unknown; fields?: unknown }[];
}

function escapeFormulaValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toClaim(fields: Record<string, unknown>): DirectiveClaim | null {
  const str = (k: string): string | null =>
    typeof fields[k] === "string" && (fields[k] as string).length > 0 ? (fields[k] as string) : null;
  const claimId = str("Claim ID");
  const directiveId = str("Directive ID");
  const cycleId = str("Cycle ID");
  const claimedAt = str("Claimed at");
  const expiresAt = str("Expires at");
  if (!claimId || !directiveId || !cycleId || !claimedAt || !expiresAt) return null;
  if (Number.isNaN(Date.parse(claimedAt)) || Number.isNaN(Date.parse(expiresAt))) return null;
  return { claimId, directiveId, cycleId, claimedAt, expiresAt };
}

/**
 * Outbound payload validation. A partial or malformed control-plane row is
 * refused BEFORE any request is built, so a bad payload can never be written
 * and can never be reported as persisted.
 */
export function validateClaimPayload(claim: unknown): string[] {
  const problems: string[] = [];
  if (!claim || typeof claim !== "object") return ["claim is not an object"];
  const record = claim as Record<string, unknown>;
  const required: (keyof DirectiveClaim)[] = [
    "claimId",
    "directiveId",
    "cycleId",
    "claimedAt",
    "expiresAt",
  ];
  for (const key of required) {
    const value = record[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      problems.push(`missing or empty "${key}"`);
    }
  }
  for (const key of ["claimedAt", "expiresAt"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0 && Number.isNaN(Date.parse(value))) {
      problems.push(`"${key}" is not a parseable timestamp`);
    }
  }
  return problems;
}

const AGENT_RUN_REQUIRED_STRING_FIELDS = [
  "Run ID",
  "Cycle ID",
  "Wake at",
  "Control plane snapshot",
  "Work performed",
  "Outcome",
] as const;

export function validateAgentRunPayload(record: unknown): string[] {
  const problems: string[] = [];
  if (!record || typeof record !== "object") return ["AGENT RUNS record is not an object"];
  const fields = record as Record<string, unknown>;
  for (const key of AGENT_RUN_REQUIRED_STRING_FIELDS) {
    const value = fields[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      problems.push(`missing or empty "${key}"`);
    }
  }
  if (fields["Mode"] !== "SYNTHETIC") problems.push(`"Mode" must be SYNTHETIC`);
  if (fields["Record class"] !== "Test" && fields["Record class"] !== "Production") {
    problems.push(`"Record class" must be Test or Production`);
  }
  for (const key of ["Checks passed", "Checks total"] as const) {
    const value = fields[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      problems.push(`"${key}" must be a non-negative number`);
    }
  }
  for (const key of ["Proposal IDs", "Blocked actions"] as const) {
    if (!Array.isArray(fields[key])) problems.push(`"${key}" must be an array`);
  }
  for (const key of ["Mutated household state", "Appended events", "Dispatched"] as const) {
    if (fields[key] !== false) problems.push(`"${key}" must be false — boundary invariant`);
  }
  if (fields["Requires human approval"] !== true) {
    problems.push(`"Requires human approval" must be true — approval boundary`);
  }
  return problems;
}

/**
 * Control-plane store over the connector gateway. Exposes exactly three
 * operations; there is no generic write method to misuse.
 */
export function createAirtableControlPlaneStore(
  options: ControlPlaneStoreOptions,
): SchedulerPersistence & { provenance: string } {
  const { config, fetchImpl } = options;
  const gateway = config.gatewayUrl ?? AIRTABLE_GATEWAY_URL;
  const url = (table: string, query?: URLSearchParams): string =>
    `${gateway}/v0/${encodeURIComponent(config.baseId)}/${encodeURIComponent(table)}${
      query ? `?${query.toString()}` : ""
    }`;
  const headers = {
    Authorization: `Bearer ${config.lovableApiKey}`,
    "X-Connection-Api-Key": config.connectionKey,
    Accept: "application/json",
  };

  async function list(table: string, formula: string): Promise<ListResponse> {
    const params = new URLSearchParams();
    params.set("filterByFormula", formula);
    params.set("pageSize", "100");
    const response = await fetchImpl(url(table, params), { method: "GET", headers });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Airtable control-plane read failed [${response.status}]: ${body}`);
    }
    const payload = (await response.json()) as ListResponse;
    if (!payload || !Array.isArray(payload.records)) {
      throw new Error("Airtable control-plane read returned no `records` array; refusing to guess.");
    }
    return payload;
  }

  async function create(table: string, fields: Record<string, unknown>): Promise<void> {
    assertWritableControlPlaneTable(table);
    const response = await fetchImpl(url(table), {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields }], typecast: false }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Airtable control-plane write failed [${response.status}]: ${body}`);
    }
  }

  return {
    provenance: `airtable control plane ${config.baseId}: claims=${config.claimsTable}, runs=${config.agentRunTable}`,

    async listActiveClaims(directiveId, asOf) {
      try {
        const payload = await list(
          config.claimsTable,
          `{Directive ID} = '${escapeFormulaValue(directiveId)}'`,
        );
        const at = Date.parse(asOf);
        if (Number.isNaN(at)) {
          return { status: "FAILED", detail: `Invalid scheduler evaluation timestamp: ${asOf}` };
        }
        const claims: DirectiveClaim[] = [];
        for (const record of payload.records ?? []) {
          if (!record.fields || typeof record.fields !== "object" || Array.isArray(record.fields)) {
            throw new Error("Malformed SCHEDULER CLAIMS row: fields must be an object.");
          }
          const claim = toClaim(record.fields as Record<string, unknown>);
          if (!claim) {
            throw new Error("Malformed SCHEDULER CLAIMS row: required claim fields or timestamps are invalid.");
          }
          const expires = Date.parse(claim.expiresAt);
          if (expires > at) claims.push(claim);
        }
        return { status: "OK", claims };
      } catch (error) {
        return { status: "FAILED", detail: (error as Error).message };
      }
    },

    async persistClaim(claim): Promise<ClaimPersistResult> {
      const problems = validateClaimPayload(claim);
      if (problems.length > 0) {
        return {
          status: "FAILED",
          detail: `Refusing to persist malformed scheduler claim (no request issued): ${problems.join("; ")}`,
        };
      }
      const fresh = await this.listActiveClaims(claim.directiveId, claim.claimedAt);
      if (fresh.status === "FAILED") return { status: "FAILED", detail: fresh.detail };
      const conflicting = fresh.claims.find((c) => c.cycleId !== claim.cycleId);
      if (conflicting) {
        return {
          status: "COLLISION",
          detail: `Directive ${claim.directiveId} is leased by cycle ${conflicting.cycleId} until ${conflicting.expiresAt}; the claim was not stolen.`,
          holder: conflicting,
        };
      }
      const own = fresh.claims.find((c) => c.claimId === claim.claimId);
      if (own) return { status: "ALREADY_HELD", claim: own };
      try {
        await create(config.claimsTable, {
          "Claim ID": claim.claimId,
          "Directive ID": claim.directiveId,
          "Cycle ID": claim.cycleId,
          "Claimed at": claim.claimedAt,
          "Expires at": claim.expiresAt,
          "Record class": "Test",
        });
        return { status: "PERSISTED", claim };
      } catch (error) {
        return { status: "FAILED", detail: (error as Error).message };
      }
    },

    async appendAgentRun(record: AgentRunRecord): Promise<AgentRunPersistResult> {
      const runId =
        record && typeof record === "object" && typeof record[AGENT_RUN_KEY_FIELD] === "string"
          ? record[AGENT_RUN_KEY_FIELD]
          : "";
      const problems = validateAgentRunPayload(record);
      if (problems.length > 0) {
        return {
          status: "FAILED",
          runId,
          detail: `Refusing to persist malformed AGENT RUNS row (no request issued): ${problems.join("; ")}`,
        };
      }
      try {
        const existing = await list(
          config.agentRunTable,
          `{${AGENT_RUN_KEY_FIELD}} = '${escapeFormulaValue(runId)}'`,
        );
        if ((existing.records ?? []).length > 0) {
          return { status: "DEDUPLICATED", runId };
        }
      } catch (error) {
        return { status: "FAILED", runId, detail: (error as Error).message };
      }
      try {
        await create(config.agentRunTable, { ...record });
        return { status: "PERSISTED", runId };
      } catch (error) {
        return { status: "FAILED", runId, detail: (error as Error).message };
      }
    },

    async listActiveClaimsForCycle(cycleId, asOf) {
      try {
        const payload = await list(
          config.claimsTable,
          `{Cycle ID} = '${escapeFormulaValue(cycleId)}'`,
        );
        const at = Date.parse(asOf);
        if (Number.isNaN(at)) {
          return { status: "FAILED", detail: `Invalid scheduler evaluation timestamp: ${asOf}` };
        }
        const claims: DirectiveClaim[] = [];
        for (const record of payload.records ?? []) {
          if (!record.fields || typeof record.fields !== "object" || Array.isArray(record.fields)) {
            throw new Error("Malformed SCHEDULER CLAIMS row: fields must be an object.");
          }
          const claim = toClaim(record.fields as Record<string, unknown>);
          if (!claim) {
            throw new Error("Malformed SCHEDULER CLAIMS row: required claim fields or timestamps are invalid.");
          }
          const expires = Date.parse(claim.expiresAt);
          if (expires > at) claims.push(claim);
        }
        return { status: "OK", claims };
      } catch (error) {
        return { status: "FAILED", detail: (error as Error).message };
      }
    },
  };
}
