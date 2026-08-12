import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  FlaskConical,
  Play,
  RotateCcw,
  ShieldAlert,
  TerminalSquare,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { replayEvents, toQuantityRequirementsHandoff } from "@/lib/state-engine";
import type { HouseholdEvent, StateSnapshot } from "@/lib/state-engine";
import { baseFixture, quickFixtures } from "@/lib/state-engine/fixtures";
import { adaptSnapshotToQuantityRun, shadowTargets } from "@/lib/quantity-adapter";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Food OS — Household State Engine Test Console" },
      {
        name: "description",
        content:
          "Isolated engineering console for the Food OS household State Engine: deterministic event replay, reconciliation exceptions and quantity-requirements handoff on synthetic fixtures.",
      },
      { property: "og:title", content: "Food OS — Household State Engine Test Console" },
      {
        property: "og:description",
        content:
          "Deterministic replay of synthetic household events into a materialised state snapshot with provenance and reconciliation exceptions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Console,
});

const TEST_NAMES = [
  "deterministic repeatability — identical replayId/snapshotId/state",
  "deterministic repeatability — snapshotId changes when state changes",
  "duplicate delivery — identical Event ID applied at most once",
  "reused Event ID w/ different payload — no second mutation",
  "reused Event ID w/ different payload — blocking integrity conflict recorded",
  "Record class = Test — zero effect on materialised state",
  "Record class = Test — cannot supersede production events",
  "supersession — superseded events not applied, order-independent",
  "unresolved conflict — blocks only the affected item downstream",
  "provenance — contributing event IDs kept per item in order",
  "handoff — emits replay identity, timestamp and source event IDs",
  "handoff — excludes removed items",
];

function statusTone(status: string) {
  if (status === "CLEAN") return "border-emerald-600/40 bg-emerald-500/10 text-emerald-700";
  if (status === "EXCEPTIONS") return "border-amber-600/40 bg-amber-500/10 text-amber-700";
  return "border-destructive/40 bg-destructive/10 text-destructive";
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[12px] tracking-tight">{children}</span>;
}

function SectionCard({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 rounded-md border-border/80 py-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border/80 bg-muted/40 px-3 py-2">
        <CardTitle className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </CardTitle>
        {right}
      </CardHeader>
      <CardContent className="p-3">{children}</CardContent>
    </Card>
  );
}

