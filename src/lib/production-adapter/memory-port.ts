import type { HouseholdEvent } from "../state-engine/types";
import type { DemandTarget } from "../quantity-adapter/types";
import type {
  ProductionReadResult,
  ProductionStatePort,
  SourceMode,
  SourceScope,
} from "./types";

export interface MemoryPortConfig {
  portId?: string;
  mode?: SourceMode;
  provenance?: string;
  openingEvents: HouseholdEvent[];
  targets: DemandTarget[];
  /** Simulates an unavailable connector, for failure-handling tests. */
  failWith?: string;
  /** Lets tests assert the guard on a lying source. */
  claimedMode?: SourceMode;
}

/**
 * Local, in-memory implementation of the read-only port. This is the fallback
 * used while no production connector is wired: it satisfies the same contract,
 * so swapping in a real source is a constructor change only.
 */
export function createMemoryProductionPort(config: MemoryPortConfig): ProductionStatePort {
  const mode = config.mode ?? "SYNTHETIC";
  return {
    portId: config.portId ?? "memory-port",
    mode,
    async read(_scope: SourceScope): Promise<ProductionReadResult> {
      if (config.failWith) throw new Error(config.failWith);
      return {
        openingEvents: config.openingEvents,
        targets: config.targets,
        provenance: config.provenance ?? "synthetic fixture",
        claimedMode: config.claimedMode ?? mode,
      };
    },
  };
}
