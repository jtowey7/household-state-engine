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

export const Route = createFileRoute("/shop")({
  head: () => ({
    meta: [
      { title: "Basket to approve — foodOS" },
      {
        name: "description",
        content:
          "The canonical FoodOS basket must be present and approved before a household purchase can proceed.",
      },
      { property: "og:title", content: "Basket to approve — foodOS" },
      {
        property: "og:description",
        content: "FoodOS never presents synthetic basket data as an actionable household approval.",
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
          title="No canonical basket is ready"
          lede="FoodOS has not received an authoritative basket from the procurement and approval path, so there is nothing safe to approve yet."
        />

        <div className="ctl-hero mb-7 p-5 sm:p-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
            <div className="min-w-0">
              <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Approval status
              </p>
              <p className="mt-1 font-display text-3xl font-semibold tracking-tight">
                Waiting for canonical basket
              </p>
            </div>
            <Pill tone="attention">Not ready</Pill>
          </div>
          <div className="mt-5 rounded-[calc(var(--ctl-radius))] bg-[var(--ctl-surface-sunken)] px-4 py-3.5">
            <p className="text-[13.5px] font-semibold leading-snug">
              Nothing is being ordered or approved from this screen
            </p>
            <p className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                The previous synthetic/demo basket is deliberately not shown as household truth.
                A future basket must come from the canonical BASKET CANDIDATES handoff and retain
                its identity, provenance, completeness and approval state.
              </span>
            </p>
          </div>
        </div>

        <SectionHeading title="What happens next" />
        <Group>
          <Row>
            <p className="text-[15px] font-semibold">1. Build the basket</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
              Quantity requirements are matched to the configured one-supermarket catalogue.
            </p>
          </Row>
          <Row>
            <p className="text-[15px] font-semibold">2. Judge and approve it</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
              The canonical basket must be complete, traceable and bound to the approval evidence.
            </p>
          </Row>
          <Row>
            <p className="text-[15px] font-semibold">3. Then show it here</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
              The Shop screen should render the same canonical basket, not a separate illustrative
              copy of it.
            </p>
          </Row>
        </Group>

        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
          Want to review the week first?{" "}
          <Link to="/week" className="font-medium text-primary underline-offset-4 hover:underline">
            Review the meals
          </Link>
          .
        </p>

        <Evidence label="Why the basket is withheld">
          The current Shop route previously rendered synthetic fixture data directly from
          household-view/demo.ts. The canonical Airtable BASKET CANDIDATES table currently has no
          approved basket record, so presenting that fixture as “Ready for your approval” would
          create a false approval surface. This page now fails closed until the canonical handoff
          is implemented and evidenced.
        </Evidence>
      </Shell>
      <AppFooter />
    </div>
  );
}
