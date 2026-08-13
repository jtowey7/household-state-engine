import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, ShieldCheck, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { buildDevControlReport, collectDevControlSignals } from "@/lib/dev-control";
import type { AttentionItem, DevControlReport, Severity } from "@/lib/dev-control";
import { getAirtableConnectivity } from "@/lib/production-adapter/connectivity.functions";

export const Route = createFileRoute("/control")({
  head: () => ({
    meta: [
      { title: "FoodOS — Control" },
      {
        name: "description",
        content: "FoodOS control room for household oversight, attention, operating flow and system evidence.",
      },
    ],
  }),
  component: ControlDashboard,
});

const HEALTH_TONE: Record<DevControlReport["health"], string> = {
  GREEN: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700",
  AMBER: "border-amber-600/40 bg-amber-500/10 text-amber-700",
  RED: "border-destructive/40 bg-destructive/10 text-destructive",
};

const SEVERITY_TONE: Record<Severity, string> = {
  RED: "border-destructive/40 bg-destructive/5",
  AMBER: "border-amber-600/30 bg-amber-500/5",
  INFO: "border-border bg-muted/30",
};

const FLOW = ["Household", "State", "Planning", "Requirements", "Procurement", "Shopping / Delivery"];

function Section({
  title,
  question,
  children,
}: {
  title: string;
  question: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/80 bg-card p-4 shadow-[0_8px_30px_-24px_rgba(0,0,0,0.35)] sm:p-5">
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
        <p className="text-[12px] text-muted-foreground">{question}</p>
      </div>
      {children}
    </section>
  );
}

