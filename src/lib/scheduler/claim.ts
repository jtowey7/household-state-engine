/**
 * Food OS — directive claim / lease.
 *
 * A stateless wake-up must not assume it is the only wake-up. Two overlapping
 * scheduler deliveries reading the same control-plane snapshot would otherwise
 * both select the same highest-value directive and both do the work.
 *
 * Claiming is control-plane state, not process memory: the caller passes the
 * currently recorded claims in, and persists the granted claim back out.
 * Claims expire, so a crashed wake-up cannot wedge a directive forever.
 */

import { hashOf } from "../state-engine/hash";
import type { ClaimVerdict, DirectiveClaim } from "./types";

export const DEFAULT_LEASE_MS = 15 * 60 * 1000;

function claimIdFor(directiveId: string, cycleId: string): string {
  return `CLAIM-${hashOf({ directiveId, cycleId }).slice(0, 16)}`;
}

export interface ClaimOptions {
  directiveId: string;
  cycleId: string;
  wakeAt: string;
  leaseMs?: number;
  activeClaims?: readonly DirectiveClaim[];
}

/** Deterministically grant or refuse a lease on one directive. */
export function claimDirective(options: ClaimOptions): ClaimVerdict {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const wake = Date.parse(options.wakeAt);
  if (Number.isNaN(wake)) {
    return {
      granted: false,
      refusal: { code: "INVALID_WAKE_TIME", detail: `Unparseable wake timestamp ${options.wakeAt}.` },
    };
  }

  for (const existing of options.activeClaims ?? []) {
    if (existing.directiveId !== options.directiveId) continue;
    const expires = Date.parse(existing.expiresAt);
    const expired = Number.isNaN(expires) || expires <= wake;
    if (expired) continue;
    if (existing.cycleId === options.cycleId) {
      // Re-entrant: the same wake-up re-reading its own live lease.
      return { granted: true, claim: existing, reclaimedExpired: false };
    }
    return {
      granted: false,
      refusal: {
        code: "CLAIMED_BY_ANOTHER_CYCLE",
        detail: `Directive ${options.directiveId} is leased by cycle ${existing.cycleId} until ${existing.expiresAt}.`,
      },
    };
  }

  const reclaimedExpired = (options.activeClaims ?? []).some(
    (c) => c.directiveId === options.directiveId,
  );

  return {
    granted: true,
    reclaimedExpired,
    claim: {
      claimId: claimIdFor(options.directiveId, options.cycleId),
      directiveId: options.directiveId,
      cycleId: options.cycleId,
      claimedAt: new Date(wake).toISOString(),
      expiresAt: new Date(wake + leaseMs).toISOString(),
    },
  };
}

/** Drop claims that have expired as of `asOf`; used when persisting state back. */
export function pruneClaims(
  claims: readonly DirectiveClaim[],
  asOf: string,
): DirectiveClaim[] {
  const at = Date.parse(asOf);
  return claims.filter((c) => {
    const expires = Date.parse(c.expiresAt);
    return !Number.isNaN(expires) && expires > at;
  });
}
