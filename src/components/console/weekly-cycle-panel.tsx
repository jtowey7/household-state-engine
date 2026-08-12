import { useEffect, useState } from "react";
import { CheckCircle2, CircleSlash, Loader2, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  runWeeklyShadowCycle,
  weeklyAsOf,
  weeklyNow,
  weeklyPlan,
  weeklyPort,
  weeklyScope,
} from "@/lib/weekly-cycle";
import type { StageStatus, WeeklyCycleRun } from "@/lib/weekly-cycle";
import { createMemoryProductionPort, productionPortContract } from "@/lib/production-adapter";
import type { ContractResult } from "@/lib/production-adapter/contract";
import { shadowTargets } from "@/lib/quantity-adapter";
import { consumptionFixture } from "@/lib/consumption/fixtures";
import { FeedbackGateCard } from "@/components/console/feedback-gate-card";
import { durableReports, safetyReport } from "@/lib/feedback/classifier-fixtures";

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12px] tracking-tight">{children}</span>;
}

const STAGE_TONE: Record<StageStatus, string> = {
  OK: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700",
  WARNED: "border-amber-600/40 bg-amber-500/10 text-amber-700",
  REFUSED: "border-destructive/40 bg-destructive/10 text-destructive",
  FAILED: "border-destructive/40 bg-destructive/10 text-destructive",
  SKIPPED: "border-border bg-muted text-muted-foreground",
};

type Scenario = "healthy" | "offline" | "uncertain" | "preference" | "constraint";

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "healthy", label: "Nominal week" },
  { id: "offline", label: "Source unavailable" },
  { id: "uncertain", label: "Uncertain item" },
  { id: "preference", label: "Durable preference" },
  { id: "constraint", label: "Safety constraint" },
];

function optionsFor(scenario: Scenario) {
  const base = { port: weeklyPort, scope: weeklyScope, plan: weeklyPlan, asOf: weeklyAsOf, now: weeklyNow };
  if (scenario === "offline") {
    return {
      ...base,
      port: createMemoryProductionPort({
        portId: "memory-port:offline",
        openingEvents: consumptionFixture.openingEvents ?? [],
        targets: shadowTargets,
        failWith: "connector offline (simulated)",
      }),
    };
  }
  if (scenario === "preference") {
    return {
      ...base,
      feedbackReports: durableReports,
      feedbackSubjectItemKeys: { "leaf-salad": ["leaf-salad"] },
    };
  }
  if (scenario === "constraint") {
    return {
      ...base,
      feedbackReports: [safetyReport],
      feedbackSubjectItemKeys: { shellfish: ["shellfish"] },
    };
  }
  if (scenario === "uncertain") {
    return {
      ...base,
      plan: {
        ...weeklyPlan,
        exceptions: [
          ...(weeklyPlan.exceptions ?? []),
          {
            exceptionId: "EXC-UNCERTAIN",
            type: "UNCERTAIN_QUANTITY" as const,
            itemKey: "oats-rolled",
            occurredAt: "2026-08-03T10:00:00.000Z",
          },
        ],
      },
    };
  }
  return base;
}


