import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { AppFooter, AppHeader } from "@/components/app-header";
import { Evidence, Group, PageTitle, Pill, Row, SectionHeading, Shell } from "@/components/household/household-ui";
import { getCanonicalBasketForShop } from "@/lib/procurement/canonical-basket.functions";
import type { CanonicalBasketReadResult } from "@/lib/procurement/canonical-basket";
import { getDeliveryBasket } from "@/lib/procurement/delivery-basket.functions";
import type { DeliveryBasketRead } from "@/lib/procurement/delivery-basket.functions";
import { getOperatorWeek, startOperatorSession } from "@/lib/operator-week.functions";

export const Route = createFileRoute("/cycle")({
  head: () => ({ meta: [{ title: "Weekly cycle — foodOS" }, { name: "description", content: "A read-only view of this week's menu, basket and delivery state, with explicit household actions." }] }),
  component: CyclePage,
});

type WeekData = Awaited<ReturnType<typeof getOperatorWeek>> & { meals?: Array<{ id?: unknown; meal?: unknown; date?: unknown }> };

function statusLabel(value: string | undefined) {
  return value ? value.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Not available";
}

function CyclePage() {
  const [week, setWeek] = useState<WeekData | null>(null);
  const [basket, setBasket] = useState<CanonicalBasketReadResult | null>(null);
  const [delivery, setDelivery] = useState<DeliveryBasketRead | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const results = await Promise.allSettled([getOperatorWeek(), getCanonicalBasketForShop(), getDeliveryBasket()]);
    const weekResult = results[0];
    const basketResult = results[1];
    const deliveryResult = results[2];
    if (weekResult.status === "fulfilled" && weekResult.value.ok) setWeek(weekResult.value as WeekData);
    else setWeek(null);
    if (basketResult.status === "fulfilled") setBasket(basketResult.value);
    if (deliveryResult.status === "fulfilled") setDelivery(deliveryResult.value);
    if (weekResult.status === "rejected" || (weekResult.status === "fulfilled" && !weekResult.value.ok)) {
      setError(weekResult.status === "fulfilled" ? weekResult.value.error ?? "Weekly read unavailable" : String(weekResult.reason));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    setConnecting(true);
    try {
      const result = await startOperatorSession({ data: { token } });
      if (!result.ok) throw new Error(result.error ?? "Operator authentication failed");
      setToken("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnecting(false);
    }
  };

  const meals = week?.meals ?? [];
  const basketStatus = basket?.status === "READY" ? basket.approval?.status ?? "READY" : basket?.status;
  const deliveryStatus = delivery?.status === "READY" ? delivery.approval?.status ?? "READY" : delivery?.status;

  return <div className="ctl-page"><AppHeader eyebrow="Household" /><Shell>
    <PageTitle eyebrow="Weekly cycle" title="Everything foodOS is doing this week" lede="One read-only control surface for the menu, shopping basket and delivery state. Planned meals never count as consumed stock." />

    {!week ? <section className="mb-7 rounded-2xl bg-[var(--ctl-surface-sunken)] p-5"><SectionHeading title="Connect FoodOS" /><p className="text-[13px] leading-relaxed text-muted-foreground">Use the same short-lived operator credential as the weekly planning surface. Nothing here writes household state.</p><div className="mt-4 flex gap-2"><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Operator credential" className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" autoComplete="off" /><button type="button" onClick={() => void connect()} disabled={connecting || !token.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{connecting ? "Connecting…" : "Connect"}</button></div>{error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}</section> : null}

    <section className="mb-7"><SectionHeading title="Menu" action={<Pill tone={meals.length ? "good" : "neutral"}>{meals.length} planned</Pill>} /><Group>{meals.length ? meals.map((meal) => <Row key={String(meal.id)}><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(String(meal.date)))}</p><p className="mt-1 text-[15px] font-semibold">{String(meal.meal)}</p></div><Pill tone="neutral">Planned</Pill></div></Row>) : <Row><p className="text-sm text-muted-foreground">No current-week meals are available from the live planning read.</p></Row>}</Group><p className="mt-3 text-[13px] text-muted-foreground">The menu is planning intent only. FoodOS does not infer that ingredients were consumed because a meal is scheduled.</p></section>

    <section className="mb-7"><SectionHeading title="Shopping / basket" action={<Pill tone={basketStatus === "APPROVED" ? "good" : "attention"}>{statusLabel(basketStatus)}</Pill>} /><Group><Row><div className="flex items-center justify-between gap-3"><div><p className="text-[15px] font-semibold">{basket?.status === "READY" ? basket.basket.retailer : "Basket"}</p><p className="mt-1 text-[13px] text-muted-foreground">{basket?.status === "READY" ? `${basket.basket.lines.length} lines · version ${basket.approval.basketVersion}` : basket?.detail ?? "Live basket state unavailable."}</p></div><Link to="/shop" className="text-[13px] font-medium text-primary underline-offset-4 hover:underline">Open shop</Link></div></Row></Group></section>

    <section className="mb-7"><SectionHeading title="Delivery / reconciliation" action={<Pill tone={deliveryStatus === "APPROVED" ? "good" : "attention"}>{statusLabel(deliveryStatus)}</Pill>} /><Group><Row><div className="flex items-center justify-between gap-3"><div><p className="text-[15px] font-semibold">{delivery?.status === "READY" ? delivery.basket.retailer : "Delivery"}</p><p className="mt-1 text-[13px] text-muted-foreground">{delivery?.status === "READY" ? "Human confirmation and delivery reconciliation are handled on the delivery surface." : delivery?.detail ?? "Live delivery state unavailable."}</p></div><Link to="/delivery" className="text-[13px] font-medium text-primary underline-offset-4 hover:underline">Open delivery</Link></div></Row></Group></section>

    <section className="mb-7"><SectionHeading title="Household actions" /><Group><Row><div className="flex flex-wrap gap-2"><Link to="/stock" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Update stock</Link><Link to="/sweep" className="rounded-md border px-3 py-2 text-sm font-medium">Quick stock sweep</Link><Link to="/feedback" className="rounded-md border px-3 py-2 text-sm font-medium">Tell FoodOS</Link></div><p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">Use an explicit stock or feedback action when something changes. These actions do not silently convert planned meals into consumption.</p></Row></Group></section>

    <Evidence label="State boundary">This page is read-only. Menu, basket and delivery status are surfaced from the existing household/procurement paths; household changes remain explicit human actions behind their existing authority boundaries.</Evidence>
  </Shell><AppFooter /></div>;
}
