import { useMemo } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  runSafetyBoundaryProof,
  safetyProofNow,
  safetyProofRows,
  safetyProofTargets,
} from "@/lib/safety-proof";

/**
 * Operator-facing, read-only proof of the
 * adapter → replay → QUANTITY REQUIREMENTS safety boundary.
 * Synthetic fixtures only; nothing here reads or writes production state.
 */
export function SafetyBoundaryPanel() {
  const run = useMemo(
    () =>
      runSafetyBoundaryProof({
        rows: safetyProofRows,
        targets: safetyProofTargets,
        now: safetyProofNow,
        qualifiedItemKey: "milk-whole",
        exactItemKey: "oats-rolled",
        testEventId: "PROOF-EVT-TEST-1",
      }),
    [],
  );

  return (
    <Card className="gap-0 rounded-md border-border/80 py-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border/80 bg-muted/40 px-3 py-2">
        <CardTitle className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Safety boundary proof · adapter → replay → quantity
        </CardTitle>
        <Badge variant="outline" className="font-mono text-[10px]">
          SYNTHETIC · READ-ONLY
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 p-3">
        <ul className="space-y-1.5">
          {run.checks.map((check) => (
            <li
              key={check.id}
              className="rounded-sm border border-border/80 bg-background px-2 py-1.5 text-[11.5px]"
            >
              <div className="flex flex-wrap items-center gap-2">
                {check.passed ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                )}
                <span className="font-mono text-[11px]">{check.id}</span>
                <span className="text-muted-foreground">{check.label}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{check.detail}</p>
            </li>
          ))}
        </ul>

        <dl className="grid gap-1.5 text-[11.5px] sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">replayId</dt>
            <dd className="break-all font-mono">{run.plan.replayId}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">snapshotId</dt>
            <dd className="break-all font-mono">{run.plan.snapshotId}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">requirements</dt>
            <dd className="font-mono">
              {run.plan.requirements
                .map((r) => `${r.itemKey} +${r.requiredQuantity}${r.unit}`)
                .join(" · ") || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">isolated items</dt>
            <dd className="font-mono">
              {run.plan.rejections
                .filter((r) => r.code === "ITEM_ISOLATED")
                .map((r) => r.itemKey)
                .join(", ") || "—"}
            </dd>
          </div>
        </dl>

        <p className="text-[11px] text-muted-foreground">
          Deterministic proof over synthetic HOUSEHOLD EVENTS rows. No Airtable read, no
          production write, no procurement dispatch.
        </p>
      </CardContent>
    </Card>
  );
}
