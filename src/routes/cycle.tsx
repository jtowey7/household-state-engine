import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { AppFooter, AppHeader } from "@/components/app-header";
import { Group, PageTitle, Pill, Row, SectionHeading, Shell } from "@/components/household/household-ui";
import { getCanonicalBasketForShop } from "@/lib/procurement/canonical-basket.functions";
import type { CanonicalBasketReadResult } from "@/lib/procurement/canonical-basket";
import { getDeliveryBasket } from "@/lib/procurement/delivery-basket.functions";
import type { DeliveryBasketRead } from "@/lib/procurement/delivery-basket.functions";
import { getOperatorWeek, startOperatorSession } from "@/lib/operator-week.functions";
import { describeCycle } from "@/lib/household-view/cycle-state";

export const Route = createFileRoute("/cycle")({
  head: () => ({ meta: [{ title: "This week — foodOS" }, { name: "description", content: "A simple view of the family's menu, shopping and delivery for this week." }] }),
  component: CyclePage,
});

type WeekData = Awaited<ReturnType<typeof getOperatorWeek>> & { meals?: Array<{ id?: unknown; meal?: unknown; date?: unknown }> };

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
    if (weekResult.status === "fulfilled" && weekResult.value['ok']) setWeek(weekResult.value as WeekData);
    else setWeek(null);
    if (basketResult.status === "fulfilled") setBasket(basketResult.value);
    if (deliveryResult.status === "fulfilled") setDelivery(deliveryResult.value);
    if (weekResult.status === "rejected" || (weekResult.status === "fulfilled" && !weekResult.value['ok'])) {
      setError(weekResult.status === "fulfilled" ? (typeof weekResult.value['error'] === "string" ? (weekResult.value['error'] as string) : "We couldn't load this week") : String(weekResult.reason));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    setConnecting(true);
    try {
      const result = await startOperatorSession({ data: { token } });
      if (!result.ok) throw new Error(result.error ?? "We couldn't connect");
      setToken("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnecting(false);
    }
  };

  const meals = week?.meals ?? [];
  const basketReady = basket?.status === "READY";
  const basketApproved = basketReady && basket.approval?.status === "APPROVED";
  const deliveryReady = delivery?.status === "READY";
  const deliveryApproved = deliveryReady && delivery.approval?.status === "APPROVED";
  // Receipt is never inferred. Nothing in the current delivery read records that
  // the delivery physically arrived and was reconciled, so the household stays
  // on "check what arrived" until that evidence exists.
  const receiptConfirmed = false;
  const cycle = describeCycle({
    shopReady: Boolean(basketReady),
    shopApproved: Boolean(basketApproved),
    deliveryKnown: Boolean(deliveryReady),
    deliveryApproved: Boolean(deliveryApproved),
    receiptConfirmed,
  });

  return <div className="ctl-page"><AppHeader eyebrow="Your food" /><Shell>
    <PageTitle eyebrow="This week" title="Food, sorted." lede="What's for dinner, what's coming in, and what needs your attention — all in one place." />

    {!week ? <section className="mb-7 rounded-2xl bg-[var(--ctl-surface-sunken)] p-5"><SectionHeading title="Let's get your week" /><p className="text-[13px] leading-relaxed text-muted-foreground">Connect to see your family's current plan.</p><div className="mt-4 flex gap-2"><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Connection code" className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" autoComplete="off" /><button type="button" onClick={() => void connect()} disabled={connecting || !token.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{connecting ? "Connecting…" : "Connect"}</button></div>{error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}</section> : null}

    <section className="mb-7 rounded-2xl bg-[var(--ctl-surface-sunken)] p-5"><SectionHeading title="Next up" /><p className="mt-2 text-[15px] font-medium">{cycle.action.label}</p><Link to={cycle.action.to} className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Open</Link></section>

    <section className="mb-7"><div className="flex items-center justify-between gap-3"><SectionHeading title="What's for dinner?" action={<Pill tone={meals.length ? "good" : "neutral"}>{meals.length} meals</Pill>} /></div><Group>{meals.length ? meals.map((meal) => <Row key={String(meal.id)}><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(String(meal.date)))}</p><p className="mt-1 text-[15px] font-semibold">{String(meal.meal)}</p></div></div></Row>) : <Row><p className="text-sm text-muted-foreground">No meals are showing for this week yet.</p></Row>}</Group><p className="mt-3 text-[13px] text-muted-foreground">Your meal plan never changes what's actually in your kitchen.</p></section>

    <section className="mb-7"><SectionHeading title="Shopping" action={<Pill tone={cycle.tone}>{cycle.stage === "ALL_SETTLED" ? "Done" : "Needs you"}</Pill>} /><Group><Row><div className="flex items-center justify-between gap-3"><div><p className="text-[15px] font-semibold">{basket?.status === "READY" ? basket.basket.retailer : "This week's shop"}</p><p className="mt-1 text-[13px] text-muted-foreground">{basketReady ? `${basket.basket.lines.length} things to buy · ${cycle.shopping}` : cycle.shopping}</p></div><Link to="/shop" className="text-[13px] font-medium text-primary underline-offset-4 hover:underline">View</Link></div></Row></Group></section>

    <section className="mb-7"><SectionHeading title="Delivery" action={<Pill tone={cycle.tone}>{cycle.stage === "ALL_SETTLED" ? "Counted in" : "Not counted in yet"}</Pill>} /><Group><Row><div className="flex items-center justify-between gap-3"><div><p className="text-[15px] font-semibold">{delivery?.status === "READY" ? delivery.basket.retailer : "Your delivery"}</p><p className="mt-1 text-[13px] text-muted-foreground">{cycle.delivery}</p></div><Link to="/delivery" className="text-[13px] font-medium text-primary underline-offset-4 hover:underline">Check</Link></div></Row></Group></section>

    <section className="mb-7"><SectionHeading title="Something changed?" /><Group><Row><div className="flex flex-wrap gap-2"><Link to="/food" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Update food</Link><Link to="/feedback" className="rounded-md border px-3 py-2 text-sm font-medium">Tell FoodOS</Link></div><p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">If something changed, tell FoodOS rather than leaving it to guess.</p></Row></Group></section>

    <p className="pb-4 text-center text-[12px] text-muted-foreground">You stay in control of changes to the food at home.</p>
  </Shell><AppFooter /></div>;
}
