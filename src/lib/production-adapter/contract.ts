import { loadProductionState } from "./adapter";
import type { ProductionStatePort, SourceScope } from "./types";

export interface ContractCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface ContractResult {
  portId: string;
  checks: ContractCheck[];
  passed: boolean;
}

/**
 * Executable contract every ProductionStatePort must satisfy — the local memory
 * port today, a real connector-backed port later. Runnable from tests and from
 * the console, so "the adapter is safe" is always evidence, never a claim.
 */
export async function productionPortContract(
  port: ProductionStatePort,
  scope: SourceScope,
): Promise<ContractResult> {
  const checks: ContractCheck[] = [];
  const add = (label: string, passed: boolean, detail: string) =>
    checks.push({ label, passed, detail });

  const load = await loadProductionState(port, scope);

  add(
    "read-only: no write path exposed",
    load.writable === false && !("write" in port) && !("update" in port),
    "Port exposes read() only; LoadedProductionState.writable is false.",
  );

  add(
    "load succeeds for a matching scope",
    load.ok,
    load.ok ? `${load.openingEvents.length} events, ${load.targets.length} targets.` : load.rejections[0]?.detail ?? "",
  );

  const repeat = await loadProductionState(port, scope);
  add(
    "deterministic: identical read yields identical sourceId",
    repeat.sourceId === load.sourceId,
    `sourceId ${load.sourceId}`,
  );

  add(
    "immutable event IDs are unique after the guard",
    new Set(load.openingEvents.map((e) => e.eventId)).size === load.openingEvents.length,
    `${load.openingEvents.length} unique event IDs.`,
  );

  const mismatched = await loadProductionState(port, {
    ...scope,
    mode: scope.mode === "SYNTHETIC" ? "PRODUCTION_READ_ONLY" : "SYNTHETIC",
  });
  add(
    "mode mismatch is refused",
    !mismatched.ok && mismatched.rejections[0]?.code === "MODE_MISMATCH",
    mismatched.rejections[0]?.detail ?? "no rejection emitted",
  );

  add(
    "quarantine isolates items instead of failing the run",
    load.ok || load.quarantinedItemKeys.length === 0,
    load.quarantinedItemKeys.length > 0
      ? `quarantined: ${load.quarantinedItemKeys.join(", ")}`
      : "no quarantined items in this dataset.",
  );

  return { portId: port.portId, checks, passed: checks.every((c) => c.passed) };
}
