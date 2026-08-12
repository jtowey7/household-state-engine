import { useMemo } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { labCases, labNow, labTargets, runLabSuite } from "@/lib/test-lab";

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12px] tracking-tight">{children}</span>;
}

export function IntegrationLabPanel() {
  const suite = useMemo(
    () => runLabSuite(labCases, { targets: labTargets, now: labNow }),
    [],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={
            suite.failed === 0
              ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-700"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }
        >
          {suite.passed}/{suite.results.length} integration cases passing
        </Badge>
        <span className="text-[11.5px] text-muted-foreground">
          Live in-browser execution of <Mono>replayEvents → toQuantityRequirementsHandoff →
          adaptSnapshotToQuantityRun</Mono> on synthetic fixtures. Shadow runs only —
          <Mono> dispatched: false</Mono>.
        </span>
      </div>

      <ul className="space-y-2">
        {suite.results.map((r) => (
          <li key={r.caseId} className="rounded-sm border border-border/80 bg-background px-2 py-2">
            <div className="flex flex-wrap items-center gap-2">
              {r.passed ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-destructive" />
              )}
              <Mono>{r.caseId}</Mono>
              <span className="text-[12px]">{r.title}</span>
              <span className="ml-auto flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                <span className="rounded-sm border border-border px-1.5 py-0.5">
                  {r.reconciliationStatus}
                </span>
                <span className="rounded-sm border border-border px-1.5 py-0.5">
                  {r.eligibleForProcurement ? "eligible" : "refused"}
                </span>
                <span className="rounded-sm border border-border px-1.5 py-0.5">
                  dispatched: false
                </span>
              </span>
            </div>
            <ul className="mt-1.5 space-y-0.5 pl-5">
              {r.checks.map((c) => (
                <li
                  key={c.label}
                  className="flex flex-wrap gap-2 font-mono text-[11px] text-muted-foreground"
                >
                  <span className={c.passed ? "text-emerald-700" : "text-destructive"}>
                    {c.passed ? "PASS" : "FAIL"}
                  </span>
                  <span>{c.label}</span>
                  <span className="text-muted-foreground/70">{c.detail}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 pl-5 font-mono text-[10.5px] text-muted-foreground/80">
              snapshot {r.snapshotId.slice(0, 16)}… · replay {r.replayId.slice(0, 16)}… · items{" "}
              {r.requirementItems.join(", ") || "—"} · rejections{" "}
              {r.rejectionCodes.join(", ") || "none"} · source events{" "}
              {r.sourceEventIds.join(", ") || "—"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
