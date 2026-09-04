import type {
  ControlPlaneDirective,
  ControlPlaneSnapshot,
  DirectiveKind,
  DirectivePriority,
  DirectiveStatus,
  ActionPolicy,
} from "./types";

export const AIRTABLE_QUEUE_SNAPSHOT_GATEWAY =
  "https://connector-gateway.lovable.dev/airtable";

export interface AirtableQueueSnapshotConfig {
  lovableApiKey: string;
  connectionKey: string;
  baseId: string;
  queueTable: string;
  gatewayUrl?: string;
}

export interface AirtableQueueFetch {
  (
    input: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    },
  ): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
  }>;
}

export type AirtableQueueSnapshotResult =
  | {
      status: "OK";
      snapshot: ControlPlaneSnapshot;
      provenance: string;
    }
  | {
      status: "FAILED";
      detail: string;
    };

interface AirtableRecord {
  id?: unknown;
  fields?: unknown;
}

interface AirtableListResponse {
  records?: AirtableRecord[];
}

const DIRECTIVE_KINDS = new Set<DirectiveKind>([
  "WEEKLY_SHADOW_CYCLE",
  "STOCK_EXCEPTION_REVIEW",
  "MEAL_COMPLETION_SWEEP",
  "UNSUPPORTED",
]);

const PRIORITIES = new Set<DirectivePriority>(["P0", "P1", "P2"]);
const ACTION_POLICIES = new Set<ActionPolicy>(["PREPARE", "EXECUTE"]);

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function mapStatus(value: unknown): DirectiveStatus {
  const status = asNonEmptyString(value)?.toLowerCase();
  if (status === "ready") return "READY";
  if (status === "complete" || status === "completed") return "DONE";
  return "BLOCKED";
}

function mapPriority(value: unknown): DirectivePriority | null {
  const priority = asNonEmptyString(value)?.toUpperCase() as DirectivePriority | undefined;
  return priority && PRIORITIES.has(priority) ? priority : null;
}

function mapKind(value: unknown): DirectiveKind | null {
  const kind = asNonEmptyString(value) as DirectiveKind | null;
  return kind && DIRECTIVE_KINDS.has(kind) ? kind : null;
}

function mapActionPolicy(value: unknown): ActionPolicy | null {
  const policy = asNonEmptyString(value) as ActionPolicy | null;
  return policy && ACTION_POLICIES.has(policy) ? policy : null;
}

function mapDirective(record: AirtableRecord): ControlPlaneDirective | null {
  const id = asNonEmptyString(record.id);
  const fields =
    record.fields && typeof record.fields === "object"
      ? (record.fields as Record<string, unknown>)
      : null;
  if (!id || !fields) return null;

  const title = asNonEmptyString(fields.Task);
  const priority = mapPriority(fields.Priority);
  const rawKind = mapKind(fields["Directive kind"]);
  const rawPolicy = mapActionPolicy(fields["Action policy"]);
  const status = mapStatus(fields.Status);
  const blocker = asNonEmptyString(fields.Blocker);

  if (!title || !priority) return null;

  const metadataValid = rawKind !== null && rawPolicy !== null;
  const blockedReason =
    status === "BLOCKED"
      ? blocker ?? "Development queue row is not currently executable."
      : metadataValid
        ? undefined
        : "Missing or unsupported scheduler Directive kind / Action policy; refusing to guess.";

  return {
    directiveId: `AIRTABLE:${id}`,
    title,
    kind: rawKind ?? "UNSUPPORTED",
    priority,
    status: metadataValid ? status : "BLOCKED",
    actionPolicy: rawPolicy ?? "PREPARE",
    blockedReason,
    recordClass: "Production",
  };
}

/**
 * Read-only adapter from the canonical Airtable DEVELOPMENT QUEUE to the
 * scheduler's existing deterministic selection contract.
 *
 * `mode` remains SYNTHETIC because this adapter only supplies control-plane
 * directives to the existing non-production scheduler; it does not grant
 * Production household-write authority. The return `provenance` records that
 * the directives came from Airtable so the distinction is not lost.
 */
export async function readAirtableQueueSnapshot(
  config: AirtableQueueSnapshotConfig,
  fetchImpl: AirtableQueueFetch,
  readAt: string,
): Promise<AirtableQueueSnapshotResult> {
  if (Number.isNaN(Date.parse(readAt))) {
    return { status: "FAILED", detail: `Invalid readAt timestamp: ${readAt}` };
  }

  const gateway = config.gatewayUrl ?? AIRTABLE_QUEUE_SNAPSHOT_GATEWAY;
  const table = config.queueTable.trim();
  if (!config.baseId.trim() || !table) {
    return { status: "FAILED", detail: "Airtable baseId and queueTable are required." };
  }

  const url = `${gateway}/v0/${encodeURIComponent(config.baseId)}/${encodeURIComponent(table)}?pageSize=100`;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.lovableApiKey}`,
        "X-Connection-Api-Key": config.connectionKey,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      const body = await response.text();
      return {
        status: "FAILED",
        detail: `Airtable DEVELOPMENT QUEUE read failed [${response.status}]: ${body}`,
      };
    }

    const payload = (await response.json()) as AirtableListResponse;
    if (!Array.isArray(payload.records)) {
      return {
        status: "FAILED",
        detail: "Airtable DEVELOPMENT QUEUE response has no records array; refusing to guess.",
      };
    }

    const directives: ControlPlaneDirective[] = [];
    for (const record of payload.records) {
      const directive = mapDirective(record);
      if (directive) directives.push(directive);
    }

    const snapshotId = `AIRTABLE-QUEUE-${readAt}-${payload.records.length}`;
    return {
      status: "OK",
      snapshot: {
        mode: "SYNTHETIC",
        snapshotId,
        readAt,
        directives,
      },
      provenance: `Airtable DEVELOPMENT QUEUE read-only snapshot: base=${config.baseId}, table=${table}, records=${payload.records.length}`,
    };
  } catch (error) {
    return {
      status: "FAILED",
      detail: `Airtable DEVELOPMENT QUEUE read failed before completion: ${(error as Error).message}`,
    };
  }
}
