import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  createAppendOnlyWriteBoundary,
  plannedSalmonConsumption,
  runSalmonScenario,
  salmonCorrection,
  SALMON_ITEM,
} from "@/lib/write-boundary";
import type { AppendIntent, HouseholdEventRowDraft, SalmonScenarioResult } from "@/lib/write-boundary";

type Mode = "planned" | "duplicate" | "correction";

const MODES: { id: Mode; label: string; note: string }[] = [
  {
    id: "planned",
    label: "A · planned meal completion",
    note: "Tuesday meal marked complete → one Consumption event of −780 g.",
  },
  {
    id: "duplicate",
    label: "B · same event delivered 3×",
    note: "Duplicate delivery of an identical event is a no-op at the boundary.",
  },
  {
    id: "correction",
    label: "C · operator Correction",
    note: "`Correction` restating an absolute `State after` of 0 g.",
  },
];

function intentsFor(mode: Mode): AppendIntent[] {
  if (mode === "correction") return [salmonCorrection];
  if (mode === "duplicate") {
    return [plannedSalmonConsumption, plannedSalmonConsumption, plannedSalmonConsumption];
  }
  return [plannedSalmonConsumption];
}

function RowPreview({ row }: { row: HouseholdEventRowDraft }) {
  return (
    <div className="overflow-hidden rounded-md border border-border/60">
      <table className="w-full text-[11px]">
        <tbody>
          {Object.entries(row).map(([field, value]) => (
            <tr key={field} className="border-b border-border/40 last:border-0">
              <td className="w-[46%] bg-muted/40 px-2 py-1 font-mono text-muted-foreground">
                {field}
              </td>
              <td className="px-2 py-1 font-mono">
                {Array.isArray(value)
                  ? value.length === 0
                    ? "—"
                    : value.join(", ")
                  : value === null || value === ""
                    ? "—"
                    : String(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WriteBoundaryPanel() {
  const [mode, setMode] = useState<Mode>("planned");
  const [run, setRun] = useState<SalmonScenarioResult | null>(null);

  useEffect(() => {
    let alive = true;
    setRun(null);
    void runSalmonScenario({ intents: intentsFor(mode) }).then((r) => alive && setRun(r));
    return () => {
      alive = false;
    };
  }, [mode]);

  const capability = createAppendOnlyWriteBoundary().mode;
  const active = MODES.find((m) => m.id === mode)!;

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Dry run only. The boundary defaults to{" "}
        <span className="text-foreground">{capability}</span>: a production append needs an
        approved runtime capability that this project does not have, so the rows below were
        drafted and replayed but <span className="text-foreground">never sent anywhere</span>.
        There is no update, delete or upsert verb in the module.
      </p>

      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              mode === m.id
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{active.note}</p>

      {!run ? (
        <p className="text-[12px] text-muted-foreground">Running…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <Badge variant="outline" className="font-mono">
              capability {run.boundary.mode}
            </Badge>
            <Badge variant="outline" className="font-mono">
              rows drafted {run.draftedRows.length}
            </Badge>
            <Badge variant="outline" className="font-mono">
              written 0
            </Badge>
            <Badge
              variant="outline"
              className={`font-mono ${run.onHand === 0 ? "border-primary/50 text-foreground" : ""}`}
            >
              shadow on-hand {run.onHand} {run.unit ?? ""}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {run.snapshot.reconciliationStatus}
            </Badge>
          </div>

          <p className="text-[11px] text-muted-foreground">
            <span className="font-mono text-foreground">{SALMON_ITEM}</span> — opening 780 g,
            replayed to{" "}
            <span className="font-mono text-foreground">
              {run.onHand} {run.unit ?? ""}
            </span>{" "}
            via snapshot{" "}
            <span className="font-mono">{run.snapshot.snapshotId.slice(0, 16)}…</span>
          </p>

          {run.draftedRows.map((row) => (
            <RowPreview key={row["Event ID"]} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
