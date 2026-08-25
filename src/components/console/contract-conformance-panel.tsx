import { useMemo } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { runContractConformance } from "@/lib/state-engine/contract-conformance";

/**
 * Read-only QA surface: live in-browser execution of the real replay engine
 * against fixed local synthetic fixtures. No production data, no network.
 */
export function ContractConformancePanel() {
  const report = useMemo(() => runContractConformance(), []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={
            report.allPassed
              ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-700"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }
        >
          {report.passed}/{report.checks.length} contract clauses passing
        </Badge>
        <span className="text-[11.5px] text-muted-foreground">
          Executes <span className="font-mono text-[11px]">replayEvents</span> on fixed local
          fixtures. Synthetic only — no household or external data is read.
        </span>
      </div>

      <ul className="space-y-1.5">
        {report.checks.map((check) => (
          <li
            key={check.id}
            className="rounded-sm border border-border/80 bg-background px-2 py-1.5 text-[11.5px]"
          >
            <div className="flex flex-wrap items-center gap-2">
              {check.passed ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <span className="font-mono text-[11px]">{check.id}</span>
              <span className="min-w-0">{check.clause}</span>
              <span
                className={`ml-auto font-mono text-[10px] ${check.passed ? "text-emerald-700" : "text-destructive"}`}
              >
                {check.passed ? "PASS" : "FAIL"}
              </span>
            </div>
            <p className="mt-1 break-words font-mono text-[10.5px] leading-relaxed text-muted-foreground">
              {check.detail}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