function AttentionCard({ item, open, onToggle }: { item: AttentionItem; open: boolean; onToggle: () => void }) {
  return (
    <div id={item.id} className={`rounded-xl border p-3 ${SEVERITY_TONE[item.severity]}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2 text-left" aria-expanded={open}>
        {item.severity === "RED" ? (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        ) : item.severity === "AMBER" ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        ) : (
          <ShieldCheck className="mt-0.5 h-4 w-4 text-muted-foreground" />
        )}
        <span className="flex-1">
          <span className="block text-[13.5px] font-medium leading-snug">{item.title}</span>
          <span className="mt-0.5 block text-[12px] text-muted-foreground">{item.meaning}</span>
        </span>
        <ChevronRight className={`mt-1 h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open ? (
        <div className="mt-3 space-y-2 border-t border-border/60 pt-3 text-[12px]">
          <p><span className="font-medium">Cause:</span> {item.rootCause}</p>
          <p><span className="font-medium">FoodOS response:</span> {item.consequence}</p>
          <div className="rounded-md border border-border/70 bg-background p-2.5">
            <p><span className="font-mono text-[11px]">{item.workItem.ref}</span> · {item.workItem.title}</p>
            <p className="mt-1 text-muted-foreground">{item.component.name} — {item.component.does}</p>
          </div>
          <details>
            <summary className="cursor-pointer text-[11px] text-muted-foreground">Evidence</summary>
            <ul className="mt-1 space-y-0.5 font-mono text-[10.5px] text-muted-foreground">
              {item.evidence.map((line, index) => <li key={`${item.id}-e-${index}`}>{line}</li>)}
            </ul>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function ControlDashboard() {
  const [report, setReport] = useState<DevControlReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      let connectivity;
      try {
        connectivity = await getAirtableConnectivity();
      } catch {
        connectivity = { status: "UNKNOWN" as const, missing: [], detail: "Connector status unavailable." };
      }
      try {
        const signals = await collectDevControlSignals({ connectivity });
        if (active) setReport(buildDevControlReport(signals));
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { active = false; };
  }, []);

  if (error) {
    return <main className="mx-auto max-w-3xl p-4"><p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-[13px] text-destructive">FoodOS control could not build its current view: {error}</p></main>;
  }

  if (!report) {
    return <main className="mx-auto flex max-w-3xl items-center gap-2 p-6 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking FoodOS…</main>;
  }

  const attention = report.attention.slice(0, 4);
  const openWork = report.roadmap.filter((block) => block.state === "IN_PROGRESS");
  const recentShifts = report.shifts.slice(0, 3);

  return (
    <main className="mx-auto max-w-5xl space-y-3 px-3 pb-16 pt-3 sm:px-5">
      <header className="space-y-3">
        <div className="flex items-end justify-between gap-3 border-b border-border/70 pb-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">FoodOS · Control</p>
            <h1 className="mt-1 text-[23px] font-semibold leading-tight tracking-[-0.025em]">Keeping the household running.</h1>
            <p className="mt-1 max-w-xl text-[12px] text-muted-foreground">A quiet back-office view of what FoodOS is doing, what needs attention, and where the operating flow stands.</p>
          </div>
          <Button asChild variant="outline" size="sm"><Link to="/console">Details</Link></Button>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-border/80 bg-background p-3">
          <div className="flex min-w-[690px] items-center justify-between gap-2">
            {FLOW.map((stage, index) => (
              <div key={stage} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                  <span className="whitespace-nowrap text-[10.5px] font-medium text-muted-foreground">{stage}</span>
                </div>
                {index < FLOW.length - 1 ? <span className="text-[11px] text-muted-foreground/50">→</span> : null}
              </div>
            ))}
          </div>
        </div>

        <div className={`rounded-2xl border p-4 ${HEALTH_TONE[report.health]}`}>
          <div className="flex items-center gap-2">
            {report.health === "GREEN" ? <CheckCircle2 className="h-5 w-5" /> : report.health === "AMBER" ? <AlertTriangle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
            <span className="text-[15px] font-semibold">{report.headline}</span>
          </div>
          <ul className="mt-2 space-y-1 text-[12px] opacity-90">{report.bullets.slice(0, 3).map((bullet, i) => <li key={`b-${i}`}>· {bullet}</li>)}</ul>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Attention" value={String(report.attention.length)} detail="items" />
          <Kpi label="Execution" value={`${report.running.length}/${report.jobs.length}`} detail="runs / jobs" />
          <Kpi label="Evidence" value={`${report.evidence.filter((e) => e.green).length}/${report.evidence.length}`} detail="green" />
          <Kpi label="Active work" value={`${openWork.length}`} detail="blocks" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline"><ShieldCheck className="mr-1 h-3 w-3" /> Read-only</Badge>
          <Badge variant="outline">Control-plane evidence</Badge>
          <Badge variant="outline">No household writes</Badge>
        </div>
      </header>

      <Section title="What needs attention" question={`${report.attention.length} item(s) currently surfaced. Expand for cause, FoodOS response and evidence.`}>
        {attention.length ? <div className="space-y-2">{attention.map((item) => <AttentionCard key={item.id} item={item} open={openItem === item.id} onToggle={() => setOpenItem(openItem === item.id ? null : item.id)} />)}</div> : <p className="text-[12.5px] text-muted-foreground">Nothing is currently waiting on the operator.</p>}
      </Section>

      <Section title="Operating frontier" question="The small amount of work currently moving FoodOS forward.">
        <div className="space-y-2">
          {openWork.length ? openWork.map((block) => (
            <div key={block.id} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2"><span className="text-[13.5px] font-medium">{block.title}</span><span className="text-[11px] text-muted-foreground">{block.progress}%</span></div>
              <Progress value={block.progress} className="mt-2 h-1.5" />
              <p className="mt-2 text-[12px] text-muted-foreground">{block.purpose}</p>
              <p className="mt-1 text-[11.5px]">{block.evidence}</p>
            </div>
          )) : <p className="text-[12.5px] text-muted-foreground">No roadmap block is currently marked in progress.</p>}
        </div>
      </Section>

      <Section title="What is proven" question="Evidence is separated from design and synthetic state; this does not imply production household capability.">
        <div className="grid gap-2 sm:grid-cols-2">
          {report.evidence.map((row) => (
            <div key={row.id} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2"><span className="text-[12.5px] font-medium">{row.label}</span><Badge variant="outline">{row.passed}/{row.total}</Badge></div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">{row.detail}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Recent changes" question="The latest movement in the system and roadmap.">
        <div className="space-y-2">
          {recentShifts.map((shift) => <div key={shift.id} className="rounded-xl bg-muted/30 p-3"><p className="text-[12px] font-medium">{shift.title}</p><p className="text-[11.5px] text-muted-foreground">{shift.change}</p></div>)}
        </div>
      </Section>
    </main>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-2xl border border-border/80 bg-card p-3 shadow-[0_8px_30px_-24px_rgba(0,0,0,0.35)]"><p className="text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p><p className="mt-1 text-[20px] font-semibold leading-none tracking-[-0.02em]">{value}</p><p className="mt-1 text-[10.5px] text-muted-foreground">{detail}</p></div>;
}
