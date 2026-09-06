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
  const [orderReference, setOrderReference] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  const [dispatchId, setDispatchId] = useState("");
  const [deliveredAt, setDeliveredAt] = useState("");
  const [capturedBy, setCapturedBy] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [result, setResult] = useState<ReturnType<typeof prepareHouseholdIntake> | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let active = true;
    getCanonicalBasketForShop().then((read) => {
      if (!active) return;
      setBasket(read);
      if (read.status === "READY") {
        setLines(read.basket.lines.map((line, index) => ({ lineId: `${read.basket.basketId}:${index + 1}`, itemKey: line.itemKey, productName: line.productName, orderedQuantity: line.orderedQuantity, unit: line.packUnit, state: "ARRIVED", replacementItemKey: "" })));
        setDeliveredAt(new Date().toISOString().slice(0, 16));
      }
    }).catch((error) => { if (active) setLoadError(error instanceof Error ? error.message : "Unable to load the approved basket."); });
    return () => { active = false; };
  }, []);

  const updateLine = (index: number, patch: Partial<Line>) => setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const allArrived = () => { setLines((current) => current.map((line) => ({ ...line, state: "ARRIVED", replacementItemKey: "" }))); setConfirmed(true); setResult(null); };
  const exceptionCount = useMemo(() => lines.filter((line) => line.state !== "ARRIVED").length, [lines]);

  const prepare = () => {
    if (!basket || basket.status !== "READY") return;
    const capturedAt = new Date().toISOString();
    const deliveredDate = new Date(deliveredAt);
    if (!capturedBy.trim() || !orderReference.trim() || !deliveryId.trim() || !dispatchId.trim()) { setResult({ ok: false, code: "INVALID_EVIDENCE", detail: "Order reference, delivery ID, dispatch ID and recorder are required before the delivery can be prepared." }); return; }
    if (Number.isNaN(deliveredDate.getTime())) { setResult({ ok: false, code: "INVALID_EVIDENCE", detail: "Delivered-at must contain a valid date before the delivery can be prepared." }); return; }
    if (lines.length === 0) { setResult({ ok: false, code: "INVALID_EVIDENCE", detail: "The approved basket contains no lines; refusing to create an empty delivery." }); return; }
    const unresolvedSubstitution = lines.find((line) => line.state === "SUBSTITUTED" && !line.replacementItemKey.trim());
    if (unresolvedSubstitution) { setResult({ ok: false, code: "INVALID_EVIDENCE", detail: `A replacement canonical item is required for ${unresolvedSubstitution.productName}.` }); return; }
    setResult(prepareHouseholdIntake({ kind: "DELIVERY", input: { basketId: basket.basket.basketId, orderReference: orderReference.trim(), retailer: basket.basket.retailer, capturedAt, capturedBy: capturedBy.trim(), delivery: { deliveryId: deliveryId.trim(), dispatchId: dispatchId.trim(), basketId: basket.basket.basketId, basketVersion: basket.approval.basketVersion ?? 1, basketFingerprint: basket.approval.basketFingerprint ?? "", deliveredAt: deliveredDate.toISOString(), reconciliationStatus: "RECONCILED", lines: lines.filter((line) => line.state !== "MISSING").map((line) => ({ lineId: line.lineId, itemKey: line.state === "SUBSTITUTED" ? line.replacementItemKey.trim() : line.itemKey, expectedItemKey: line.state === "SUBSTITUTED" ? line.itemKey : undefined, deliveredQuantity: line.orderedQuantity, unit: line.unit, substituted: line.state === "SUBSTITUTED" })) } } }, { now: () => new Date().toISOString() }));
  };

  const basketReady = basket?.status === "READY";
  return (
    <div className="ctl-page"><AppHeader eyebrow="Household" /><Shell>
      <Link to="/food" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to food</Link>
      <PageTitle eyebrow="After you shop" title="Did the delivery arrive?" lede="Food OS starts from the approved basket and assumes everything arrived. You only need to tell it about exceptions." />
      <div className="mb-6 rounded-2xl border border-border bg-card p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" /><div><p className="text-sm font-semibold">Human-controlled state change</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Confirming a delivery prepares canonical HOUSEHOLD EVENTS only. Nothing is written to Production until the exact proposed events receive explicit human approval.</p></div></div></div>
      {loadError ? <Evidence label="Basket could not be loaded">{loadError}</Evidence> : null}
      {!loadError && !basket ? <p className="text-sm text-muted-foreground">Loading the approved basket…</p> : null}
      {basket && basket.status !== "READY" ? <Evidence label="Delivery unavailable">{basket.detail}</Evidence> : null}
      {basketReady ? <>
        <section className="mb-7"><SectionHeading title="Approved shop" action={<Badge variant="outline">{basket.basket.retailer}</Badge>} /><Group>
          <Row><p className="text-sm font-semibold">{basket.basket.basketId}</p><p className="mt-1 text-xs text-muted-foreground">Approved basket · version {basket.approval.basketVersion} · {basket.basket.lines.length} lines</p></Row>
          <Row><label className="text-xs font-medium">Order reference<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={orderReference} onChange={(e) => setOrderReference(e.target.value)} placeholder="Your supermarket order reference" /></label></Row>
          <Row><label className="text-xs font-medium">Delivery ID<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)} placeholder="Delivery identifier" /></label></Row>
          <Row><label className="text-xs font-medium">Dispatch ID<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={dispatchId} onChange={(e) => setDispatchId(e.target.value)} placeholder="Approved dispatch identifier" /></label></Row>
          <Row><label className="text-xs font-medium">Delivered at<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" type="datetime-local" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} /></label></Row>
          <Row><label className="text-xs font-medium">Recorded by<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={capturedBy} onChange={(e) => setCapturedBy(e.target.value)} placeholder="Person confirming the delivery" /></label></Row>
        </Group></section>
        <section className="mb-7"><SectionHeading title="What actually arrived" action={<Badge>{exceptionCount === 0 ? "No exceptions" : `${exceptionCount} exception${exceptionCount === 1 ? "" : "s"}`}</Badge>} />
          <div className="mb-4 rounded-2xl border border-border bg-card p-4"><p className="text-sm font-semibold">Normal case</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">If the delivery was complete, use one click. Food OS will treat every approved basket line as delivered.</p><Button type="button" className="mt-3" onClick={allArrived}>✓ Everything arrived</Button>{confirmed ? <p className="mt-2 text-xs font-medium">Delivery defaults set to arrived. Change only the exceptions below.</p> : null}</div>
          <Group>{lines.map((line, index) => <Row key={line.lineId}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">{line.productName}</p><p className="mt-1 text-xs text-muted-foreground">{line.orderedQuantity} {line.unit} · {line.itemKey}</p></div><div className="flex flex-wrap gap-2">{(["ARRIVED", "MISSING", "SUBSTITUTED"] as const).map((state) => <Button key={state} type="button" variant={line.state === state ? "default" : "outline"} onClick={() => updateLine(index, { state, replacementItemKey: state === "SUBSTITUTED" ? line.replacementItemKey : "" })}>{state === "ARRIVED" ? "Arrived" : state === "MISSING" ? "Missing" : "Substituted"}</Button>)}</div></div>{line.state === "SUBSTITUTED" ? <Input className="mt-3" aria-label={`Replacement for ${line.productName}`} value={line.replacementItemKey} onChange={(e) => updateLine(index, { replacementItemKey: e.target.value })} placeholder="Canonical household item that arrived" /> : null}</Row>)}</Group>
          <div className="mt-3"><Button type="button" onClick={prepare}>Prepare household events</Button></div>
        </section>
      </> : null}
      {result ? <section className="mb-7"><SectionHeading title="Food OS proposal" action={result.ok ? <Badge><CheckCircle2 className="mr-1 size-3" /> Ready for review</Badge> : <Badge variant="destructive"><TriangleAlert className="mr-1 size-3" /> Refused</Badge>} />{result.ok ? <><p className="mb-3 text-sm text-muted-foreground">Nothing has been written. These are the exact canonical events and approval scopes that would be handed to the existing protected writer.</p><Group>{result.records.map((record) => <Row key={record.eventId}><p className="text-sm font-semibold">{record.row["Event type"] as string} · {record.row.Item as string}</p><p className="mt-1 break-all text-xs text-muted-foreground">Event {record.eventId} · payload {record.payloadHash}</p></Row>)}</Group><Evidence label="Why nothing changed">Preparing this proposal is non-mutating. Explicit human approval bound to the exact Event ID and payload hash is still required before the protected append boundary can write household state.</Evidence></> : <Evidence label="Why it was refused">{result.detail}</Evidence>}</section> : null}
      <p className="text-xs leading-relaxed text-muted-foreground">Supermarket checkout remains manual. Delivery confirmation is a household-state input; substitutions are reconciled as the actual item received, and the same governed intake model can also represent food brought home outside a supermarket delivery.</p>
    </Shell><AppFooter /></div>
  );
}
