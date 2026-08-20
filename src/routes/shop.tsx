import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";

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

import { basket, basketHeldBack, basketTotal, money } from "@/lib/household-view/demo";

export const Route = createFileRoute("/shop")({
  head: () => ({
    meta: [
      { title: "Basket to approve — foodOS" },
      {
        name: "description",
        content:
          "A reasoned shopping recommendation awaiting your approval: what is being bought, why each line exists, the approximate total, and anything deliberately held back.",
      },
      { property: "og:title", content: "Basket to approve — foodOS" },
      {
        property: "og:description",
        content: "What to buy, why, and what foodOS held back — nothing is ordered without you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShopPage,
});

function ShopPage() {
  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" />
      <Shell>
        <PageTitle
          eyebrow="Shop"
          title="Ready for your approval"
          lede={`${basket.length} lines, about ${money(basketTotal)}. Every line exists because a planned meal needs it.`}
        />

        <div className="ctl-hero mb-7 p-5 sm:p-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
            <div className="min-w-0">
              <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Approximate total
              </p>
              <p className="mt-1 font-display text-4xl font-semibold tracking-tight">
                {money(basketTotal)}
              </p>
            </div>
            <Pill tone="attention">Awaiting you</Pill>
          </div>
          <div className="mt-5 rounded-[calc(var(--ctl-radius))] bg-[var(--ctl-surface-sunken)] px-4 py-3.5">
            <p className="text-[13.5px] font-semibold leading-snug">
              Approval happens here once a shop is connected
            </p>
            <p className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>foodOS cannot place orders. No retailer is connected.</span>
            </p>
          </div>


        </div>

        <SectionHeading title="What's in it, and why" />
        <Group>
          {basket.map((item) => (
            <Row key={item.sku}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold leading-snug">{item.name}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                    {item.why} · {item.packs} pack{item.packs > 1 ? "s" : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[15px] font-semibold tabular-nums">
                  {money(item.price)}
                </span>
              </div>
            </Row>
          ))}
        </Group>

        <section className="mt-7">
          <SectionHeading title="Held back on purpose" />
          <Group>
            {basketHeldBack.map((held) => (
              <Row key={held.label}>
                <p className="text-[15px] font-semibold">{held.label}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                  {held.reason}
                </p>
              </Row>
            ))}
          </Group>
        </section>

        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
          Want to change the week first?{" "}
          <Link to="/week" className="font-medium text-primary underline-offset-4 hover:underline">
            Review the meals
          </Link>
          .
        </p>

        <Evidence label="Show sourcing and provenance">
          Lines are aggregated quantity requirements matched against the synthetic retailer
          catalogue with pack rounding and duplicate consolidation. Snapshot/replay identifiers,
          contributing event IDs and coverage status are shown in System → Console.
        </Evidence>
      </Shell>
      <AppFooter />
    </div>
  );
}
