import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, ShieldCheck, TriangleAlert } from "lucide-react";

import { AppHeader, AppFooter } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Evidence, Group, PageTitle, Row, SectionHeading, Shell } from "@/components/household/household-ui";
import { prepareHouseholdIntake } from "@/lib/household-input/intake";

export const Route = createFileRoute("/delivery")({
  head: () => ({
    meta: [
      { title: "Record a delivery — foodOS" },
      {
        name: "description",
        content: "Record a reconciled delivery and review the exact household events Food OS proposes before any state change.",
      },
    ],
  }),
  component: DeliveryPage,
});

type Line = { lineId: string; itemKey: string; quantity: string; unit: string; substituted: boolean };

const createLine = (): Line => ({
  lineId: crypto.randomUUID(),
  itemKey: "",
  quantity: "",
  unit: "pack",
  substituted: false,
});

function DeliveryPage() {
  const [basketId, setBasketId] = useState("");
  const [orderReference, setOrderReference] = useState("");
  const [retailer, setRetailer] = useState("Tesco");
  const [capturedBy, setCapturedBy] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  const [dispatchId, setDispatchId] = useState("");
  const [basketVersion, setBasketVersion] = useState("1");
  const [basketFingerprint, setBasketFingerprint] = useState("");
  const [deliveredAt, setDeliveredAt] = useState("");
  const [lines, setLines] = useState<Line[]>([createLine()]);
  const [result, setResult] = useState<ReturnType<typeof prepareHouseholdIntake> | null>(null);

  const updateLine = (index: number, patch: Partial<Line>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const prepare = () => {
    const capturedDate = new Date(capturedAt);
    const deliveredDate = new Date(deliveredAt);
    if (Number.isNaN(capturedDate.getTime()) || Number.isNaN(deliveredDate.getTime())) {
      setResult({
        ok: false,
        code: "INVALID_EVIDENCE",
        detail: "Recorded-at and delivered-at must both contain valid dates before the delivery can be prepared.",
      });
      return;
    }

    setResult(
      prepareHouseholdIntake(
        {
          kind: "DELIVERY",
          input: {
            basketId,
            orderReference,
            retailer,
            capturedAt: capturedDate.toISOString(),
            capturedBy,
            delivery: {
              deliveryId,
              dispatchId,
              basketId,
              basketVersion: Number(basketVersion),
              basketFingerprint,
              deliveredAt: deliveredDate.toISOString(),
              reconciliationStatus: "RECONCILED",
              lines: lines.map((line) => ({
                lineId: line.lineId,
                itemKey: line.itemKey,
                deliveredQuantity: Number(line.quantity),
                unit: line.unit,
                substituted: line.substituted,
              })),
            },
          },
        },
        { now: () => new Date().toISOString() },
      ),
    );
  };

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" />
      <Shell>
        <Link to="/food" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to food
        </Link>

        <PageTitle
          eyebrow="After you shop"
          title="Record a delivery"
          lede="Tell foodOS what actually arrived. It will prepare the exact household events for review — it will not quietly change your stock."
        />

        <div className="mb-6 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">Human-controlled state change</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                This screen only prepares canonical HOUSEHOLD EVENTS. An exact human approval is still required before the protected writer can append anything to household state.
              </p>
            </div>
          </div>
        </div>

        <section className="mb-7">
          <SectionHeading title="Purchase and delivery" />
          <Group>
            <Row><label className="text-xs font-medium">Basket ID<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={basketId} onChange={(e) => setBasketId(e.target.value)} placeholder="basket-alpha-v1" /></label></Row>
            <Row><label className="text-xs font-medium">Order reference<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={orderReference} onChange={(e) => setOrderReference(e.target.value)} placeholder="Tesco order reference" /></label></Row>
            <Row><label className="text-xs font-medium">Retailer<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={retailer} onChange={(e) => setRetailer(e.target.value)} /></label></Row>
            <Row><label className="text-xs font-medium">Delivery ID<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)} placeholder="delivery-alpha-001" /></label></Row>
            <Row><label className="text-xs font-medium">Dispatch ID<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={dispatchId} onChange={(e) => setDispatchId(e.target.value)} placeholder="dispatch-alpha-001" /></label></Row>
            <Row><label className="text-xs font-medium">Basket version<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={basketVersion} onChange={(e) => setBasketVersion(e.target.value)} inputMode="numeric" /></label></Row>
            <Row><label className="text-xs font-medium">Basket fingerprint<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={basketFingerprint} onChange={(e) => setBasketFingerprint(e.target.value)} placeholder="Exact approved basket fingerprint" /></label></Row>
            <Row><label className="text-xs font-medium">Delivered at<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" type="datetime-local" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} /></label></Row>
            <Row><label className="text-xs font-medium">Recorded by<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={capturedBy} onChange={(e) => setCapturedBy(e.target.value)} placeholder="Person recording the delivery" /></label></Row>
            <Row><label className="text-xs font-medium">Recorded at<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" type="datetime-local" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} /></label></Row>
          </Group>
        </section>

        <section className="mb-7">
          <SectionHeading title="What actually arrived" action={<Badge variant="outline">Reconciled delivery</Badge>} />
          <Group>
            {lines.map((line, index) => (
              <Row key={line.lineId}>
                <div className="grid gap-2 sm:grid-cols-[1.4fr_.7fr_.7fr_auto]">
                  <Input aria-label="Item" value={line.itemKey} onChange={(e) => updateLine(index, { itemKey: e.target.value })} placeholder="Canonical household item" />
                  <Input aria-label="Quantity" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} placeholder="Qty" inputMode="decimal" />
                  <Input aria-label="Unit" value={line.unit} onChange={(e) => updateLine(index, { unit: e.target.value })} placeholder="Unit" />
                  <Button type="button" variant="outline" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>Remove</Button>
                </div>
                <label className="mt-2 inline-flex items-center gap-2 text-xs font-medium">
                  <Checkbox checked={line.substituted} onCheckedChange={(checked) => updateLine(index, { substituted: checked === true })} />
                  Item was substituted
                </label>
              </Row>
            ))}
          </Group>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, createLine()])}>Add another item</Button>
            <Button type="button" onClick={prepare}>Prepare household events</Button>
          </div>
        </section>

        {result ? (
          <section className="mb-7">
            <SectionHeading title="Food OS proposal" action={result.ok ? <Badge><CheckCircle2 className="mr-1 size-3" /> Ready for review</Badge> : <Badge variant="destructive"><TriangleAlert className="mr-1 size-3" /> Refused</Badge>} />
            {result.ok ? (
              <>
                <p className="mb-3 text-sm text-muted-foreground">Nothing has been written. These are the exact canonical events and approval scopes that would be handed to the existing protected writer.</p>
                <Group>
                  {result.records.map((record) => (
                    <Row key={record.eventId}>
                      <p className="text-sm font-semibold">{record.row["Event type"] as string} · {record.row.Item as string}</p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">Event {record.eventId} · payload {record.payloadHash}</p>
                    </Row>
                  ))}
                </Group>
                <Evidence label="Why nothing changed">Preparing this proposal is non-mutating. Food OS still requires explicit human approval bound to the exact Event ID and payload hash before the protected append boundary can write household state.</Evidence>
              </>
            ) : (
              <Evidence label="Why it was refused">{result.detail}</Evidence>
            )}
          </section>
        ) : null}

        <p className="text-xs leading-relaxed text-muted-foreground">
          This is the human-operated post-purchase boundary. Supermarket checkout remains outside foodOS; delivery results are supplied by the human and then reconciled through the existing governed state model.
        </p>
      </Shell>
      <AppFooter />
    </div>
  );
}
