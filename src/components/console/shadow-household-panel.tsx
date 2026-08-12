import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  BANANAS,
  BUTTER,
  ICE_CREAM,
  SALMON,
  declaredEventRows,
  declaredPlan,
  exceptionOnlyPlan,
  salmonCorrectionRow,
  runShadowHouseholdCycle,
} from "@/lib/shadow-household";
import type { WeeklyCycleRun } from "@/lib/weekly-cycle";

type Representation = "meal" | "exception" | "correction";

const REPS: { id: Representation; label: string; note: string }[] = [
  { id: "meal", label: "A · completed planned meal", note: "Plan completion auto-generates expected consumption." },
  { id: "exception", label: "B · consumption exception", note: "Unplanned consumption reported as an exception event." },
  { id: "correction", label: "C · Airtable Correction row", note: "`Correction` with numeric `State after` of 0 g." },
];

function optionsFor(rep: Representation) {
  if (rep === "exception") return { plan: exceptionOnlyPlan };
  if (rep === "correction") {
    return { rows: [...declaredEventRows, salmonCorrectionRow], plan: { meals: [] } };
  }
  return {};
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12px] tracking-tight">{children}</span>;
}

const WATCHED = [SALMON, ICE_CREAM, BUTTER, BANANAS];

export function ShadowHouseholdPanel() {
  const [rep, setRep] = useState<Representation>("meal");
  const [run, setRun] = useState<WeeklyCycleRun | null>(null);

  useEffect(() => {
    let alive = true;
    setRun(null);
    void runShadowHouseholdCycle(optionsFor(rep)).then((r) => alive && setRun(r));
    return () => {
      alive = false;
    };
  }, [rep]);

  const active = REPS.find((r) => r.id === rep)!;

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        No Airtable connector exists for this project, so these rows are an{" "}
        <span className="text-foreground">operator-declared restatement</span> shaped in the exact
        HOUSEHOLD EVENTS field contract, run under a SYNTHETIC scope. Output is isolated: no
        household record is written and no order is dispatched.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {REPS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRep(r.id)}
            className={`rounded-sm border px-2 py-1 font-mono text-[11px] transition-colors ${
              rep === r.id
                ? "border-foreground/40 bg-foreground/5 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="font-mono text-[11px] text-muted-foreground">{active.note}</p>

      {!run ? (
        <div className="flex items-center gap-2 px-1 py-3 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> running shadow cycle…
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-border">
              scope {run.scope.mode}
            </Badge>
            <Mono>cycleId {run.cycleId}</Mono>
            {run.snapshot ? <Mono>snapshotId {run.snapshot.snapshotId}</Mono> : null}
          </div>

          <div className="overflow-hidden rounded-sm border border-border">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-muted/60 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Item</th>
                  <th className="px-2 py-1.5">Shadow state</th>
                  <th className="px-2 py-1.5">Contributing event IDs</th>
                </tr>
              </thead>
              <tbody>
                {WATCHED.map((key) => {
                  const item = run.snapshot?.items.find((i) => i.itemKey === key);
                  const isolated = run.isolatedItemKeys.includes(key);
                  return (
                    <tr key={key} className="border-t border-border/70 align-top">
                      <td className="px-2 py-1.5">{key}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {item ? `${item.quantity} ${item.unit ?? ""}` : "—"}
                        {isolated ? (
                          <Badge
                            variant="outline"
                            className="ml-2 border-amber-600/40 bg-amber-500/10 text-amber-700"
                          >
                            isolated
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                        {item?.contributingEventIds.join(" · ") ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-sm border border-border/80 bg-background px-2 py-1.5 text-[12px]">
            Tuesday salmon shadow state:{" "}
            <span className="font-mono">
              {run.snapshot?.items.find((i) => i.itemKey === SALMON)?.quantity ?? "—"} g
            </span>{" "}
            — derived from events only; production INVENTORY is untouched.
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            <span>mutatedHouseholdState: {String(run.mutatedHouseholdState)}</span>
            <span>· dispatched: {String(run.dispatched)}</span>
            <span>· approval granted: {String(run.approval.granted)}</span>
            <span>· declared meals: {declaredPlan.meals?.length ?? 0}</span>
          </div>
        </>
      )}
    </div>
  );
}
