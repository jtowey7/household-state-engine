import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, ShoppingBasket, Sparkles, UtensilsCrossed } from "lucide-react";

import homeHero from "@/assets/home-hero.jpg";
import { AppFooter, AppHeader } from "@/components/app-header";
import {
  Evidence,
  Group,
  PageTitle,
  Pill,
  Row,
  SectionHeading,
  Shell,
} from "@/components/household/household-ui";
import { Button } from "@/components/ui/button";
import {
  basket,
  basketHeldBack,
  basketTotal,
  money,
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
          "foodOS keeps your household food under control: what's happening tonight, what the week looks like, what you already have, and one basket to approve. Nothing is bought without you.",
      },
      { property: "og:title", content: "foodOS — your household food operation" },
      {
        property: "og:description",
        content:
          "Tonight's meal, this week's rhythm, what you already have and one basket to approve.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const cooked = week.filter((d) => d.state === "Cooked").length;
  const needsShopping = week.filter((d) => d.coverage === "Needs shopping").length;
  const attention = basketHeldBack[0];

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" />

      <main>
        <Shell>
          {/* First viewport: what matters this week */}
          <section className="ctl-hero overflow-hidden">
            <div className="relative h-40 w-full sm:h-52">
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
                Your week
              </p>
              <h1 className="mt-2 font-display text-[27px] font-semibold leading-[1.15] tracking-tight sm:text-4xl">
                Food is under control.
                <br />
                One decision left.
              </h1>
              <div className="mt-4 flex flex-wrap gap-2">
                <Pill tone="good">{cooked} meals cooked</Pill>
                <Pill tone="neutral">{week.length - cooked} still planned</Pill>
                {needsShopping > 0 ? <Pill tone="attention">{needsShopping} needs shopping</Pill> : null}
              </div>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <Button asChild size="lg" className="rounded-full px-6">
                  <Link to="/shop">
                    Review basket · {money(basketTotal)} <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary" className="rounded-full px-6">
                  <Link to="/week">See the week</Link>
                </Button>
              </div>
            </div>
          </section>

          {/* Tonight */}
          <section className="mt-8">
            <SectionHeading title="Tonight" action={<Pill tone="accent">{tonight.day}</Pill>} />
            <Group>
              <Row>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
                    <UtensilsCrossed className="h-4.5 w-4.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[16px] font-semibold leading-snug">
                      {tonight.meal}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
                      {tonight.note}
                    </span>
                  </span>
                </div>
              </Row>
            </Group>
          </section>

          {/* Attention */}
          {attention ? (
            <section className="mt-8">
              <SectionHeading title="Needs you" />
              <Group className="ring-[color-mix(in_oklab,var(--ctl-amber)_45%,transparent)]">
                <Row>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">{attention.label} is uncertain</p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                        {attention.reason}
                      </p>
                    </div>
                    <Pill tone="attention">1</Pill>
                  </div>
                  <Button asChild variant="secondary" size="sm" className="mt-3 rounded-full">
                    <Link to="/sweep">Settle it in a few taps</Link>
                  </Button>
                </Row>
              </Group>
            </section>
          ) : null}

          {/* Basket summary */}
          <section className="mt-8">
            <SectionHeading
              title="Ready to buy"
              action={
                <Link
                  to="/shop"
                  className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
                >
                  Review
                </Link>
              }
            />
            <Group>
              <Row>
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                    <ShoppingBasket className="h-4.5 w-4.5" />
                  </span>
                  <span className="min-w-0 text-[14px] leading-snug text-muted-foreground">
                    {basket.length} lines, all traced to a planned meal
                  </span>
                  <span className="shrink-0 font-display text-[17px] font-semibold">
                    {money(basketTotal)}
                  </span>
                </div>
              </Row>
            </Group>
          </section>

          {/* What foodOS worked out */}
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
              Household state is replayed deterministically from an immutable event stream. Duplicate
              deliveries are idempotent, reused IDs with different payloads are blocked, and
              uncertain items are isolated rather than guessed. Replay IDs, provenance and
              reconciliation exceptions live in{" "}
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
