import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/runtime-household")({
  head: () => ({
    meta: [
      { title: "Food OS · Runtime Household State" },
      {
        name: "description",
        content: "Read-only view of the owned Food OS household runtime alpha state. Test runtime only.",
      },
    ],
  }),
  component: RuntimeHousehold,
});

type ItemState = {
  itemKey: string;
  quantity: number;
  unit: string | null;
  removed: boolean;
  lastAppliedEventId: string | null;
  contributingEventIds: string[];
  blocked: boolean;
};

type Snapshot = {
  snapshotId: string;
  replayId: string;
  replayTimestamp: string;
  items: ItemState[];
  contributingEventIds: string[];
  ignoredEventIds: string[];
  exceptions: Array<{
    code: string;
    eventId: string;
    itemKey: string;
    detail: string;
    blocking: boolean;
  }>;
  reconciliationStatus: "CLEAN" | "EXCEPTIONS" | "BLOCKED";
  blockedItemKeys: string[];
};

type RuntimeResponse = {
  ok: boolean;
  mode?: "TEST_ONLY";
  eventCount?: number;
  snapshot?: Snapshot;
  error?: string;
};

function statusClass(status: Snapshot["reconciliationStatus"] | "ERROR") {
  if (status === "CLEAN") return "border-emerald-600/40 bg-emerald-500/10 text-emerald-700";
  if (status === "EXCEPTIONS") return "border-amber-600/40 bg-amber-500/10 text-amber-700";
  return "border-destructive/40 bg-destructive/10 text-destructive";
}

function RuntimeHousehold() {
  const [data, setData] = useState<RuntimeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/runtime/household/state", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const body = (await response.json()) as RuntimeResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? `Runtime returned HTTP ${response.status}`);
      }
      setData(body);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const snapshot = data?.snapshot;
  const status = snapshot?.reconciliationStatus ?? (error ? "ERROR" : "CLEAN");

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Food OS · Runtime Household State</h1>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Owned runtime alpha · read-only operator view
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/control" className="rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
              Development control
            </Link>
            <Link to="/console" className="rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
              Test console
            </Link>
            <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-3 px-4 py-4">
        <div className="flex items-start gap-2 rounded-md border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>TEST_ONLY.</strong> This view reads the owned non-production runtime only. It does not read or write production household state and must never be treated as proof that the production HOUSEHOLD EVENTS baseline is live.
          </p>
        </div>

        {error ? (
          <Card className="rounded-md border-destructive/40 py-0 shadow-none">
            <CardContent className="flex items-start gap-2 p-3 text-[12px] text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong>Runtime unavailable.</strong> {error}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card className="gap-0 rounded-md border-border/80 py-0 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/80 bg-muted/40 px-3 py-2">
            <CardTitle className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Runtime snapshot
            </CardTitle>
            <Badge variant="outline" className={statusClass(status as Snapshot["reconciliationStatus"] | "ERROR")}>
              {status}
            </Badge>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["events", data?.eventCount ?? 0],
                ["items", snapshot?.items.length ?? 0],
                ["blocked", snapshot?.blockedItemKeys.length ?? 0],
                ["exceptions", snapshot?.exceptions.length ?? 0],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-sm border border-border/80 bg-background p-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
                  <div className="font-mono text-xl leading-tight">{value}</div>
                </div>
              ))}
            </div>
            <dl className="mt-3 grid gap-1.5 text-[11.5px] sm:grid-cols-2">
              <div><dt className="text-muted-foreground">snapshotId</dt><dd className="break-all font-mono">{snapshot?.snapshotId ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">replayId</dt><dd className="break-all font-mono">{snapshot?.replayId ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">replayed at</dt><dd className="font-mono">{snapshot?.replayTimestamp ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">mode</dt><dd className="font-mono">{data?.mode ?? "—"}</dd></div>
            </dl>
          </CardContent>
        </Card>

        <Card className="gap-0 rounded-md border-border/80 py-0 shadow-none">
          <CardHeader className="border-b border-border/80 bg-muted/40 px-3 py-2">
            <CardTitle className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Materialised state</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="overflow-x-auto">
              <Table className="text-[12px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-8">Item</TableHead>
                    <TableHead className="h-8 text-right">Qty</TableHead>
                    <TableHead className="h-8">Unit</TableHead>
                    <TableHead className="h-8">Provenance</TableHead>
                    <TableHead className="h-8">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(snapshot?.items ?? []).map((item) => (
                    <TableRow key={item.itemKey}>
                      <TableCell className="py-1.5 font-mono">{item.itemKey}</TableCell>
                      <TableCell className="py-1.5 text-right font-mono">{item.quantity}</TableCell>
                      <TableCell className="py-1.5 font-mono text-muted-foreground">{item.unit ?? "—"}</TableCell>
                      <TableCell className="max-w-[360px] py-1.5 font-mono text-[11px] text-muted-foreground">{item.contributingEventIds.join(", ") || "—"}</TableCell>
                      <TableCell className="py-1.5">
                        {item.blocked ? <span className="font-mono text-[11px] font-semibold text-destructive">BLOCKED</span> : item.removed ? <span className="font-mono text-[11px] text-muted-foreground">REMOVED</span> : <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-700"><CheckCircle2 className="h-3 w-3" /> OK</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!snapshot?.items.length ? (
                    <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No runtime household events have been applied yet.</TableCell></TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-0 rounded-md border-border/80 py-0 shadow-none">
          <CardHeader className="border-b border-border/80 bg-muted/40 px-3 py-2">
            <CardTitle className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Exceptions</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            {snapshot?.exceptions.length ? (
              <ul className="space-y-1.5">
                {snapshot.exceptions.map((exception, index) => (
                  <li key={`${exception.eventId}-${exception.code}-${index}`} className="rounded-sm border border-border/80 bg-background px-2 py-1.5 text-[11.5px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={exception.blocking ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-amber-600/40 bg-amber-500/10 text-amber-700"}>{exception.blocking ? "BLOCKING" : "NON-BLOCKING"}</Badge>
                      <span className="font-mono">{exception.code}</span>
                      <span className="font-mono text-muted-foreground">{exception.itemKey} · {exception.eventId}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{exception.detail}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-muted-foreground">No runtime reconciliation exceptions.</p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
