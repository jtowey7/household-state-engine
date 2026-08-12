import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Info,
  Pencil,
  ShoppingBag,
  Sparkles,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  SWEEP_ITEMS,
  expectationForItem,
  evidenceFromSweepTap,
  evidenceFromTellReport,
  outcomeForItem,
  runSweep,
  type InteractionStatus,
  type SweepAction,
  type TellIntent,
} from "@/lib/sweep";
import type { ConsumptionEvidence } from "@/lib/expected-state/types";

export const Route = createFileRoute("/sweep")({
  head: () => ({
    meta: [
      { title: "Quick Stock Sweep — Food OS" },
      {
        name: "description",
        content:
          "A one-tap kitchen sweep and a Tell Food OS box. Every tap records evidence and shows whether your food state is confirmed, awaiting, diverged or blocked. Synthetic demo data.",
      },
      { property: "og:title", content: "Quick Stock Sweep — Food OS" },
      {
        property: "og:description",
        content:
          "Confirm what's gone, used or wasted in a few taps. Food OS records evidence rather than silently editing your inventory.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SweepScreen,
});

/* ---------------------------------------------------------------- *
 * SYNTHETIC DEMO SURFACE — no household data, no writes anywhere.
 * ---------------------------------------------------------------- */

const statusLook: Record<InteractionStatus, { label: string; className: string }> = {
  CONFIRMED: { label: "Confirmed", className: "bg-primary/12 text-primary border-primary/25" },
  AWAITING_CONFIRMATION: {
    label: "Awaiting confirmation",
    className: "bg-muted text-muted-foreground border-border",
  },
  DIVERGED: {
    label: "Diverged",
    className: "bg-accent/50 text-accent-foreground border-accent-foreground/25",
  },
  BLOCKED: {
    label: "Blocked",
    className: "bg-destructive/10 text-destructive border-destructive/30",
  },
  RECORDED_UNPLANNED: {
    label: "Recorded — unplanned",
    className: "bg-accent/40 text-accent-foreground border-accent-foreground/20",
  },
};

const sweepActions: Array<{ action: SweepAction; label: string; icon: typeof Check }> = [
  { action: "USED_AS_PLANNED", label: "Used as planned", icon: Check },
  { action: "GONE", label: "All gone", icon: UtensilsCrossed },
  { action: "WASTED", label: "Wasted", icon: Trash2 },
  { action: "DIFFERENT_QUANTITY", label: "Different amount", icon: Pencil },
];

const tellIntents: Array<{ intent: TellIntent; label: string; icon: typeof Check }> = [
  { intent: "USED_SOMETHING", label: "Used something", icon: UtensilsCrossed },
  { intent: "BOUGHT_SOMETHING", label: "Bought something", icon: ShoppingBag },
  { intent: "WASTED_SOMETHING", label: "Wasted something", icon: Trash2 },
  { intent: "CHANGED_A_MEAL", label: "Changed a meal", icon: Sparkles },
];

function StatusPill({ status }: { status: InteractionStatus }) {
  const look = statusLook[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${look.className}`}
    >
      {look.label}
    </span>
  );
}

function SweepScreen() {
  const [evidence, setEvidence] = useState<ConsumptionEvidence[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [openWhy, setOpenWhy] = useState<string | null>(null);
  const [intent, setIntent] = useState<TellIntent>("USED_SOMETHING");
  const [tellItem, setTellItem] = useState<string>(SWEEP_ITEMS[0]!.itemKey);
  const [tellQty, setTellQty] = useState("");
  const [tellText, setTellText] = useState("");

  const run = useMemo(() => runSweep(evidence), [evidence]);
  const observedAt = "2026-02-10T18:30:00.000Z";

  const tap = (itemKey: string, action: SweepAction) => {
    const raw = amounts[itemKey];
    const parsed = raw !== undefined && raw !== "" ? Number(raw) : null;
    setEvidence((prev) => [
      ...prev,
      evidenceFromSweepTap({
        evidenceId: `SWEEP-${prev.length + 1}-${itemKey}-${action}`,
        itemKey,
        action,
        quantity: Number.isFinite(parsed as number) ? (parsed as number) : null,
        observedAt,
        actor: "you",
      }),
    ]);
  };

  const submitTell = () => {
    const parsed = tellQty !== "" ? Number(tellQty) : null;
    setEvidence((prev) => [
      ...prev,
      evidenceFromTellReport({
        evidenceId: `TELL-${prev.length + 1}-${intent}`,
        intent: tellText.trim() && intent === "USED_SOMETHING" ? "USED_SOMETHING" : intent,
        itemKey: tellItem,
        quantity: Number.isFinite(parsed as number) ? (parsed as number) : null,
        observedAt,
        text: tellText,
        actor: "you",
      }),
    ]);
    setTellQty("");
    setTellText("");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-md px-5 pb-24 pt-6">
        <header className="mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Food OS
          </Link>
          <h1 className="mt-3 font-display text-3xl leading-tight text-foreground">
            Quick stock sweep
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            A few taps in the kitchen. Food OS never edits your stock quietly — each tap records
            evidence, then tells you what it now believes.
          </p>
          <Badge variant="outline" className="mt-3 text-[11px] font-normal">
            Synthetic example household — no real data
          </Badge>
        </header>

        <section className="space-y-3">
          {SWEEP_ITEMS.map((item) => {
            const expectation = expectationForItem(item.itemKey);
            const outcome = outcomeForItem(run, item.itemKey);
            const forecast = run.forecast.find((f) => f.itemKey === item.itemKey);
            const isOpen = openWhy === item.itemKey;
            return (
              <article
                key={item.itemKey}
                className="rounded-2xl border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg text-card-foreground">{item.label}</h2>
                    <p className="text-xs text-muted-foreground">
                      Expected to have {forecast?.expectedRemaining ?? 0}
                      {item.unit} left · confirmed {forecast?.confirmedRemaining ?? 0}
                      {item.unit}
                    </p>
                  </div>
                  {outcome ? <StatusPill status={outcome.status} /> : null}
                </div>

                <p className="mt-2 text-xs italic text-muted-foreground">{item.teaches}</p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {sweepActions.map(({ action, label, icon: Icon }) => (
                    <Button
                      key={action}
                      type="button"
                      variant={action === "USED_AS_PLANNED" ? "default" : "secondary"}
                      size="sm"
                      className="h-11 justify-start gap-2 rounded-xl text-xs"
                      onClick={() => tap(item.itemKey, action)}
                    >
                      <Icon className="size-3.5 shrink-0" />
                      {label}
                    </Button>
                  ))}
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <Input
                    inputMode="numeric"
                    placeholder={`amount in ${item.unit}`}
                    aria-label={`Different amount for ${item.label} in ${item.unit}`}
                    value={amounts[item.itemKey] ?? ""}
                    onChange={(e) =>
                      setAmounts((prev) => ({ ...prev, [item.itemKey]: e.target.value }))
                    }
                    className="h-10 rounded-xl text-sm"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setOpenWhy(isOpen ? null : item.itemKey)}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary"
                  aria-expanded={isOpen}
                >
                  <Info className="size-3.5" />
                  Why does Food OS think this?
                  <ChevronDown className={`size-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>

                {isOpen ? (
                  <dl className="mt-2 space-y-1.5 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
                    <div className="flex justify-between gap-3">
                      <dt>Expected source</dt>
                      <dd className="text-right text-foreground">
                        {expectation ? `${expectation.sourceId}` : "no plan"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Expected burn</dt>
                      <dd className="text-right text-foreground">
                        {expectation ? `${expectation.quantity}${expectation.unit}` : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Evidence source</dt>
                      <dd className="text-right text-foreground">
                        {outcome?.evidenceIds.length
                          ? outcome.evidenceIds.join(", ")
                          : "none yet — expected only"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>State type</dt>
                      <dd className="text-right text-foreground">
                        {outcome?.status === "CONFIRMED" ? "Confirmed" : "Expected (unconfirmed)"}
                      </dd>
                    </div>
                    <p className="pt-1">{outcome?.detail ?? item.expectedBecause}</p>
                  </dl>
                ) : null}
              </article>
            );
          })}
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="font-display text-xl text-card-foreground">Tell Food OS</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            One tap, a number if you have it, words only if you want to.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {tellIntents.map(({ intent: value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setIntent(value)}
                aria-pressed={intent === value}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs transition-colors ${
                  intent === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary text-secondary-foreground"
                }`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <select
              aria-label="Item"
              value={tellItem}
              onChange={(e) => setTellItem(e.target.value)}
              className="h-11 rounded-xl border border-input bg-background px-3 text-sm"
            >
              {SWEEP_ITEMS.map((i) => (
                <option key={i.itemKey} value={i.itemKey}>
                  {i.label}
                </option>
              ))}
            </select>
            <Input
              inputMode="numeric"
              aria-label="Amount"
              placeholder="amount (optional)"
              value={tellQty}
              onChange={(e) => setTellQty(e.target.value)}
              className="h-11 rounded-xl text-sm"
            />
          </div>

          <Textarea
            aria-label="Tell Food OS what happened"
            placeholder="Anything else? e.g. 'lettuce went off before Thursday'"
            value={tellText}
            onChange={(e) => setTellText(e.target.value)}
            className="mt-2 min-h-20 rounded-xl text-sm"
          />

          <Button type="button" className="mt-3 h-11 w-full rounded-xl" onClick={submitTell}>
            Tell Food OS
          </Button>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Purchases, meal changes and free text are recorded as reports, not as confirmed stock —
            Food OS will ask before it counts them.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="font-display text-xl text-foreground">What Food OS recorded</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Household state: <span className="text-foreground">{run.reconciliationStatus}</span> ·{" "}
            {evidence.length} evidence {evidence.length === 1 ? "object" : "objects"} ·{" "}
            {run.blockedItemKeys.length} isolated
          </p>

          {evidence.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              Nothing recorded yet. Everything above is <em>expected</em> state from the plan — not
              observed truth.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {[...evidence].reverse().map((ev) => {
                const outcome = outcomeForItem(run, ev.itemKey);
                return (
                  <li
                    key={ev.evidenceId}
                    className="rounded-2xl border border-border bg-card p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-card-foreground">{ev.source}</span>
                      {outcome ? <StatusPill status={outcome.status} /> : null}
                    </div>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/70 p-2 text-[11px] leading-relaxed text-muted-foreground">
{JSON.stringify(
  {
    evidenceId: ev.evidenceId,
    itemKey: ev.itemKey,
    expectationId: ev.expectationId ?? null,
    observedQuantity: ev.observedQuantity ?? null,
    unit: ev.unit ?? null,
    confidence: ev.confidence,
    actor: ev.actor,
    note: ev.note ?? null,
    recordClass: ev.recordClass,
  },
  null,
  2,
)}
                    </pre>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-4 flex items-start gap-2 rounded-2xl bg-secondary/70 p-3 text-xs text-secondary-foreground">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <p>
              Isolated items are withheld from the shopping basket until you resolve them. Nothing
              here is dispatched, purchased or written anywhere.
            </p>
          </div>

          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" />
            <span>Reconciled as of the synthetic evening sweep.</span>
          </div>

          <Button asChild variant="outline" className="mt-4 h-11 w-full rounded-xl">
            <Link to="/console">Under the hood — Test Console</Link>
          </Button>
        </section>
      </div>
    </div>
  );
}
