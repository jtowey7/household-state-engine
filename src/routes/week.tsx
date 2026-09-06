import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import weekCover from "@/assets/week-cover.jpg";
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
import { buildHouseholdStockReadout } from "@/lib/household-stock-readout";
import type { StockEntryInput } from "@/lib/household-stock-readout";
import { buildHouseholdWeekPlan, householdWeekMeals } from "@/lib/household-week-plan";
import type { WeekMealCoverage } from "@/lib/household-week-plan";
import {
  defaultStockEntries,
  loadStockEntries,
  stockNow,
  stockReportedBy,
} from "@/lib/household-view/stock-session";
import { week, householdName, type WeekDay } from "@/lib/household-view/demo";

export const Route = createFileRoute("/week")({
  head: () => ({
    meta: [
      { title: "This week — foodOS" },
      {
        name: "description",
        content:
          "The household food rhythm for the week: what is cooked, what is tonight, what is planned, and which meals are fully covered by what you already have.",
      },
      { property: "og:title", content: "This week — foodOS" },
      {
        property: "og:description",
        content: "Seven days of meals with coverage and attention states, in plain language.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WeekPage,
});

function stateTone(state: WeekDay["state"]) {
  if (state === "Cooked") return "good" as const;
  if (state === "Tonight") return "accent" as const;
  return "neutral" as const;
}

const COVERAGE_LABEL: Record<WeekMealCoverage, string> = {
  COVERED: "You have it",
  SHORT: "Need more",
  NOT_COUNTED: "Not counted",
  NEEDS_CHECK: "Needs a check",
  NOT_PLANNED: "Not planned",
};

function coverageTone(coverage: WeekMealCoverage) {
  if (coverage === "COVERED") return "good" as const;
  if (coverage === "NOT_PLANNED") return "neutral" as const;
  return "attention" as const;
}

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(iso));

function WeekPage() {
  const covered = week.filter((d) => d.coverage === "Covered").length;
  const [entries, setEntries] = useState<StockEntryInput[]>(() => [...defaultStockEntries]);

  useEffect(() => {
    setEntries(loadStockEntries());
  }, []);

  const plan = useMemo(() => {
    const readout = buildHouseholdStockReadout(entries, {
      now: stockNow,
      reportedBy: stockReportedBy,
    });
    return buildHouseholdWeekPlan(readout.handoff, householdWeekMeals);
  }, [entries]);

  const plannedMeals = plan.meals.filter((meal) => meal.coverage !== "NOT_PLANNED");

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" />
      <Shell>
        <PageTitle
          eyebrow="Week"
          title="This week's food rhythm"
          lede={`${householdName}. ${covered} of ${week.length} meals are already covered by what you have.`}
        />

        <ImageSlot src={weekCover} alt="A week of home-cooked meals laid out on a table" className="mb-7" />

        <section className="mb-9">
          <SectionHeading
            title="Planned from what you have counted"
            action={
              <Link
                to="/stock"
                className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
              >
                Update your count
              </Link>
            }
          />

          {!plan.readyForPlanning ? (
            <p className="rounded-[calc(var(--ctl-radius))] bg-[var(--ctl-surface-sunken)] px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
              {plan.blockedReason}
            </p>
          ) : (
            <>
              <Group>
                {plannedMeals.map((meal) => (
                  <Row key={meal.mealId}>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          {dayLabel(meal.plannedFor)}
                        </p>
                        <p className="mt-1 text-[15px] font-semibold leading-snug">{meal.label}</p>
                        <ul className="mt-1 space-y-0.5">
                          {meal.components.map((component) => (
                            <li
                              key={`${meal.mealId}-${component.itemKey}`}
                              className="text-[13px] leading-relaxed text-muted-foreground"
                            >
                              {component.needed} {component.unit} {component.itemKey} —{" "}
                              {component.because}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <Pill tone={coverageTone(meal.coverage)}>{COVERAGE_LABEL[meal.coverage]}</Pill>
                    </div>
                  </Row>
                ))}
              </Group>

              <div className="mt-4">
                <SectionHeading title="What that leaves you short" />
                {plan.shortfalls.length === 0 && plan.notCountedItemKeys.length === 0 ? (
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    Nothing is missing — every meal above is covered by what you have counted.
                  </p>
                ) : (
                  <Group>
                    {plan.shortfalls.map((short) => (
                      <Row key={short.itemKey}>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                          <p className="min-w-0 text-[15px] font-semibold leading-snug">
                            {short.itemKey}
                          </p>
                          <span className="shrink-0 text-[15px] font-semibold tabular-nums">
                            {short.quantity}
                            <span className="ml-0.5 text-[12px] font-medium text-muted-foreground">
                              {short.unit}
                            </span>
                          </span>
                        </div>
                      </Row>
                    ))}
                    {plan.notCountedItemKeys.map((itemKey) => (
                      <Row key={`not-counted-${itemKey}`}>
                        <p className="text-[15px] font-semibold leading-snug">{itemKey}</p>
                        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                          Never counted, so foodOS will not assume you have any.
                        </p>
                      </Row>
                    ))}
                  </Group>
                )}
              </div>
            </>
          )}

          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            This is worked out only from lines you confirmed yourself on{" "}
            <Link to="/stock" className="font-medium text-primary underline-offset-4 hover:underline">
              Enter what you have
            </Link>
            . Nothing here orders anything.
          </p>
        </section>

        <SectionHeading title="Seven days" />
        <Group>
          {week.map((d) => (
            <Row key={d.day}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {d.weekday}
                  </p>
                  <p className="mt-1 text-[15px] font-semibold leading-snug">{d.meal}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{d.note}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <Pill tone={stateTone(d.state)}>{d.state}</Pill>
                  {d.coverage !== "Covered" ? (
                    <Pill tone={d.coverage === "Check" ? "neutral" : "attention"}>{d.coverage}</Pill>
                  ) : null}
                </div>
              </div>
            </Row>
          ))}
        </Group>

        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
          Nothing is bought for a meal twice, and planned leftovers count as a meal.{" "}
          <Link to="/shop" className="font-medium text-primary underline-offset-4 hover:underline">
            See what that leaves to buy
          </Link>
          .
        </p>

        <Evidence label="Show how this week is derived">
          The planned meals above are matched against the replayed stock readout: approved stock
          entries only, drawn down in planned order, with blocked or incomparable-unit items
          isolated instead of converted. The seven-day rhythm below still comes from the synthetic
          consumption plan fixture. Full replay detail lives in System → Console.
        </Evidence>
      </Shell>
      <AppFooter />
    </div>
  );
}
