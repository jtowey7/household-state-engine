import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ShoppingBasket,
  CalendarDays,
  ChefHat,
  CircleCheck,
  Clock3,
  FlaskConical,
  Leaf,
  Package,
  Sparkles,
  ThumbsUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Food OS — the household food operator" },
      {
        name: "description",
        content:
          "Food OS keeps track of what your household has, what you planned to eat, and what needs buying — then hands you a shopping basket to approve. Prototype with synthetic demo data.",
      },
      { property: "og:title", content: "Food OS — the household food operator" },
      {
        property: "og:description",
        content:
          "Meals, inventory, quantities and a basket you approve. A calm household food operator, shown here as a synthetic demo slice.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

/* ---------------------------------------------------------------- *
 * SYNTHETIC EXAMPLE DATA — illustration only.
 * Not connected to any household, retailer or live inventory.
 * ---------------------------------------------------------------- */

const week = [
  { day: "Mon", meal: "Miso butter greens & rice", note: "uses up pak choi", state: "Planned" },
  { day: "Tue", meal: "Roast salmon, new potatoes", note: "salmon 780g in fridge", state: "Cooked" },
  { day: "Wed", meal: "Chickpea & tomato stew", note: "cupboard only", state: "Planned" },
  { day: "Thu", meal: "Leftover stew + flatbread", note: "planned leftovers", state: "Planned" },
  { day: "Fri", meal: "Pizza night", note: "household ritual", state: "Planned" },
  { day: "Sat", meal: "Slow lamb ragù", note: "batch — freezes 2 portions", state: "Planned" },
  { day: "Sun", meal: "Big breakfast", note: "eggs, oats, coffee", state: "Planned" },
];

const basket = [
  { name: "Rolled oats 1kg", why: "2 breakfasts short", qty: "1 pack", price: "£2.00" },
  { name: "Whole milk 1L", why: "burn-down + Sunday", qty: "4 × 1L", price: "£4.20" },
  { name: "Large eggs ×6", why: "Sunday breakfast", qty: "2 packs", price: "£4.70" },
  { name: "Basmati rice 1kg", why: "Monday + buffer", qty: "1 pack", price: "£2.80" },
];

const flow = [
  { icon: Package, title: "Household state", body: "What you actually have, tracked as events — never guessed." },
  { icon: ChefHat, title: "Meals", body: "A week of meals that fits your household, not a magazine." },
  { icon: Leaf, title: "Quantities", body: "Planned meals burn stock down; the gap becomes a requirement." },
  { icon: ShoppingBasket, title: "Basket", body: "Requirements become real pack sizes, deduplicated and priced." },
  { icon: ThumbsUp, title: "Your approval", body: "Nothing is ever bought without a human saying yes." },
  { icon: Sparkles, title: "Learning", body: "Corrections and exceptions feed back into next week." },
];

const capability = {
  live: [
    "Deterministic household state from an event stream",
    "Planned meals generate expected consumption",
    "Stock burn-down, exceptions and corrections",
    "Quantities → deduplicated candidate basket with pack rounding",
    "Conflicting or uncertain items isolated, not silently guessed",
  ],
  next: [
    "Read-only connection to your real household records",
    "Meal planning that learns your household's rhythm",
    "Verified retailer product matching and live pricing",
    "Phone-first weekly check-in and quick corrections",
  ],
  approval: [
    "Writing anything back to your household records",
    "Placing or amending any shopping order",
    "Accepting a basket that isn't fully sourced",
  ],
};

function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Leaf className="h-4 w-4" />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">Food OS</span>
          </div>
          <Link
            to="/console"
            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Under the hood
          </Link>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-5 pb-12 pt-10 md:pt-16">
          <Badge
            variant="outline"
            className="mb-5 gap-1.5 rounded-full border-accent bg-accent/50 px-3 py-1 text-[11px] font-medium tracking-wide text-accent-foreground"
          >
            <FlaskConical className="h-3 w-3" /> Prototype · synthetic demo data
          </Badge>
          <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            The food admin,
            <br />
            quietly handled.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Food OS is a household operator for food. It keeps track of what you have, what you
            planned to eat, and what that leaves you short of — then hands you one shopping basket
            to approve. No spreadsheets, no mental load, no surprises at 6pm.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="rounded-full px-6">
              <Link to="/sweep">
                Try a quick stock sweep <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg" className="rounded-full px-6">
              <a href="#week">See a week</a>
            </Button>
            <Button asChild variant="ghost" size="lg" className="rounded-full px-5">
              <Link to="/feedback">What Food OS heard</Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="rounded-full px-5">
              <Link to="/console">See the engine</Link>
            </Button>
          </div>

          <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">Where this is today:</strong> a working
            vertical slice. The state engine, meal consumption, quantities and basket build are real
            and tested — but they run on synthetic example data. Nothing here is connected to a real
            kitchen, a retailer, or your money.
          </p>
        </section>

        {/* Flow */}
        <section className="border-y border-border/70 bg-secondary/50">
          <div className="mx-auto max-w-5xl px-5 py-12">
            <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
              How it works, end to end
            </h2>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">
              Six steps. Each one is a real piece of the system, and the last word is always yours.
            </p>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {flow.map((step, i) => (
                <li
                  key={step.title}
                  className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_0_0_var(--border)]"
                >
                  <div className="flex items-center gap-2.5">
                    <step.icon className="h-4 w-4 text-primary" />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h3 className="mt-3 font-display text-lg font-semibold tracking-tight">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Week preview */}
        <section id="week" className="mx-auto max-w-5xl scroll-mt-16 px-5 py-14">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
                A week, as Food OS sees it
              </h2>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                Example household · 2 adults. Every row below is invented for illustration.
              </p>
            </div>
            <Badge variant="outline" className="gap-1.5 rounded-full text-[11px]">
              <CalendarDays className="h-3 w-3" /> Example week
            </Badge>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
            <ul className="overflow-hidden rounded-2xl border border-border bg-card">
              {week.map((d) => (
                <li
                  key={d.day}
                  className="flex items-center gap-4 border-b border-border/70 px-5 py-3.5 last:border-b-0"
                >
                  <span className="w-9 shrink-0 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                    {d.day}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{d.meal}</span>
                    <span className="block truncate text-xs text-muted-foreground">{d.note}</span>
                  </span>
                  <span
                    className={
                      d.state === "Cooked"
                        ? "shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary"
                        : "shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                    }
                  >
                    {d.state}
                  </span>
                </li>
              ))}
            </ul>

            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-center gap-2">
                  <ShoppingBasket className="h-4 w-4 text-primary" />
                  <h3 className="font-display text-lg font-semibold tracking-tight">
                    Basket to approve
                  </h3>
                </div>
                <ul className="mt-4 space-y-3">
                  {basket.map((b) => (
                    <li key={b.name} className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{b.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {b.why} · {b.qty}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-sm">{b.price}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <span className="text-sm text-muted-foreground">Estimated</span>
                  <span className="font-mono text-sm font-semibold">£13.70</span>
                </div>
                <Button className="mt-4 w-full rounded-full" disabled>
                  Approve basket — demo only
                </Button>
                <p className="mt-2.5 text-center text-[11px] leading-relaxed text-muted-foreground">
                  Disabled on purpose. Food OS cannot place orders, and no retailer is connected.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-secondary/60 p-5">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">What it noticed</h3>
                </div>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
                  <li>Tuesday's salmon was cooked — 780g came off the count automatically.</li>
                  <li>Thursday is planned leftovers, so it wasn't shopped for twice.</li>
                  <li>Butter looked uncertain, so it was set aside rather than guessed.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Capability */}
        <section className="border-t border-border/70 bg-secondary/50">
          <div className="mx-auto max-w-5xl px-5 py-14">
            <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
              Where the prototype actually is
            </h2>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">
              Honest labels. If it isn't in the first column, it isn't working yet.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <CapabilityCard
                icon={CircleCheck}
                title="Live in this prototype"
                subtitle="Built, tested, running on synthetic data"
                items={capability.live}
                tone="live"
              />
              <CapabilityCard
                icon={Clock3}
                title="Coming next"
                subtitle="Designed, not yet built"
                items={capability.next}
                tone="next"
              />
              <CapabilityCard
                icon={ThumbsUp}
                title="Requires your approval"
                subtitle="Never automatic — a human decides"
                items={capability.approval}
                tone="approval"
              />
            </div>
          </div>
        </section>

        {/* Under the hood */}
        <section className="mx-auto max-w-5xl px-5 py-14">
          <div className="rounded-2xl border border-border bg-card p-6 md:flex md:items-center md:justify-between md:gap-8 md:p-8">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-tight md:text-2xl">
                Want to see the machinery?
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                The Test Console exposes the deterministic state engine directly: feed it a
                household event stream and watch replay, reconciliation exceptions, quantity
                requirements and the candidate basket come out the other side.
              </p>
            </div>
            <Button asChild size="lg" variant="outline" className="mt-5 rounded-full md:mt-0">
              <Link to="/console">
                Open Test Console <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Food OS · household food operator · prototype</p>
          <p>Synthetic demo data only. No live inventory, retailer or purchasing.</p>
        </div>
      </footer>
    </div>
  );
}

function CapabilityCard({
  icon: Icon,
  title,
  subtitle,
  items,
  tone,
}: {
  icon: typeof CircleCheck;
  title: string;
  subtitle: string;
  items: string[];
  tone: "live" | "next" | "approval";
}) {
  const accent =
    tone === "live"
      ? "text-primary"
      : tone === "approval"
        ? "text-accent-foreground"
        : "text-muted-foreground";

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${accent}`} />
        <h3 className="font-display text-base font-semibold tracking-tight">{title}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      <ul className="mt-4 space-y-2.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
            <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current ${accent}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
