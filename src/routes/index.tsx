import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, ShoppingBasket, Sparkles, UtensilsCrossed } from "lucide-react";

import homeHero from "@/assets/home-hero.jpg";
import { AppFooter, AppHeader } from "@/components/app-header";
import {
  Evidence,
  Group,
  Pill,
  Row,
  SectionHeading,
  Shell,
} from "@/components/household/household-ui";
import { Button } from "@/components/ui/button";
import { getCanonicalBasketForShop } from "@/lib/procurement/canonical-basket.functions";
import type { CanonicalBasketReadResult } from "@/lib/procurement/canonical-basket";
import { describeBasketStatus } from "@/lib/household-view/basket-status";
import { describeProvision } from "@/lib/household-view/provision-state";
import {
  basketHeldBack,
  tonight,
  week,
  worked_out,
} from "@/lib/household-view/demo";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "foodOS — your household food operation" },
      {
        name: "description",
        content:
          "foodOS keeps your household food under control: what's happening tonight, what the week looks like, what you already have, and one basket to review. Nothing is ordered from this app.",
      },
      { property: "og:title", content: "foodOS — your household food operation" },
      {
        property: "og:description",
        content:
          "Tonight's meal, this week's rhythm, what you already have and one basket to review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const [basketState, setBasketState] = useState<CanonicalBasketReadResult | null>(null);
  const cooked = week.filter((d) => d.state === "Cooked").length;
  const needsShopping = week.filter((d) => d.coverage === "Needs shopping").length;
  const attention = basketHeldBack[0];
  const status = describeBasketStatus(basketState);
  const provision = describeProvision({
    basket: basketState,
    daysNeedingShopping: needsShopping,
    uncertainItemLabel: attention ? attention.label : null,
  });
  const canonicalReady = basketState?.status === "READY";
  const canonicalBasket = canonicalReady ? basketState.basket : null;


  const refreshBasket = useCallback(async () => {
    try {
      setBasketState(await getCanonicalBasketForShop());
    } catch (error) {
      setBasketState({
        status: "NOT_READY",
        source: "UNAVAILABLE",
        reason: "CONNECTOR_READ_FAILED",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    void refreshBasket();
  }, [refreshBasket]);

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" />

      <main>
        <Shell>
          <section className="ctl-hero overflow-hidden">
            <div className="relative h-20 w-full sm:h-40">
              <img
                src={homeHero}
                alt="A bright kitchen counter with fresh greens and a bowl of grains"
                width={1280}
                height={960}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="p-5 sm:p-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                {tonight.weekday} · your week
              </p>
              <h1 className="mt-1.5 font-display text-[28px] font-semibold leading-[1.12] tracking-tight sm:text-[40px]">
                {provision.line1}
              </h1>
              <p className="mt-1.5 text-[15px] leading-snug text-muted-foreground sm:text-base">
                {provision.line2}
              </p>

              <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[calc(var(--ctl-radius))] bg-card px-3.5 py-3 shadow-[var(--ctl-shadow)] ring-1 ring-border/50">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
                  <UtensilsCrossed className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Tonight
                  </span>
                  <span className="mt-0.5 block text-[16px] font-semibold leading-snug">
                    {tonight.meal}
                  </span>
                </span>
                <Pill tone="good">{tonight.coverage}</Pill>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
                {provision.primary ? (
                  <Button asChild size="lg" className="rounded-full px-6">
                    <Link to={provision.primary.to}>
                      {provision.primary.label}
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                ) : null}

                {provision.secondary ? (
                  <Button asChild size="lg" variant="secondary" className="rounded-full px-6">
                    <Link to={provision.secondary.to}>{provision.secondary.label}</Link>
                  </Button>
                ) : null}
              </div>

              <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">{cooked} cooked</span> ·{" "}
                {week.length - cooked} still planned
                {needsShopping > 0 ? (
                  <>
                    {" "}
                    · <span className="text-[var(--ctl-amber-deep)]">{needsShopping} needs shopping</span>
                  </>
                ) : null}
              </p>
            </div>
          </section>

          {attention ? (
            <section className="mt-8">
              <SectionHeading title="Needs you" />
              <Group className="ring-[color-mix(in_oklab,var(--ctl-amber)_45%,transparent)]">
                <Link to="/sweep" className="block transition-colors hover:bg-secondary/60">
                  <Row>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold">{attention.label} is uncertain</p>
                        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                          {attention.reason}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </Row>
                </Link>
              </Group>
            </section>
          ) : null}

          <section className="mt-8">
            <SectionHeading
              title={provision.shoppingHeading}
              action={
                canonicalReady ? (
                  <Link
                    to="/shop"
                    className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Review
                  </Link>
                ) : undefined
              }
            />
            <Group>
              <Row>
                {canonicalReady && canonicalBasket ? (
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                      <ShoppingBasket className="h-4.5 w-4.5" />
                    </span>
                    <span className="min-w-0 text-[14px] leading-snug text-muted-foreground">
                      {canonicalBasket.lines.length} things to buy, ready when you are
                    </span>
                    <span className="shrink-0 font-display text-[17px] font-semibold">
                      £{canonicalBasket.totalCost.toFixed(2)}
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                      <ShoppingBasket className="h-4.5 w-4.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] leading-snug text-muted-foreground">
                        {provision.shoppingBody}
                      </span>
                      {status.blocker ? (
                        <details className="group mt-1">
                          <summary className="cursor-pointer list-none text-[13px] text-muted-foreground underline-offset-4 hover:underline">
                            Why not?
                          </summary>
                          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                            {status.blocker}
                          </p>
                        </details>
                      ) : null}
                    </span>
                  </div>
                )}
              </Row>
            </Group>
          </section>

          <section className="mt-8">
            <SectionHeading title="What foodOS worked out" />
            <Group>
              {worked_out.map((item) => (
                <Row key={item.title}>
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--ctl-green-deep)]" />
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold leading-snug">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
                        {item.detail}
                      </span>
                    </span>
                  </div>
                </Row>
              ))}
            </Group>

            <Evidence label="Show the engineering behind this">
              This week, tonight&rsquo;s meal and the counts on this page are an example household on
              synthetic data; only the basket is read from your canonical records. Household state is
              replayed deterministically from an immutable event stream. Duplicate deliveries are
              idempotent, reused IDs with different payloads are blocked, and uncertain items are
              isolated rather than guessed. Replay IDs, provenance and reconciliation exceptions live
              in{" "}
              <Link to="/system" className="underline">
                System
              </Link>
              .
            </Evidence>
          </section>

          <section className="mt-8">
            <Link
              to="/system"
              className="flex items-center justify-between gap-3 rounded-[calc(var(--ctl-radius)+0.15rem)] bg-[var(--ctl-surface-sunken)] px-5 py-4 transition-colors hover:bg-secondary"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[14px] font-semibold">
                  <Sparkles className="h-4 w-4 text-primary" /> Simple outside. Serious inside.
                </span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  Replay, evidence and safety boundaries — all inspectable.
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </section>
        </Shell>
      </main>

      <AppFooter />
    </div>
  );
}
