import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { AppFooter, AppHeader, SYSTEM_NAV } from "@/components/app-header";
import { Group, PageTitle, Row, SectionHeading, Shell } from "@/components/household/household-ui";

export const Route = createFileRoute("/system")({
  head: () => ({
    meta: [
      { title: "System — the serious inside of foodOS" },
      {
        name: "description",
        content:
          "Operator surfaces for foodOS: control room health, deterministic state engine console, runtime household state, safety-boundary proof, stock sweep and feedback propagation.",
      },
      { property: "og:title", content: "System — the serious inside of foodOS" },
      {
        property: "og:description",
        content: "Replay, evidence, reconciliation and safety boundaries for the household engine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SystemPage,
});

function SystemPage() {
  return (
    <div className="ctl-page">
      <AppHeader eyebrow="System" />
      <Shell>
        <PageTitle
          eyebrow="System"
          title="Simple outside. Serious inside."
          lede="The engineering surfaces behind the household experience: deterministic replay, provenance, reconciliation exceptions and safety boundaries. Nothing here writes to production."
        />

        <SectionHeading title="Operator surfaces" />
        <Group>
          {SYSTEM_NAV.map((item) => (
            <Row key={item.to} className="transition-colors hover:bg-secondary/60">
              <Link to={item.to} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">{item.label}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
                    {item.blurb}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </Row>
          ))}
        </Group>

        <p className="mt-5 text-[13px] leading-relaxed text-muted-foreground">
          All surfaces run on synthetic demo data. Production household records are read-only where
          configured, and no order can be placed from this app.
        </p>
      </Shell>
      <AppFooter />
    </div>
  );
}
