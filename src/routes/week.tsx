import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import weekCover from "@/assets/week-cover.jpg";
import { AppFooter, AppHeader } from "@/components/app-header";
import { Evidence, Group, ImageSlot, PageTitle, Pill, Row, SectionHeading, Shell } from "@/components/household/household-ui";
import { buildHouseholdWeekPlan } from "@/lib/household-week-plan";
import type { PlannedWeekMeal } from "@/lib/household-week-plan/types";
import type { WeekMealCoverage } from "@/lib/household-week-plan";
import { startOperatorSession, getOperatorWeek } from "@/lib/operator-week.functions";

export const Route = createFileRoute("/week")({
  head: () => ({
    meta: [
      { title: "This week — foodOS" },
      { name: "description", content: "The household food rhythm for the week, derived from authoritative household state and the current production meal plan." },
    ],
  }),
  component: WeekPage,
});

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

type LiveWeekResponse = {
  ok: boolean;
  error?: string;
  quantityRequirementsHandoff?: Parameters<typeof buildHouseholdWeekPlan>[0];
  meals?: Array<{ id?: unknown; meal?: unknown; date?: unknown; method?: unknown; why?: unknown; leftovers?: unknown }>;
  quantities?: Array<{ mealIds: string[]; itemKey?: unknown; quantity?: unknown; unit?: unknown }>;
  preferences?: Array<{ id?: unknown; preference?: unknown; category?: unknown; importance?: unknown; seasonal?: boolean; evidence?: unknown }>;
  productionMutation?: false;
  replayClock?: string;
};

function buildLiveMeals(data: LiveWeekResponse): PlannedWeekMeal[] {
  const quantities = data.quantities ?? [];
  return (data.meals ?? [])
    .filter((meal) => typeof meal.id === "string" && typeof meal.meal === "string" && typeof meal.date === "string")
    .map((meal) => ({
      mealId: meal.id as string,
      label: meal.meal as string,
      plannedFor: meal.date as string,
      state: "PLANNED" as const,
      components: quantities
        .filter((quantity) => quantity.mealIds.includes(meal.id as string))
        .filter((quantity) => typeof quantity.itemKey === "string" && typeof quantity.quantity === "number" && typeof quantity.unit === "string")
        .map((quantity) => ({ itemKey: quantity.itemKey as string, quantity: quantity.quantity as number, unit: quantity.unit as string })),
      note: typeof meal.why === "string" ? meal.why : undefined,
    }));
}

function WeekPage() {
  const [live, setLive] = useState<LiveWeekResponse | null>(null);
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const result = (await getOperatorWeek()) as LiveWeekResponse;
      if (!result.ok) throw new Error(result.error ?? "Live household planning read failed");
      setLive(result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setLive(null);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const connect = async () => {
    setConnecting(true);
    try {
      const result = await startOperatorSession({ data: { token } });
      if (!result.ok) throw new Error(result.error ?? "Operator authentication failed");
      setToken("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnecting(false);
    }
  };

  const plan = useMemo(() => {
    if (!live?.quantityRequirementsHandoff) return null;
    return buildHouseholdWeekPlan(live.quantityRequirementsHandoff, buildLiveMeals(live));
  }, [live]);

  const preferences = live?.preferences ?? [];

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" />
      <Shell>
        <PageTitle
          eyebrow="Week"
          title="This week's food rhythm"
          lede={live?.ok ? "Current production meal plan, checked against replayed household stock and active household preferences." : "Connect the household read path to see the real weekly plan."}
        />

        <ImageSlot src={weekCover} alt="A week of home-cooked meals laid out on a table" className="mb-7" />

        {!live ? (
          <section className="mb-9 rounded-[calc(var(--ctl-radius))] bg-[var(--ctl-surface-sunken)] p-5">
            <SectionHeading title="Connect FoodOS" />
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              This read-only bridge uses a separate FoodOS operator credential. It is not the Production Airtable token and is never sent to the browser after authentication.
            </p>
            <div className="mt-4 flex gap-2">
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Operator credential"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                autoComplete="off"
              />
              <button type="button" onClick={() => void connect()} disabled={connecting || !token.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {connecting ? "Connecting…" : "Connect"}
              </button>
            </div>
            {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
          </section>
        ) : null}

        {plan ? (
          <section className="mb-9">
            <SectionHeading title="Planned from authoritative household state" action={<Link to="/stock" className="text-[12.5px] font-medium text-primary underline-offset-4 hover:underline">Update your count</Link>} />
            {!plan.readyForPlanning ? (
              <p className="rounded-[calc(var(--ctl-radius))] bg-[var(--ctl-surface-sunken)] px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">{plan.blockedReason}</p>
            ) : (
              <Group>
                {plan.meals.map((meal) => (
                  <Row key={meal.mealId}>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{dayLabel(meal.plannedFor)}</p>
                        <p className="mt-1 text-[15px] font-semibold leading-snug">{meal.label}</p>
                        {meal.note ? <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{meal.note}</p> : null}
                        <ul className="mt-1 space-y-0.5">
                          {meal.components.map((component) => (
                            <li key={`${meal.mealId}-${component.itemKey}`} className="text-[13px] leading-relaxed text-muted-foreground">
                              {component.needed} {component.unit} {component.itemKey} — {component.because}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <Pill tone={coverageTone(meal.coverage)}>{COVERAGE_LABEL[meal.coverage]}</Pill>
                    </div>
                  </Row>
                ))}
              </Group>
            )}
            <div className="mt-4">
              <SectionHeading title="What that leaves you short" />
              {plan.shortfalls.length === 0 && plan.notCountedItemKeys.length === 0 ? (
                <p className="text-[13px] leading-relaxed text-muted-foreground">Nothing is missing — every planned meal is covered by the replayed stock.</p>
              ) : (
                <Group>
                  {plan.shortfalls.map((short) => <Row key={short.itemKey}><div className="flex items-center justify-between gap-3"><p className="text-[15px] font-semibold">{short.itemKey}</p><span className="text-[15px] font-semibold tabular-nums">{short.quantity} {short.unit}</span></div></Row>)}
                  {plan.notCountedItemKeys.map((itemKey) => <Row key={itemKey}><p className="text-[15px] font-semibold">{itemKey}</p><p className="text-[13px] text-muted-foreground">Never counted, so FoodOS will not assume you have any.</p></Row>)}
                </Group>
              )}
            </div>
          </section>
        ) : null}

        {live?.ok ? (
          <>
            <SectionHeading title="Active household preferences" />
            <Group>
              {preferences.map((preference) => <Row key={String(preference.id)}><div><p className="text-[14px] font-semibold">{String(preference.preference)}</p><p className="text-[12px] text-muted-foreground">{String(preference.category ?? "Preference")} · {String(preference.importance ?? "Normal")}</p></div></Row>)}
            </Group>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">The meal plan above is the current Production plan; FoodOS checks it against the authoritative replayed stock. Active preferences are loaded from the canonical PREFERENCES table and remain decision context rather than being silently rewritten.</p>
          </>
        ) : null}

        {live?.ok ? <Evidence label="Show how this week is derived">Household stock comes from the read-only Production HOUSEHOLD EVENTS replay. Meals come from Production MEAL PLANS and their linked QUANTITY REQUIREMENTS. Active preferences come from PREFERENCES. No household write, retailer I/O or checkout action occurs on this surface.</Evidence> : null}
      </Shell>
      <AppFooter />
    </div>
  );
}
