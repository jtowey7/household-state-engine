import { CheckCircle2, ShieldAlert, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { describeFeedbackGate } from "@/lib/feedback/gate-view";
import type { CycleFeedbackGate } from "@/lib/feedback/cycle-gate";

const TONE: Record<string, string> = {
  ALLOWED: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700",
  WARNED: "border-amber-600/40 bg-amber-500/10 text-amber-700",
  REFUSED: "border-destructive/40 bg-destructive/10 text-destructive",
};

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] tracking-tight">{children}</span>;
}

export function FeedbackGateCard({ gate }: { gate: CycleFeedbackGate }) {
  const view = describeFeedbackGate(gate);

  return (
    <div className="rounded-sm border border-border/80 bg-background px-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {view.status === "ALLOWED" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        ) : view.status === "WARNED" ? (
          <TriangleAlert className="h-3.5 w-3.5 text-amber-600" />
        ) : (
          <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
        )}
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
          Feedback propagation gate
        </span>
        <Badge variant="outline" className={TONE[view.status]}>
          {view.status}
        </Badge>
        <Mono>gateId {view.gateId}</Mono>
        <Mono>reviewId {view.reviewId}</Mono>
        <Mono>review {view.reviewStatus}</Mono>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          applied: false · dispatched: false
        </span>
      </div>

      <p className="mt-1 text-[11.5px] text-muted-foreground">{view.summary}</p>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          gated areas: {view.gatedAreas.join(", ")}
        </span>
        <span
          className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${
            view.refusedAreas.length > 0
              ? "border-destructive/40 text-destructive"
              : "border-border text-muted-foreground"
          }`}
        >
          refused areas: {view.refusedAreas.join(", ") || "none"}
        </span>
        <span
          className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${
            view.isolatedItemKeys.length > 0
              ? "border-amber-600/40 text-amber-700"
              : "border-border text-muted-foreground"
          }`}
        >
          isolated items: {view.isolatedItemKeys.join(", ") || "none"}
        </span>
      </div>

      {view.blockingReasons.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {view.blockingReasons.map((r) => (
            <li key={r} className="font-mono text-[10.5px] text-destructive">
              ⛔ {r}
            </li>
          ))}
        </ul>
      ) : null}

      {view.exceptionNotes.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {view.exceptionNotes.map((n) => (
            <li key={n} className="font-mono text-[10.5px] text-amber-700">
              ⚠ {n}
            </li>
          ))}
        </ul>
      ) : null}

      {view.proposals.length > 0 ? (
        <div className="mt-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Durable preference proposals (proposals only)
          </span>
          <ul className="mt-1 space-y-1">
            {view.proposals.map((p) => (
              <li
                key={p.proposalId}
                className="rounded-sm border border-border/60 px-2 py-1 font-mono text-[11px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-32">{p.subject}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {p.attention} · {p.consequence}
                  </Badge>
                  <span className="text-muted-foreground">areas {p.areas.join(", ")}</span>
                  <span className="text-muted-foreground">×{p.occurrences}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    applied: false · dispatched: false · humanApproval:{" "}
                    {String(p.requiresHumanApproval)}
                  </span>
                </div>
                <p className="mt-0.5 text-[10.5px] font-sans text-muted-foreground">{p.rationale}</p>
                <span className="text-[10px] text-muted-foreground">{p.proposalId}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
