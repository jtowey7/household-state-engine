import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Home,
  Leaf,
  ListChecks,
  Loader2,
  ShieldCheck,
  ShoppingBasket,
  Truck,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { buildDevControlReport, collectDevControlSignals } from "@/lib/dev-control";
import { describeHouseholdSource } from "@/lib/dev-control/source-banner";
import type { HouseholdSourceView } from "@/lib/dev-control/source-banner";
import type { AttentionItem, DevControlReport, Severity } from "@/lib/dev-control";
import { getAirtableConnectivity } from "@/lib/production-adapter/connectivity.functions";
import { getLiveHouseholdState } from "@/lib/production-adapter/live-state.functions";

export const Route = createFileRoute("/control")({
  head: () => ({
    meta: [
      { title: "FoodOS Control — household operations overview" },
      {
        name: "description",
        content:
          "The FoodOS control room: household health, what needs attention, the operating flow from household to delivery, and the evidence behind it.",
      },
      { property: "og:title", content: "FoodOS Control — household operations overview" },
      {
        property: "og:description",
        content: "Health, attention, operating flow and proof for the FoodOS household system.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ControlDashboard,
});

const HEALTH_TONE: Record<DevControlReport["health"], string> = {
  GREEN: "border-[var(--ctl-green)]/35 bg-accent text-accent-foreground",
  AMBER: "border-[var(--ctl-amber)]/40 bg-[var(--ctl-amber)]/10 text-foreground",
  RED: "border-destructive/35 bg-destructive/8 text-destructive",
};

const SEVERITY_TONE: Record<Severity, string> = {
  RED: "border-destructive/35 bg-destructive/5",
  AMBER: "border-[var(--ctl-amber)]/40 bg-[var(--ctl-amber)]/8",
  INFO: "border-border bg-muted/50",
};

const FLOW = [
  { key: "household", label: "Household", icon: Home, blurb: "Who is eating, what they like, what is really in the house." },
  { key: "state", label: "State", icon: Activity, blurb: "Events replay into one agreed picture of current stock." },
  { key: "planning", label: "Planning", icon: CalendarDays, blurb: "The week's meals set what the household will actually need." },
  { key: "requirements", label: "Requirements", icon: ListChecks, blurb: "Need minus have becomes a precise shortfall per item." },
  { key: "procurement", label: "Procurement", icon: Boxes, blurb: "Shortfalls roll into one basket, deduplicated and pack-rounded." },
  { key: "shopping", label: "Shopping / Delivery", icon: ShoppingBasket, blurb: "A human approves; food arrives and re-enters the house." },
  { key: "back", label: "Back to Household", icon: Truck, blurb: "Deliveries and what you tell FoodOS feed the next cycle." },
] as const;

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
    <section className="ctl-card p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold leading-tight tracking-[-0.01em] sm:text-base">{title}</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{question}</p>
      </div>
      {children}
    </section>
  );
}

function FlowBand() {
  return (
    <div className="ctl-card overflow-hidden">
      <div className="ctl-rail h-1 w-full" />
      <div className="p-3 sm:p-4">
        <div className="mb-3 flex items-center gap-2">
          <Leaf className="h-4 w-4 text-accent-foreground" />
          <p className="text-[12.5px] font-medium">How FoodOS keeps the household running</p>
        </div>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <li key={stage.key} className="ctl-sunken flex gap-2.5 p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card text-accent-foreground shadow-[var(--ctl-shadow)]">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-mono text-[10px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                    <span className="text-[13px] font-medium leading-tight">{stage.label}</span>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{stage.blurb}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function AttentionCard({ item, open, onToggle }: { item: AttentionItem; open: boolean; onToggle: () => void }) {
  return (
    <div id={item.id} className={`rounded-xl border p-3 transition-colors ${SEVERITY_TONE[item.severity]}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2 text-left" aria-expanded={open}>
        {item.severity === "RED" ? (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        ) : item.severity === "AMBER" ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ctl-amber)]" />
        ) : (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1">
          <span className="block text-[13.5px] font-medium leading-snug">{item.title}</span>
          <span className="mt-0.5 block text-[12px] text-muted-foreground">{item.meaning}</span>
        </span>
        <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open ? (
        <div className="mt-3 space-y-2 border-t border-border/70 pt-3 text-[12px]">
          <p><span className="font-medium">Cause:</span> {item.rootCause}</p>
          <p><span className="font-medium">FoodOS response:</span> {item.consequence}</p>
          <div className="rounded-md border border-border bg-card p-2.5">
            <p><span className="font-mono text-[11px]">{item.workItem.ref}</span> · {item.workItem.title}</p>
            <p className="mt-1 text-muted-foreground">{item.component.name} — {item.component.does}</p>
          </div>
          <details>
            <summary className="cursor-pointer text-[11px] text-muted-foreground">Technical evidence</summary>
            <ul className="mt-1 space-y-0.5 font-mono text-[10.5px] text-muted-foreground">
              {item.evidence.map((line, index) => <li key={`${item.id}-e-${index}`}>{line}</li>)}
            </ul>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="ctl-card p-3">
      <p className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[22px] font-semibold leading-none tracking-[-0.02em]">{value}</p>
      <p className="mt-1 text-[10.5px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function SourceBanner({ view }: { view: HouseholdSourceView }) {
  const live = view.mode === "LIVE";
  return (
    <div
      className={`ctl-card border p-3 sm:p-4 ${
        live ? "border-[var(--ctl-green)]/40 bg-accent" : "border-[var(--ctl-amber)]/40 bg-[var(--ctl-amber)]/8"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px] tracking-[0.12em]">
          {view.badge}
        </Badge>
        <span className="text-[13px] font-medium">{view.title}</span>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">{view.detail}</p>
      <ul className="mt-2 space-y-0.5 text-[11.5px] text-muted-foreground">
        {view.facts.map((fact) => (
          <li key={fact}>· {fact}</li>
        ))}
      </ul>
    </div>
  );
}

function ControlDashboard() {
  const [report, setReport] = useState<DevControlReport | null>(null);
  const [source, setSource] = useState<HouseholdSourceView | null>(null);
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
        const read = await getLiveHouseholdState();
        if (active) setSource(describeHouseholdSource(read));
      } catch {
        if (active)
          setSource({
            mode: "READ_FAILED",
            syntheticFigures: true,
            badge: "SOURCE UNAVAILABLE",
            title: "The household source check could not be completed.",
            detail: "No live household state is shown.",
            facts: ["Everything below comes from the synthetic harness, not your household."],
          });
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
    return (
      <main className="theme-control min-h-screen bg-background">
        <div className="mx-auto max-w-3xl p-4">
          <p className="rounded-xl border border-destructive/40 bg-destructive/8 p-4 text-[13px] text-destructive">
            FoodOS control could not build its current view: {error}
          </p>
        </div>
      </main>
    );
  }

  if (!report) {
    return (
      <main className="theme-control min-h-screen bg-background">
        <div className="mx-auto flex max-w-3xl items-center gap-2 p-6 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking FoodOS…
        </div>
      </main>
    );
  }

  const attention = report.attention.slice(0, 4);
  const openWork = report.roadmap.filter((block) => block.state === "IN_PROGRESS");
  const recentShifts = report.shifts.slice(0, 3);

  return (
    <main className="theme-control min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-3 px-3 pb-16 pt-4 sm:px-5 sm:space-y-4 lg:px-8">
        <header className="space-y-3 sm:space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
            <div>
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <Leaf className="h-3 w-3 text-accent-foreground" /> FoodOS · Control
              </p>
              <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-[-0.025em] sm:text-[28px]">
                Keeping the household running.
              </h1>
              <p className="mt-1 max-w-xl text-[12.5px] text-muted-foreground">
                A calm view of what FoodOS is doing, what needs attention, and where the operating flow stands.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/console">Technical console</Link>
            </Button>
          </div>

          <FlowBand />

          <div className={`ctl-hero border p-4 sm:p-5 ${HEALTH_TONE[report.health]}`}>
            <div className="flex items-center gap-2">
              {report.health === "GREEN" ? <CheckCircle2 className="h-5 w-5" /> : report.health === "AMBER" ? <AlertTriangle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
              <span className="text-[15px] font-semibold sm:text-base">{report.headline}</span>
            </div>
            <ul className="mt-2 space-y-1 text-[12.5px] opacity-90">
              {report.bullets.slice(0, 3).map((bullet, i) => <li key={`b-${i}`}>· {bullet}</li>)}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
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

        <Section
          title="What needs attention"
          question={`${report.attention.length} item(s) currently surfaced. Tap one for its cause, the FoodOS response and the underlying work item.`}
        >
          {attention.length ? (
            <div className="space-y-2">
              {attention.map((item) => (
                <AttentionCard key={item.id} item={item} open={openItem === item.id} onToggle={() => setOpenItem(openItem === item.id ? null : item.id)} />
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">Nothing is currently waiting on the operator.</p>
          )}
        </Section>

        <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
          <Section title="Currently running" question="The cycles FoodOS has just executed and where each one stopped.">
            <div className="space-y-2">
              {report.running.length ? report.running.map((run) => (
                <div key={run.id} className="ctl-sunken border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium">{run.label}</span>
                    <Badge variant="outline">{run.status}</Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">{run.summary}</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground">Stage detail</summary>
                    <ul className="mt-1 space-y-0.5 font-mono text-[10.5px] text-muted-foreground">
                      {run.stageSummary.map((stage) => <li key={`${run.id}-${stage.stage}`}>{stage.stage} · {stage.status}</li>)}
                    </ul>
                  </details>
                </div>
              )) : <p className="text-[12.5px] text-muted-foreground">No cycle has run in this view.</p>}
            </div>
          </Section>

          <Section title="Operating frontier" question="The small amount of work currently moving FoodOS forward.">
            <div className="space-y-2">
              {openWork.length ? openWork.map((block) => (
                <div key={block.id} className="ctl-sunken border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-medium">{block.title}</span>
                    <span className="text-[11px] text-muted-foreground">{block.progress}%</span>
                  </div>
                  <Progress value={block.progress} className="mt-2 h-1.5" />
                  <p className="mt-2 text-[12px] text-muted-foreground">{block.purpose}</p>
                  <p className="mt-1 text-[11.5px]">{block.evidence}</p>
                </div>
              )) : <p className="text-[12.5px] text-muted-foreground">No roadmap block is currently marked in progress.</p>}
            </div>
          </Section>
        </div>

        <Section title="What is proven" question="Evidence is separated from design and synthetic state; this does not imply production household capability.">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {report.evidence.map((row) => (
              <div key={row.id} className="ctl-sunken border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium">{row.label}</span>
                  <Badge variant="outline" className={row.green ? "text-accent-foreground" : "text-destructive"}>{row.passed}/{row.total}</Badge>
                </div>
                <p className="mt-1 text-[11.5px] text-muted-foreground">{row.detail}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Recent changes" question="The latest movement in the system and roadmap.">
          <div className="space-y-2">
            {recentShifts.map((shift) => (
              <div key={shift.id} className="ctl-sunken p-3">
                <p className="text-[12.5px] font-medium">{shift.title}</p>
                <p className="text-[11.5px] text-muted-foreground">{shift.change}</p>
              </div>
            ))}
          </div>
        </Section>

        <section className="ctl-card p-4 sm:p-5">
          <details>
            <summary className="cursor-pointer text-[13px] font-medium">Technical diagnostics</summary>
            <div className="mt-3 space-y-2">
              {report.jobs.map((job) => (
                <div key={job.id} className="ctl-sunken border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-medium">{job.title}</span>
                    <Badge variant="outline">{job.state}</Badge>
                  </div>
                  <p className="mt-1 text-[11.5px] text-muted-foreground">{job.purpose}</p>
                  <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">{job.detail}</p>
                </div>
              ))}
            </div>
          </details>
        </section>
      </div>
    </main>
  );
}