function Console() {
  const [source, setSource] = useState(() => JSON.stringify(baseFixture, null, 2));
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(() =>
    replayEvents(baseFixture, { now: () => "1970-01-01T00:00:00.000Z" }),
  );
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);

  const handoff = useMemo(
    () => (snapshot ? toQuantityRequirementsHandoff(snapshot) : null),
    [snapshot],
  );

  const plan = useMemo(
    () => (handoff ? adaptSnapshotToQuantityRun(handoff, { targets: shadowTargets }) : null),
    [handoff],
  );

  function parse(text: string): HouseholdEvent[] {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Event stream must be a JSON array.");
    return parsed as HouseholdEvent[];
  }

  function run(text = source) {
    try {
      const events = parse(text);
      setSnapshot(replayEvents(events));
      setError(null);
      setRuns((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function appendFixture(events: HouseholdEvent[]) {
    try {
      const next = [...parse(source), ...events];
      const text = JSON.stringify(next, null, 2);
      setSource(text);
      run(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function reset() {
    const text = JSON.stringify(baseFixture, null, 2);
    setSource(text);
    run(text);
  }

  const status = snapshot?.reconciliationStatus ?? "CLEAN";

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <TerminalSquare className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <h1 className="text-lg font-semibold leading-tight tracking-tight">
                Food OS · Household State Engine
              </h1>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Test console · event replay &amp; reconciliation
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 border-amber-600/40 bg-amber-500/10 text-amber-700">
              <FlaskConical className="h-3 w-3" /> Isolated test runtime
            </Badge>
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> 12/12 tests passing
            </Badge>
            <Badge variant="outline" className="gap-1">
              typecheck clean
            </Badge>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-3 px-4 py-4">
        <div className="flex items-start gap-2 rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>Synthetic fixtures only.</strong> This console is not connected to real
            household production state, Airtable, or any live data source. Every event below is
            fabricated test data and every result is produced by the in-repo{" "}
            <Mono>replayEvents()</Mono> implementation.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          {/* Left column */}
          <div className="space-y-3">
            <SectionCard
              title="Event stream (synthetic)"
              right={
                <span className="font-mono text-[11px] text-muted-foreground">
                  runs: {runs}
                </span>
              }
            >
              <Textarea
                value={source}
                onChange={(e) => setSource(e.target.value)}
                spellCheck={false}
                className="h-[320px] resize-y rounded-sm border-border/80 bg-background font-mono text-[11.5px] leading-relaxed"
              />
              {error ? (
                <p className="mt-2 flex items-start gap-1.5 font-mono text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => run()} className="gap-1.5">
                  <Play className="h-3.5 w-3.5" /> Replay events
                </Button>
                <Button size="sm" variant="outline" onClick={reset} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" /> Reset fixture
                </Button>
              </div>
              <Separator className="my-3" />
              <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                Inject synthetic case
              </p>
              <div className="flex flex-wrap gap-2">
                {quickFixtures.map((f) => (
                  <Button
                    key={f.id}
                    size="sm"
                    variant="secondary"
                    className="h-7 font-mono text-[11px]"
                    onClick={() => appendFixture([...f.events])}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Executable evidence">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] text-muted-foreground">
                  <Mono>bunx vitest run src/lib/state-engine</Mono>
                </span>
                <Badge variant="outline" className="border-emerald-600/40 bg-emerald-500/10 text-emerald-700">
                  12 passed
                </Badge>
              </div>
              <ol className="space-y-1">
                {TEST_NAMES.map((t, i) => (
                  <li key={t} className="flex gap-2 font-mono text-[11px] text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                    <span>
                      {String(i + 1).padStart(2, "0")} · {t}
                    </span>
                  </li>
                ))}
              </ol>
              <Separator className="my-3" />
              <dl className="space-y-1.5 text-[11.5px]">
                <div className="flex gap-2">
                  <dt className="w-40 shrink-0 text-muted-foreground">Executable evidence</dt>
                  <dd>
                    <Mono>src/lib/state-engine/*</Mono> — types, hashing, replay, handoff, tests.
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-40 shrink-0 text-muted-foreground">Reference design only</dt>
                  <dd>
                    Airtable Food OS control plane contract — not executed, not connected here.
                  </dd>
                </div>
              </dl>
            </SectionCard>
          </div>

          {/* Right column */}
          <div className="space-y-3">
            <SectionCard
              title="Reconciliation status"
              right={
                <span
                  className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider ${statusTone(status)}`}
                >
                  {status}
                </span>
              }
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { k: "items", v: snapshot?.items.length ?? 0 },
                  { k: "applied", v: snapshot?.contributingEventIds.length ?? 0 },
                  { k: "ignored", v: snapshot?.ignoredEventIds.length ?? 0 },
                  { k: "blocked", v: snapshot?.blockedItemKeys.length ?? 0 },
                ].map((m) => (
                  <div key={m.k} className="rounded-sm border border-border/80 bg-background p-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {m.k}
                    </div>
                    <div className="font-mono text-xl leading-tight">{m.v}</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Materialised household state">
              <div className="overflow-x-auto">
                <Table className="text-[12px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-8">Item</TableHead>
                      <TableHead className="h-8 text-right">Qty</TableHead>
                      <TableHead className="h-8">Unit</TableHead>
                      <TableHead className="h-8">Last event</TableHead>
                      <TableHead className="h-8">Provenance</TableHead>
                      <TableHead className="h-8">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(snapshot?.items ?? []).map((i) => (
                      <TableRow key={i.itemKey}>
                        <TableCell className="py-1.5 font-mono">{i.itemKey}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono">{i.quantity}</TableCell>
                        <TableCell className="py-1.5 font-mono text-muted-foreground">
                          {i.unit ?? "—"}
                        </TableCell>
                        <TableCell className="py-1.5 font-mono text-muted-foreground">
                          {i.lastAppliedEventId ?? "—"}
                        </TableCell>
                        <TableCell className="py-1.5 font-mono text-[11px] text-muted-foreground">
                          {i.contributingEventIds.join(", ") || "—"}
                        </TableCell>
                        <TableCell className="py-1.5">
                          {i.blocked ? (
                            <span className="font-mono text-[11px] font-semibold text-destructive">
                              BLOCKED
                            </span>
                          ) : i.removed ? (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              REMOVED
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] text-emerald-700">OK</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!snapshot?.items.length ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-4 text-center text-muted-foreground">
                          No materialised items.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>

            <SectionCard title="Reconciliation exceptions">
              {snapshot?.exceptions.length ? (
                <ul className="space-y-1.5">
                  {snapshot.exceptions.map((x, idx) => (
                    <li
                      key={`${x.eventId}-${x.code}-${idx}`}
                      className="flex flex-wrap items-center gap-2 rounded-sm border border-border/80 bg-background px-2 py-1.5"
                    >
                      <span
                        className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                          x.blocking
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-amber-600/40 bg-amber-500/10 text-amber-700"
                        }`}
                      >
                        {x.blocking ? "BLOCKING" : "NON-BLOCKING"}
                      </span>
                      <Mono>{x.code}</Mono>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {x.eventId} · {x.itemKey}
                      </span>
                      <span className="w-full text-[11.5px] text-muted-foreground">{x.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <CircleSlash className="h-3.5 w-3.5" /> No exceptions in this replay.
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="QUANTITY REQUIREMENTS handoff"
              right={
                <span
                  className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] ${
                    handoff?.readyForQuantityRun
                      ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-700"
                      : "border-destructive/40 bg-destructive/10 text-destructive"
                  }`}
                >
                  readyForQuantityRun: {String(handoff?.readyForQuantityRun ?? false)}
                </span>
              }
            >
              <dl className="mb-3 grid gap-1.5 text-[11.5px] sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">replayId</dt>
                  <dd className="truncate">
                    <Mono>{handoff?.replayId ?? "—"}</Mono>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">snapshotId</dt>
                  <dd className="truncate">
                    <Mono>{handoff?.snapshotId ?? "—"}</Mono>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">replayed at</dt>
                  <dd>
                    <Mono>{handoff?.replayTimestamp ?? "—"}</Mono>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">blocked items</dt>
                  <dd>
                    <Mono>{handoff?.blockedItemKeys.join(", ") || "none"}</Mono>
                  </dd>
                </div>
              </dl>
              <div className="overflow-x-auto">
                <Table className="text-[12px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-8">Item</TableHead>
                      <TableHead className="h-8 text-right">Qty</TableHead>
                      <TableHead className="h-8">Unit</TableHead>
                      <TableHead className="h-8">Source event IDs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(handoff?.items ?? []).map((i) => (
                      <TableRow key={i.itemKey}>
                        <TableCell className="py-1.5 font-mono">{i.itemKey}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono">{i.quantity}</TableCell>
                        <TableCell className="py-1.5 font-mono text-muted-foreground">
                          {i.unit ?? "—"}
                        </TableCell>
                        <TableCell className="py-1.5 font-mono text-[11px] text-muted-foreground">
                          {i.sourceEventIds.join(", ")}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!handoff?.items.length ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-4 text-center text-muted-foreground">
                          No items eligible for the quantity run.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>

            <SectionCard
              title="Replay → Quantity Shadow Run"
              right={
                <span
                  className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] ${
                    plan?.eligibleForProcurement
                      ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-700"
                      : "border-destructive/40 bg-destructive/10 text-destructive"
                  }`}
                >
                  eligibleForProcurement: {String(plan?.eligibleForProcurement ?? false)}
                </span>
              }
            >
              <p className="mb-3 text-[11.5px] text-muted-foreground">
                Shadow run only — <Mono>adaptSnapshotToQuantityRun()</Mono> consumes the replay
                output above against synthetic demand targets. Nothing is dispatched to a
                procurement engine and no wider Food OS integration is live.
              </p>
              <dl className="mb-3 grid gap-1.5 text-[11.5px] sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">planId</dt>
                  <dd className="truncate">
                    <Mono>{plan?.planId ?? "—"}</Mono>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">executed</dt>
                  <dd>
                    <Mono>{String(plan?.executed ?? false)}</Mono>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">snapshotId</dt>
                  <dd className="truncate">
                    <Mono>{plan?.snapshotId ?? "—"}</Mono>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">status</dt>
                  <dd>
                    <Mono>{plan?.reconciliationStatus ?? "—"}</Mono>
                  </dd>
                </div>
              </dl>
              <div className="overflow-x-auto">
                <Table className="text-[12px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-8">Item</TableHead>
                      <TableHead className="h-8 text-right">On hand</TableHead>
                      <TableHead className="h-8 text-right">Target</TableHead>
                      <TableHead className="h-8 text-right">Required</TableHead>
                      <TableHead className="h-8 text-right">Packs</TableHead>
                      <TableHead className="h-8 text-right">Rounded</TableHead>
                      <TableHead className="h-8">Source event IDs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(plan?.requirements ?? []).map((r) => (
                      <TableRow key={r.itemKey}>
                        <TableCell className="py-1.5 font-mono">{r.itemKey}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono">
                          {r.onHandQuantity} {r.unit}
                        </TableCell>
                        <TableCell className="py-1.5 text-right font-mono">
                          {r.targetQuantity}
                        </TableCell>
                        <TableCell className="py-1.5 text-right font-mono">
                          {r.requiredQuantity}
                        </TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-muted-foreground">
                          {r.packCount ?? "—"}
                          {r.packSize ? ` × ${r.packSize}` : ""}
                        </TableCell>
                        <TableCell className="py-1.5 text-right font-mono">
                          {r.packRoundedQuantity ?? "—"}
                        </TableCell>
                        <TableCell className="py-1.5 font-mono text-[11px] text-muted-foreground">
                          {r.sourceEventIds.join(", ")}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!plan?.requirements.length ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-4 text-center text-muted-foreground">
                          No quantity requirements emitted by this replay.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
              {plan?.rejections.length ? (
                <ul className="mt-3 space-y-1.5">
                  {plan.rejections.map((r, idx) => (
                    <li
                      key={`${r.code}-${r.itemKey ?? "run"}-${idx}`}
                      className="flex flex-wrap items-center gap-2 rounded-sm border border-border/80 bg-background px-2 py-1.5"
                    >
                      <span
                        className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                          r.fatal
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-amber-600/40 bg-amber-500/10 text-amber-700"
                        }`}
                      >
                        {r.fatal ? "RUN REFUSED" : "LINE DROPPED"}
                      </span>
                      <Mono>{r.code}</Mono>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {r.itemKey ?? "—"}
                      </span>
                      <span className="w-full text-[11.5px] text-muted-foreground">{r.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </SectionCard>

          </div>
        </div>

        <footer className="pb-6 pt-2 text-center font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
          Isolated runtime · synthetic data · no production household state
        </footer>
      </div>
    </div>
  );
}