export function WeeklyCyclePanel() {
  const [scenario, setScenario] = useState<Scenario>("healthy");
  const [run, setRun] = useState<WeeklyCycleRun | null>(null);
  const [contract, setContract] = useState<ContractResult | null>(null);

  useEffect(() => {
    let alive = true;
    setRun(null);
    void runWeeklyShadowCycle(optionsFor(scenario)).then((r) => alive && setRun(r));
    void productionPortContract(weeklyPort, weeklyScope).then((c) => alive && setContract(c));
    return () => {
      alive = false;
    };
  }, [scenario]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScenario(s.id)}
            className={`rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors ${
              scenario === s.id
                ? "border-foreground/40 bg-foreground/5 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          shadow only · mutatedHouseholdState: false · dispatched: false
        </span>
      </div>

      {contract ? (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border/80 bg-background px-2 py-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-[12px]">Read-only production port contract</span>
          <Mono>{contract.portId}</Mono>
          <Badge
            variant="outline"
            className={
              contract.passed
                ? "ml-auto border-emerald-600/40 bg-emerald-500/10 text-emerald-700"
                : "ml-auto border-destructive/40 bg-destructive/10 text-destructive"
            }
          >
            {contract.checks.filter((c) => c.passed).length}/{contract.checks.length} checks
          </Badge>
        </div>
      ) : null}

      {!run ? (
        <div className="flex items-center gap-2 px-1 py-3 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> running cycle…
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={STAGE_TONE[run.status === "COMPLETED" ? "OK" : "REFUSED"]}>
              cycle {run.status}
            </Badge>
            <Mono>cycleId {run.cycleId}</Mono>
            {run.plan ? <Mono>planId {run.plan.planId}</Mono> : null}
          </div>

          <ol className="space-y-1.5">
            {run.stages.map((stage) => (
              <li key={stage.stage} className="rounded-sm border border-border/80 bg-background px-2 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  {stage.status === "OK" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  ) : stage.status === "WARNED" ? (
                    <TriangleAlert className="h-3.5 w-3.5 text-amber-600" />
                  ) : stage.status === "SKIPPED" ? (
                    <CircleSlash className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                  )}
                  <Mono>{stage.stage}</Mono>
                  <Badge variant="outline" className={`${STAGE_TONE[stage.status]} text-[10px]`}>
                    {stage.status}
                  </Badge>
                  <span className="w-full text-[11.5px] text-muted-foreground">{stage.detail}</span>
                </div>
                {Object.keys(stage.metrics).length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1.5 pl-5">
                    {Object.entries(stage.metrics).map(([k, v]) => (
                      <span
                        key={k}
                        className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {k}: {String(v)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {stage.warnings.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 pl-5">
                    {stage.warnings.map((w) => (
                      <li key={w} className="font-mono text-[10.5px] text-amber-700">
                        ⚠ {w}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="rounded-sm border border-border/80 bg-muted/40 px-2 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                Human approval gate
              </span>
              <Badge variant="outline" className={STAGE_TONE[run.approval.readyForReview ? "OK" : "REFUSED"]}>
                {run.approval.readyForReview ? "ready for review" : "not reviewable"}
              </Badge>
              <Mono>required: true · granted: false</Mono>
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground">{run.approval.reason}</p>
            {run.isolatedItemKeys.length > 0 ? (
              <p className="mt-1 font-mono text-[10.5px] text-amber-700">
                isolated items: {run.isolatedItemKeys.join(", ")} — unrelated planning continued
              </p>
            ) : null}
          </div>

          {run.plan && run.plan.requirements.length > 0 ? (
            <ul className="space-y-1">
              {run.plan.requirements.map((r) => (
                <li
                  key={r.itemKey}
                  className="flex flex-wrap items-center gap-2 rounded-sm border border-border/80 bg-background px-2 py-1.5 font-mono text-[11px]"
                >
                  <span className="min-w-40">{r.itemKey}</span>
                  <span className="text-muted-foreground">
                    on-hand {r.onHandQuantity}
                    {r.unit} → target {r.targetQuantity}
                    {r.unit}
                  </span>
                  <span>
                    need {r.requiredQuantity}
                    {r.unit}
                  </span>
                  {r.packRoundedQuantity !== null ? (
                    <span className="text-muted-foreground">
                      packs {r.packCount} × {r.packSize}
                      {r.unit} = {r.packRoundedQuantity}
                      {r.unit}
                    </span>
                  ) : null}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    src {r.sourceEventIds.join(", ") || "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {run.basket ? (
            <div className="rounded-sm border border-border/80 bg-background px-2 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Candidate basket
                </span>
                <Badge variant="outline" className={STAGE_TONE[run.basket.readyForReview ? "OK" : "REFUSED"]}>
                  {run.basket.lines.length} lines
                </Badge>
                <Mono>basketId {run.basket.basketId}</Mono>
                <Mono>total {run.basket.totalCost.toFixed(2)}</Mono>
                <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  dispatched: false · requiresHumanApproval: true
                </span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {run.basket.lines.map((l) => (
                  <li
                    key={l.itemKey}
                    className="flex flex-wrap items-center gap-2 rounded-sm border border-border/60 px-2 py-1 font-mono text-[11px]"
                  >
                    <span className="min-w-40">{l.itemKey}</span>
                    <span className="text-muted-foreground">{l.productName}</span>
                    <span>
                      {l.packCount} × {l.packSize}
                      {l.packUnit} = {l.orderedQuantity}
                      {l.unit}
                    </span>
                    <span className="text-muted-foreground">{l.sku}</span>
                    <span className="ml-auto">{l.lineCost.toFixed(2)}</span>
                    <span className="w-full text-[10px] text-muted-foreground">
                      src {l.sourceEventIds.join(", ") || "—"}
                    </span>
                  </li>
                ))}
              </ul>
              {run.basket.exceptions.length > 0 ? (
                <ul className="mt-1 space-y-0.5">
                  {run.basket.exceptions.map((e) => (
                    <li key={`${e.code}-${e.itemKey}`} className="font-mono text-[10.5px] text-amber-700">
                      ⚠ {e.code}: {e.detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
