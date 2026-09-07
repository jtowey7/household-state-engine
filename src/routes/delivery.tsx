import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, ShieldCheck, TriangleAlert } from "lucide-react";
import { AppHeader, AppFooter } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Evidence, Group, PageTitle, Row, SectionHeading, Shell } from "@/components/household/household-ui";
import { prepareHouseholdIntake } from "@/lib/household-input/intake";
import { getCanonicalBasketForShop } from "@/lib/procurement/canonical-basket.functions";
import type { CanonicalBasketReadResult } from "@/lib/procurement/canonical-basket";

export const Route = createFileRoute("/delivery")({
  head: () => ({ meta: [{ title: "Record a delivery — foodOS" }, { name: "description", content: "Confirm an approved delivery, record only exceptions, and review the exact household events before any state change." }] }),
  component: DeliveryPage,
});

type DeliveryState = "ARRIVED" | "MISSING" | "SUBSTITUTED";
type Line = { lineId: string; itemKey: string; productName: string; orderedQuantity: number; unit: string; state: DeliveryState; replacementItemKey: string };

function DeliveryPage() {
  const [basket, setBasket] = useState<CanonicalBasketReadResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [result, setResult] = useState<ReturnType<typeof prepareHouseholdIntake> | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    getCanonicalBasketForShop().then((read) => {
      if (!active) return;
      setBasket(read);
      if (read.status === "READY") setLines(read.basket.lines.map((line, index) => ({ lineId: `${read.basket.basketId}:${index + 1}`, itemKey: line.itemKey, productName: line.productName, orderedQuantity: line.orderedQuantity, unit: line.packUnit, state: "ARRIVED", replacementItemKey: "" })));
    }).catch((error) => { if (active) setLoadError(error instanceof Error ? error.message : "Unable to load the approved basket."); });
    return () => { active = false; };
  }, []);

  const updateLine = (index: number, patch: Partial<Line>) => setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const exceptionCount = useMemo(() => lines.filter((line) => line.state !== "ARRIVED").length, [lines]);

  const prepare = (inputLines: Line[]) => {
    if (!basket || basket.status !== "READY" || inputLines.length === 0) return;
    const now = new Date().toISOString();
    const unresolved = inputLines.find((line) => line.state === "SUBSTITUTED" && !line.replacementItemKey.trim());
    if (unresolved) { setResult({ ok: false, code: "INVALID_EVIDENCE", detail: `A replacement canonical item is required for ${unresolved.productName}.` }); return; }
    const basketId = basket.basket.basketId;
    const version = basket.approval.basketVersion ?? 1;
    const fingerprint = basket.approval.basketFingerprint ?? "";
    setResult(prepareHouseholdIntake({ kind: "DELIVERY", input: { basketId, orderReference: `MANUAL-PURCHASE:${basketId}`, retailer: basket.basket.retailer, capturedAt: now, capturedBy: "James", delivery: { deliveryId: `MANUAL-DELIVERY:${basketId}:${now}`, dispatchId: `MANUAL-PURCHASE:${basketId}`, basketId, basketVersion: version, basketFingerprint: fingerprint, deliveredAt: now, reconciliationStatus: "RECONCILED", lines: inputLines.filter((line) => line.state !== "MISSING").map((line) => ({ lineId: line.lineId, itemKey: line.state === "SUBSTITUTED" ? line.replacementItemKey.trim() : line.itemKey, expectedItemKey: line.state === "SUBSTITUTED" ? line.itemKey : undefined, deliveredQuantity: line.orderedQuantity, unit: line.unit, substituted: line.state === "SUBSTITUTED" })) } } }, { now: () => now }));
  };

  const allArrived = () => { const arrived = lines.map((line) => ({ ...line, state: "ARRIVED" as const, replacementItemKey: "" })); setLines(arrived); setConfirmed(true); prepare(arrived); };
  const basketReady = basket?.status === "READY";

  return <div className="ctl-page"><AppHeader eyebrow="Household" /><Shell>
    <Link to="/food" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to food</Link>
    <PageTitle eyebrow="After you shop" title="Did the delivery arrive?" lede="Food OS starts from the approved basket and assumes everything arrived. You only need to tell it about exceptions." />
    <div className="mb-6 rounded-2xl border border-border bg-card p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" /><div><p className="text-sm font-semibold">Human-controlled state change</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Confirmation prepares exact canonical HOUSEHOLD EVENTS only. Nothing is written to Production until those exact events receive explicit human approval.</p></div></div></div>
    {loadError ? <Evidence label="Basket could not be loaded">{loadError}</Evidence> : null}
    {!loadError && !basket ? <p className="text-sm text-muted-foreground">Loading the approved basket…</p> : null}
    {basket && basket.status !== "READY" ? <Evidence label="Delivery unavailable">{basket.detail}</Evidence> : null}
    {basketReady ? <>
      <section className="mb-7"><SectionHeading title="Approved shop" action={<Badge variant="outline">{basket.basket.retailer}</Badge>} /><Group><Row><p className="text-sm font-semibold">{basket.basket.basketId}</p><p className="mt-1 text-xs text-muted-foreground">Approved basket · version {basket.approval.basketVersion} · {basket.basket.lines.length} lines</p></Row></Group></section>
      <section className="mb-7"><SectionHeading title="What actually arrived" action={<Badge>{exceptionCount === 0 ? "No exceptions" : `${exceptionCount} exception${exceptionCount === 1 ? "" : "s"}`}</Badge>} />
        <div className="mb-4 rounded-2xl border border-border bg-card p-4"><p className="text-sm font-semibold">Normal case</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">If the delivery was complete, one click records the confirmation and prepares the proposal. Food OS supplies the delivery evidence metadata automatically.</p><Button type="button" className="mt-3" onClick={allArrived}>✓ Everything arrived</Button>{confirmed ? <p className="mt-2 text-xs font-medium">Confirmed. Review the exact proposed events below before approving them.</p> : null}</div>
        <Group>{lines.map((line, index) => <Row key={line.lineId}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">{line.productName}</p><p className="mt-1 text-xs text-muted-foreground">{line.orderedQuantity} {line.unit} · {line.itemKey}</p></div><div className="flex flex-wrap gap-2">{(["ARRIVED", "MISSING", "SUBSTITUTED"] as const).map((state) => <Button key={state} type="button" variant={line.state === state ? "default" : "outline"} onClick={() => updateLine(index, { state, replacementItemKey: state === "SUBSTITUTED" ? line.replacementItemKey : "" })}>{state === "ARRIVED" ? "Arrived" : state === "MISSING" ? "Missing" : "Substituted"}</Button>)}</div></div>{line.state === "SUBSTITUTED" ? <Input className="mt-3" aria-label={`Replacement for ${line.productName}`} value={line.replacementItemKey} onChange={(e) => updateLine(index, { replacementItemKey: e.target.value })} placeholder="Canonical household item that arrived" /> : null}</Row>)}</Group>
        {exceptionCount > 0 ? <div className="mt-3"><Button type="button" onClick={() => prepare(lines)}>Prepare household events</Button></div> : null}
      </section>
    </> : null}
    {result ? <section className="mb-7"><SectionHeading title="Food OS proposal" action={result.ok ? <Badge><CheckCircle2 className="mr-1 size-3" /> Ready for review</Badge> : <Badge variant="destructive"><TriangleAlert className="mr-1 size-3" /> Refused</Badge>} />{result.ok ? <><p className="mb-3 text-sm text-muted-foreground">Nothing has been written. These are the exact canonical events that would be handed to the existing protected writer.</p><Group>{result.records.map((record) => <Row key={record.eventId}><p className="text-sm font-semibold">{record.row["Event type"] as string} · {record.row.Item as string}</p><p className="mt-1 break-all text-xs text-muted-foreground">Event {record.eventId} · payload {record.payloadHash}</p></Row>)}</Group><Evidence label="Why nothing changed">Preparing this proposal is non-mutating. Explicit human approval bound to the exact Event ID and payload hash is still required before household state can change.</Evidence></> : <Evidence label="Why it was refused">{result.detail}</Evidence>}</section> : null}
    <p className="text-xs leading-relaxed text-muted-foreground">Supermarket checkout remains manual. Delivery confirmation is a household-state input; substitutions are reconciled as the actual item received, and the same governed intake model can represent food brought home outside a supermarket delivery.</p>
  </Shell><AppFooter /></div>;
}
