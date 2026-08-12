import { useMemo, useState } from "react";
import { CheckCircle2, Play, Utensils } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  consumptionAsOf,
  consumptionFixture,
  runConsumptionCycle,
  type ConsumptionPlan,
  type MealState,
} from "@/lib/consumption";

const NOW = () => "1970-01-01T00:00:00.000Z";

const decisionTone: Record<string, string> = {
  MEAL_ASSUMED_CONSUMED: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700",
  ALLOCATION_BURNED: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700",
  PLANNED_LEFTOVER_RETURNED: "border-sky-600/40 bg-sky-500/10 text-sky-700",
  UNPLANNED_CONSUMPTION_APPLIED: "border-amber-600/40 bg-amber-500/10 text-amber-700",
  MEAL_OVERRIDDEN_BY_EXCEPTION: "border-amber-600/40 bg-amber-500/10 text-amber-700",
  ITEM_UNCERTAIN_ISOLATED: "border-destructive/40 bg-destructive/10 text-destructive",
};

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12px] tracking-tight">{children}</span>;
}

export function ConsumptionPanel() {
  const [mealStates, setMealStates] = useState<Record<string, MealState>>(() =>
    Object.fromEntries((consumptionFixture.meals ?? []).map((m) => [m.mealId, m.state])),
  );
  const [duplicate, setDuplicate] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [runs, setRuns] = useState(0);

  const plan: ConsumptionPlan = useMemo(() => {
    const meals = (consumptionFixture.meals ?? []).map((m) => ({
      ...m,
      state: mealStates[m.mealId] ?? m.state,
    }));
    const withDuplicate = duplicate && meals[0] ? [...meals, { ...meals[0] }] : meals;
    return {
      ...consumptionFixture,
      meals: withDuplicate,
      exceptions: [
        ...(consumptionFixture.exceptions ?? []),
        ...(uncertain
          ? [
              {
                exceptionId: "EXC-7002",
                type: "UNCERTAIN_QUANTITY" as const,
                itemKey: "oats-rolled",
                occurredAt: "2026-08-03T12:00:00.000Z",
                note: "synthetic uncertainty",
              },
            ]
          : []),
      ],
    };
  }, [mealStates, duplicate, uncertain]);

  const cycle = useMemo(
    () => runConsumptionCycle(plan, { asOf: consumptionAsOf, now: NOW }),
    [plan],
  );

  const cycleMeals = plan.meals ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
          Planned meals · as of {consumptionAsOf.slice(0, 10)}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          projections: {runs}
        </span>
      </div>

      <div className="space-y-2">
        {(consumptionFixture.meals ?? []).map((m) => (
          <div
            key={m.mealId}
            className="flex flex-wrap items-center gap-2 rounded-sm border border-border/80 bg-background px-2 py-1.5"
          >
            <Mono>{m.mealId}</Mono>
            <span className="font-mono text-[11px] text-muted-foreground">
              {m.plannedFor.slice(0, 16).replace("T", " ")} ·{" "}
              {m.components.map((c) => `${c.itemKey} ${c.quantity}${c.unit}`).join(", ")}
            </span>
            <div className="ml-auto flex gap-1">
              {(["COMPLETED", "DUE", "SKIPPED", "CHANGED", "PLANNED"] as MealState[]).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={(mealStates[m.mealId] ?? m.state) === s ? "default" : "outline"}
                  className="h-6 px-2 font-mono text-[10px]"
                  onClick={() => {
                    setMealStates((prev) => ({ ...prev, [m.mealId]: s }));
                    setRuns((n) => n + 1);
                  }}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={duplicate ? "default" : "secondary"}
          className="h-7 gap-1.5 font-mono text-[11px]"
          onClick={() => {
            setDuplicate((v) => !v);
            setRuns((n) => n + 1);
          }}
        >
          <Play className="h-3.5 w-3.5" /> Duplicate completion
        </Button>
        <Button
          size="sm"
          variant={uncertain ? "default" : "secondary"}
          className="h-7 gap-1.5 font-mono text-[11px]"
          onClick={() => {
            setUncertain((v) => !v);
            setRuns((n) => n + 1);
          }}
        >
          <Utensils className="h-3.5 w-3.5" /> Uncertain oats quantity
        </Button>
        <Badge variant="outline" className="font-mono text-[10px]">
          allocation: 1 ice cream × 2 people / day
        </Badge>
      </div>

      <Separator />

      <div className="overflow-x-auto">
        <Table className="text-[12px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8">Item</TableHead>
              <TableHead className="h-8 text-right">On hand after burn-down</TableHead>
              <TableHead className="h-8">Last event</TableHead>
              <TableHead className="h-8">Provenance</TableHead>
              <TableHead className="h-8">Downstream</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cycle.snapshot.items.map((i) => {
              const isolated = cycle.handoff.blockedItemKeys.includes(i.itemKey);
              return (
                <TableRow key={i.itemKey}>
                  <TableCell className="py-1.5 font-mono">{i.itemKey}</TableCell>
                  <TableCell className="py-1.5 text-right font-mono">
                    {i.quantity} {i.unit ?? ""}
                  </TableCell>
                  <TableCell className="py-1.5 font-mono text-[11px] text-muted-foreground">
                    {i.lastAppliedEventId ?? "—"}
                  </TableCell>
                  <TableCell className="py-1.5 font-mono text-[11px] text-muted-foreground">
                    {i.contributingEventIds.join(", ")}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <span
                      className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${
                        isolated
                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : "border-emerald-600/40 bg-emerald-500/10 text-emerald-700"
                      }`}
                    >
                      {isolated ? "ISOLATED" : "PLANNING"}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-2 text-[11.5px] sm:grid-cols-2">
        <div className="rounded-sm border border-border/80 bg-background px-2 py-1.5">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            Replay identity
          </p>
          <p className="mt-1 break-all font-mono text-[11px]">
            snapshot {cycle.snapshot.snapshotId}
          </p>
          <p className="break-all font-mono text-[11px]">replay {cycle.snapshot.replayId}</p>
          <p className="font-mono text-[11px]">
            status {cycle.snapshot.reconciliationStatus} · handoff items{" "}
            {cycle.handoff.items.length} · isolated {cycle.handoff.blockedItemKeys.length}
          </p>
        </div>
        <div className="rounded-sm border border-border/80 bg-background px-2 py-1.5">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            Engine reconciliation
          </p>
          {cycle.snapshot.exceptions.length ? (
            <ul className="mt-1 space-y-1">
              {cycle.snapshot.exceptions.map((x, idx) => (
                <li key={`${x.code}-${idx}`} className="font-mono text-[11px]">
                  {x.code} · {x.eventId}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> CLEAN — no duplicate or conflicting events
            </p>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
          Consumption decisions ({cycle.projection.decisions.length})
        </p>
        <ul className="space-y-1">
          {cycle.projection.decisions.map((d, idx) => (
            <li
              key={`${d.code}-${d.sourceId}-${d.itemKey ?? ""}-${idx}`}
              className="flex flex-wrap items-center gap-2 rounded-sm border border-border/80 bg-background px-2 py-1"
            >
              <span
                className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                  decisionTone[d.code] ?? "border-border bg-muted text-muted-foreground"
                }`}
              >
                {d.code}
              </span>
              <Mono>{d.sourceId}</Mono>
              <span className="font-mono text-[11px] text-muted-foreground">
                {d.itemKey ?? "—"}
              </span>
              <span className="w-full text-[11.5px] text-muted-foreground">{d.detail}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[11.5px] text-muted-foreground">
        Meals only burn in <Mono>COMPLETED</Mono> or past-due <Mono>DUE</Mono> state; skipped and
        changed meals never decrement. Leftovers appear only when explicitly planned. Durable
        cupboard stock (<Mono>rice-basmati</Mono>) is untouched without a demand event. Synthetic
        fixtures only — not connected to Airtable or real household state.
      </p>

      {cycleMeals.length === 0 ? null : null}
    </div>
  );
}
