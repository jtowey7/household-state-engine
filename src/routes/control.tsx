import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Clock,
  Loader2,
  Map as MapIcon,
  ShieldCheck,
  TerminalSquare,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { buildDevControlReport, collectDevControlSignals } from "@/lib/dev-control";
import type { AttentionItem, DevControlReport, JobState, Severity } from "@/lib/dev-control";
import { getAirtableConnectivity } from "@/lib/production-adapter/connectivity.functions";

export const Route = createFileRoute("/control")({
  head: () => ({
    meta: [
      { title: "Development Control — Food OS Build Health" },
      {
        name: "description",
        content:
          "Operator dashboard for the Food OS build: health, what ran, blocked jobs and their root cause, green/red evidence and roadmap progress — synthetic data only.",
      },
      { property: "og:title", content: "Food OS — Development Control Dashboard" },
      {
        property: "og:description",
        content:
          "Plain-English answers on Food OS build health, running cycles, blocked scheduled jobs and roadmap progress.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
  RED: "border-destructive/40 bg-destructive/10 text-destructive",
  AMBER: "border-amber-600/40 bg-amber-500/10 text-amber-700",
  INFO: "border-border bg-muted text-muted-foreground",
};

const JOB_TONE: Record<JobState, string> = {
  RAN: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700",
  READY: "border-border bg-muted text-muted-foreground",
  IDLE: "border-border bg-muted text-muted-foreground",
  BLOCKED: "border-amber-600/40 bg-amber-500/10 text-amber-700",
  OFFLINE: "border-amber-600/40 bg-amber-500/10 text-amber-700",
  REFUSED: "border-destructive/40 bg-destructive/10 text-destructive",
};

function Section({
  title,
  question,
  icon,
  children,
}: {
  title: string;
  question: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <header className="mb-3 flex items-start gap-2">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div>
          <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
          <p className="text-[12.5px] text-muted-foreground">{question}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function AttentionCard({
  item,
  open,
  onToggle,
}: {
  item: AttentionItem;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      id={item.id}
      className={`rounded-lg border p-3 ${
        item.severity === "RED"
          ? "border-destructive/40 bg-destructive/5"
          : "border-amber-600/30 bg-amber-500/5"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2 text-left"
        aria-expanded={open}
      >
        {item.severity === "RED" ? (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        )}
        <span className="flex-1">
          <span className="block text-[14px] font-medium leading-snug">{item.title}</span>
          <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{item.meaning}</span>
        </span>
        <ChevronRight
          className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-border/60 pt-3 text-[12.5px]">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Why this is happening
            </div>
            <p className="mt-0.5">{item.rootCause}</p>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              What Food OS did about it
            </div>
            <p className="mt-0.5">{item.consequence}</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background p-2.5">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Work item
            </div>
            <p className="mt-0.5">
              <span className="font-mono text-[11.5px]">{item.workItem.ref}</span> ·{" "}
              {item.workItem.title}{" "}
              <Badge variant="outline" className="ml-1 text-[10px]">
                {item.workItem.state}
              </Badge>
            </p>
            <p className="mt-2 text-[12px]">
              <span className="font-medium">{item.component.name}</span> — {item.component.does}
            </p>
            <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
              {item.component.path}
            </p>
          </div>
          <details>
            <summary className="cursor-pointer text-[11.5px] text-muted-foreground">
              Engineering detail
            </summary>
            <ul className="mt-1 space-y-0.5 font-mono text-[10.5px] text-muted-foreground">
              {item.evidence.map((line, i) => (
                <li key={`${item.id}-ev-${i}`}>{line}</li>
              ))}
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
        const c = (await getAirtableConnectivity()) as {
          status: "CONFIGURED" | "NOT_CONFIGURED";
          missing: string[];
          detail: string;
        };
        connectivity = c;
      } catch {
        connectivity = {
          status: "UNKNOWN" as const,
          missing: [],
          detail: "Connector status could not be read from this surface.",
        };
      }
      try {
        const signals = await collectDevControlSignals({ connectivity });
        if (active) setReport(buildDevControlReport(signals));
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const attentionById = useMemo(
    () => new Map((report?.attention ?? []).map((a) => [a.id, a])),
    [report],
  );

  function focus(id: string | null) {
    if (!id) return;
    setOpenItem(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-[13px] text-destructive">
          Development control could not build its report: {error}
        </p>
      </main>
    );
  }

  if (!report) {
    return (
      <main className="mx-auto flex max-w-3xl items-center gap-2 p-6 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Running the shadow cycles and integration
        cases…
      </main>
    );
  }

  const notRunning = report.jobs.filter(
    (j) => j.state === "BLOCKED" || j.state === "OFFLINE" || j.state === "REFUSED",
  );

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-3 pb-16 pt-4 sm:px-5">
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
              Food OS · Development Control
            </p>
            <h1 className="text-[19px] font-semibold leading-tight">Build health</h1>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/console">
              <TerminalSquare className="mr-1 h-3.5 w-3.5" /> Console
            </Link>
          </Button>
        </div>

        <div className={`rounded-xl border p-4 ${HEALTH_TONE[report.health]}`}>
          <div className="flex items-center gap-2">
            {report.health === "GREEN" ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : report.health === "AMBER" ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <XCircle className="h-5 w-5" />
            )}
            <span className="text-[15px] font-semibold">{report.headline}</span>
          </div>
          <ul className="mt-2 space-y-1 text-[12.5px] opacity-90">
            {report.bullets.map((b, i) => (
              <li key={`b-${i}`}>· {b}</li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap gap-2 text-[11.5px]">
          <Badge variant="outline" className="border-border">
            <ShieldCheck className="mr-1 h-3 w-3" /> Read-only · synthetic data
          </Badge>
          <Badge variant="outline" className="border-border">
            No household writes · nothing ordered
          </Badge>
          <Button asChild variant="ghost" size="sm" className="h-6 px-2 text-[11.5px]">
            <Link to="/">Household dashboard</Link>
          </Button>
        </div>
      </header>

      <Section
        title="What needs my attention"
        question={`${report.attention.length} open item(s). Tap one for the cause and the work item.`}
        icon={<AlertTriangle className="h-4 w-4" />}
      >
        {report.attention.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Nothing is waiting on you. Every stage completed and every check is green.
          </p>
        ) : (
          <div className="space-y-2">
            {report.attention.map((item) => (
              <AttentionCard
                key={item.id}
                item={item}
                open={openItem === item.id}
                onToggle={() => setOpenItem(openItem === item.id ? null : item.id)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="What is running"
        question="Which cycles executed, and what came out of them."
        icon={<Activity className="h-4 w-4" />}
      >
        <div className="space-y-2">
          {report.running.map((row) => (
            <div key={row.id} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium">{row.label}</span>
                <Badge
                  variant="outline"
                  className={
                    row.status === "COMPLETED"
                      ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-700"
                      : row.status === "REFUSED"
                        ? "border-amber-600/40 bg-amber-500/10 text-amber-700"
                        : "border-destructive/40 bg-destructive/10 text-destructive"
                  }
                >
                  {row.status}
                </Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-muted-foreground">{row.summary}</p>
              <p className="mt-1 text-[12.5px]">{row.approval}</p>
              {row.attentionIds.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {row.attentionIds.map((id) => (
                    <Button
                      key={id}
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => focus(id)}
                    >
                      Why? {attentionById.get(id)?.severity ?? ""}
                    </Button>
                  ))}
                </div>
              ) : null}
              <details className="mt-2">
                <summary className="cursor-pointer text-[11.5px] text-muted-foreground">
                  Stage detail
                </summary>
                <ul className="mt-1 space-y-0.5 font-mono text-[10.5px] text-muted-foreground">
                  <li>cycle {row.cycleId}</li>
                  {row.snapshotId ? <li>snapshot {row.snapshotId}</li> : null}
                  {row.replayId ? <li>replay {row.replayId}</li> : null}
                  {row.stageSummary.map((s) => (
                    <li key={`${row.id}-${s.stage}`}>
                      {s.status.padEnd(8, " ")} {s.stage} — {s.detail}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Scheduled jobs"
        question={`${notRunning.length} job(s) offline or blocked right now.`}
        icon={<Clock className="h-4 w-4" />}
      >
        <ul className="space-y-2">
          {report.jobs.map((job) => (
            <li key={job.id} className="rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium">{job.title}</span>
                <Badge variant="outline" className={JOB_TONE[job.state]}>
                  {job.state}
                </Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-muted-foreground">{job.purpose}</p>
              <p className="mt-1 text-[12.5px]">{job.detail}</p>
              {job.attentionId && attentionById.has(job.attentionId) ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-6 px-2 text-[11px]"
                  onClick={() => focus(job.attentionId)}
                >
                  Root cause
                </Button>
              ) : null}
              <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                {job.lastWakeAt ? `woke ${job.lastWakeAt} · ` : ""}outcome {job.lastOutcome}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Tabs defaultValue="evidence">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
          <TabsTrigger value="shifts">Changes</TabsTrigger>
        </TabsList>

        <TabsContent value="evidence" className="mt-3">
          <Section
            title="What is green, what is red"
            question="Checks executed live in this session."
            icon={<CheckCircle2 className="h-4 w-4" />}
          >
            <ul className="space-y-2">
              {report.evidence.map((row) => (
                <li
                  key={row.id}
                  className="flex items-start gap-2 rounded-lg border border-border bg-background p-3"
                >
                  {row.green ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium">{row.label}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {row.passed}/{row.total}
                      </span>
                    </div>
                    <p className="text-[12.5px] text-muted-foreground">{row.detail}</p>
                    {row.failing.length > 0 ? (
                      <p className="mt-1 font-mono text-[10.5px] text-destructive">
                        failing: {row.failing.join(", ")}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </TabsContent>

        <TabsContent value="roadmap" className="mt-3">
          <Section
            title="Where we are on the big blocks"
            question="Each block, what it is for, and what proves it."
            icon={<MapIcon className="h-4 w-4" />}
          >
            <Accordion type="single" collapsible className="w-full">
              {report.roadmap.map((block) => (
                <AccordionItem key={block.id} value={block.id}>
                  <AccordionTrigger className="py-3 text-left">
                    <span className="flex-1 pr-2">
                      <span className="block text-[13.5px] font-medium">{block.title}</span>
                      <span className="mt-1 flex items-center gap-2">
                        <Progress value={block.progress} className="h-1.5 w-24" />
                        <span className="font-mono text-[10.5px] text-muted-foreground">
                          {block.state} · {block.progress}%
                        </span>
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 text-[12.5px]">
                    <p>{block.purpose}</p>
                    <p className="text-muted-foreground">{block.evidence}</p>
                    <ul className="space-y-1.5">
                      {block.components.map((c) => (
                        <li key={c.path} className="rounded-md border border-border/70 p-2">
                          <span className="font-medium">{c.name}</span> — {c.does}
                          <span className="mt-0.5 block font-mono text-[10.5px] text-muted-foreground">
                            {c.path}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Section>
        </TabsContent>

        <TabsContent value="shifts" className="mt-3">
          <Section
            title="What changed since recent shifts"
            question="Newest first."
            icon={<Clock className="h-4 w-4" />}
          >
            <ol className="space-y-2">
              {report.shifts.map((shift) => (
                <li key={shift.id} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10.5px] text-muted-foreground">{shift.at}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {shift.kind}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[13.5px] font-medium">{shift.title}</p>
                  <p className="text-[12.5px] text-muted-foreground">{shift.change}</p>
                </li>
              ))}
            </ol>
          </Section>
        </TabsContent>
      </Tabs>

      <p className="pb-4 text-center text-[11.5px] text-muted-foreground">
        Development surface only. The household dashboard is unchanged and lives at{" "}
        <Link to="/" className="underline">
          /
        </Link>
        .
      </p>
    </main>
  );
}
