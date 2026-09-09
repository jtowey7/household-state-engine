import { createFileRoute, Link } from "@tanstack/react-router";

import foodCover from "@/assets/food-cover.jpg";
import { AppFooter, AppHeader } from "@/components/app-header";
import {
  Evidence,
  Group,
  ImageSlot,
  PageTitle,
  Pill,
  Row,
  SectionHeading,
  Shell,
} from "@/components/household/household-ui";
import { deliveryStockView } from "@/lib/household-view/delivery";
import { pantry, pantryBands, type StockBand } from "@/lib/household-view/demo";

export const Route = createFileRoute("/food")({
  head: () => ({
    meta: [
      { title: "Food you have — foodOS" },
      {
        name: "description",
        content:
          "What the household actually has, grouped into use soon, worth a check and plenty — with the reasoning behind each, and the technical record one tap away.",
      },
      { property: "og:title", content: "Food you have — foodOS" },
      {
        property: "og:description",
        content: "Use soon, worth a check, plenty — household stock at a glance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FoodPage,
});

const BAND_TONE: Record<StockBand, "good" | "attention" | "neutral"> = {
  PLENTY: "good",
  USE_SOON: "attention",
  CHECK: "neutral",
};

function FoodPage() {
  const useSoon = pantry.filter((p) => p.band === "USE_SOON").length;

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" />
      <Shell>
        <PageTitle
          eyebrow="Food"
          title="What you have"
          lede={
            useSoon > 0
              ? `${useSoon} ${useSoon === 1 ? "thing is" : "things are"} worth using soon. Everything else is comfortably ahead of the week.`
              : "Everything is comfortably ahead of the week."
          }
        />

        <section className="mb-7 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <SectionHeading title="Household control" />
          <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">Keep the real weekly operation explicit: update stock, report a change, or see the whole cycle without implying consumption from a planned meal.</p>
          <div className="flex flex-wrap gap-2">
            <Link to="/stock" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Update stock</Link>
            <Link to="/sweep" className="rounded-md border px-3 py-2 text-sm font-medium">Quick stock sweep</Link>
            <Link to="/feedback" className="rounded-md border px-3 py-2 text-sm font-medium">Tell FoodOS</Link>
            <Link to="/cycle" className="rounded-md border px-3 py-2 text-sm font-medium">View weekly cycle</Link>
          </div>
        </section>

        <ImageSlot src={foodCover} alt="Neatly organised fridge shelves and pantry jars" className="mb-7" />

        <section className="mb-7">
          <SectionHeading
            title="Your last delivery is counted"
            action={
              <Pill tone={deliveryStockView.settled ? "good" : "attention"}>
                {deliveryStockView.settled ? "Settled" : "Needs a check"}
              </Pill>
            }
          />
          <p className="mb-3 -mt-1 text-[13px] text-muted-foreground">
            {deliveryStockView.lineCount} checked-off {deliveryStockView.lineCount === 1 ? "item" : "items"} have
            already been added to what you have — nothing for you to tally up.
          </p>
          <Group>
            {deliveryStockView.lines.map((line) => (
              <Row key={line.itemKey}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold leading-snug">{line.label}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                      {line.before} → {line.after} {line.unit} after {line.delivered} {line.unit} arrived
                      {line.substituted ? " · substituted by the shop" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums text-primary">
                    +{line.delivered}
                    <span className="ml-0.5 text-[12px] font-medium text-muted-foreground">{line.unit}</span>
                  </span>
                </div>
              </Row>
            ))}
          </Group>
          <Evidence label="Show the underlying record">
            Demonstration only, on an isolated synthetic delivery — no real household or retailer data is read
            or changed here. Each line is a reconciled delivery line turned into an append-only stock event and
            replayed by the state engine; delivery event IDs, provenance and reconciliation status are visible
            in System → Runtime.
          </Evidence>
        </section>

        {pantryBands.map((group) => {
          const items = pantry.filter((p) => p.band === group.band);
          if (items.length === 0) return null;
          return (
            <section key={group.band} className="mb-7">
              <SectionHeading
                title={group.title}
                action={<Pill tone={BAND_TONE[group.band]}>{items.length}</Pill>}
              />
              <p className="mb-3 -mt-1 text-[13px] text-muted-foreground">{group.blurb}</p>
              <Group>
                {items.map((item) => (
                  <Row key={item.itemKey}>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold leading-snug">{item.label}</p>
                        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                          {item.because} · {item.where}
                        </p>
                      </div>
                      <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums">
                        {item.quantity}
                        <span className="ml-0.5 text-[12px] font-medium text-muted-foreground">
                          {item.unit}
                        </span>
                      </span>
                    </div>
                  </Row>
                ))}
              </Group>
            </section>
          );
        })}

        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Something look wrong?{" "}
          <Link to="/stock" className="font-medium text-primary underline-offset-4 hover:underline">
            Enter what you actually have
          </Link>{" "}
          — confirm each line and foodOS plans your week around it. Or{" "}
          <Link to="/sweep" className="font-medium text-primary underline-offset-4 hover:underline">
            run a quick stock sweep
          </Link>
          .
        </p>

        <Evidence label="Show the underlying record">
          Quantities are the replayed household state from synthetic opening balances and sweep
          fixtures. Every figure traces to immutable event IDs; the full replay, provenance and
          reconciliation status are in System → Runtime.
        </Evidence>
      </Shell>
      <AppFooter />
    </div>
  );
}
