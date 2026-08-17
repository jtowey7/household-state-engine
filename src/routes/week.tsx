import { createFileRoute, Link } from "@tanstack/react-router";

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

function WeekPage() {
  const covered = week.filter((d) => d.coverage === "Covered").length;

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
          Meals come from the synthetic consumption plan fixture. Completed meals generate expected
          consumption, which burns stock down during replay; coverage compares that against the
          replayed household state. Full replay detail lives in System → Console.
        </Evidence>
      </Shell>
      <AppFooter />
    </div>
  );
}
