import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { AppFooter, AppHeader } from "@/components/app-header";
import { Group, PageTitle, Pill, Row, SectionHeading, Shell } from "@/components/household/household-ui";
import {
  deterministicMealProvider,
  persistSelectedWeek,
  persistSelectedWeekLive,
  selectMeals,
  validateMealCandidates,
  type CandidateRefusal,
  type MealCandidate,
} from "@/lib/meal-generation";

export const Route = createFileRoute("/plan-week")({
  head: () => ({
    meta: [
      { title: "Plan this week — foodOS" },
      { name: "description", content: "Answer two quick questions and foodOS suggests a week of meals for your household to choose from." },
      { property: "og:title", content: "Plan this week — foodOS" },
      { property: "og:description", content: "Answer two quick questions and foodOS suggests a week of meals for your household to choose from." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlanWeekPage,
});

const CONSTRAINT_CHIPS = ["Vegetarian", "No fish", "No beef"] as const;

function nextMonday(): string {
  const today = new Date();
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const offset = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00.000Z`));

function PlanWeekPage() {
  const weekStartIso = useMemo(nextMonday, []);
  const [people, setPeople] = useState(4);
  const [mealCount, setMealCount] = useState(5);
  const [constraints, setConstraints] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<MealCandidate[] | null>(null);
  const [refusals, setRefusals] = useState<CandidateRefusal[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [saved, setSaved] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const toggleConstraint = (value: string) =>
    setConstraints((current) => (current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]));

  const suggest = () => {
    setSaved(null);
    setSaveError(null);
    const request = { weekStartIso, mealCount, people, constraints };
    const generated = deterministicMealProvider.generate(request);
    const validation = validateMealCandidates(generated, request);
    if (!validation.ok) {
      setCandidates(null);
      setRefusals(validation.refusals);
      return;
    }
    setRefusals([]);
    setCandidates(validation.candidates);
    setChosen(validation.candidates.map((candidate) => candidate.candidateId));
  };

  const toggleMeal = (candidateId: string) =>
    setChosen((current) => (current.includes(candidateId) ? current.filter((entry) => entry !== candidateId) : [...current, candidateId]));

  const save = async () => {
    if (!candidates) return;
    setSaveError(null);
    const selected = selectMeals(candidates, chosen, people);
    const result = await persistSelectedWeek(
      selected,
      {
        async appendPlannedMeals(rows) {
          const liveResult = await persistSelectedWeekLive({ data: { rows } });
          if (!liveResult.ok) throw new Error(liveResult.reason);
          return { ids: liveResult.ids };
        },
      },
    );
    if (!result.ok) {
      setSaveError(result.reason);
      return;
    }
    setSaved(result.persistedMealCount);
  };

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Your food" />
      <Shell>
        <PageTitle
          eyebrow="Plan this week"
          title="Let's fill the week."
          lede="Two quick questions, then pick the meals you fancy. Nothing is bought and nothing at home changes."
        />

        <section className="mb-7 rounded-2xl bg-[var(--ctl-surface-sunken)] p-5">
          <SectionHeading title="About your week" />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-[13px] font-medium">
              How many people?
              <input
                type="number"
                min={1}
                max={12}
                value={people}
                onChange={(event) => setPeople(Number(event.target.value))}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="text-[13px] font-medium">
              How many meals?
              <input
                type="number"
                min={1}
                max={7}
                value={mealCount}
                onChange={(event) => setMealCount(Number(event.target.value))}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
          <p className="mt-4 text-[13px] font-medium">Anything to avoid?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {CONSTRAINT_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => toggleConstraint(chip)}
                className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium ${constraints.includes(chip) ? "bg-primary text-primary-foreground" : "bg-card ring-1 ring-border"}`}
              >
                {chip}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={suggest}
            className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Suggest meals
          </button>
        </section>

        {refusals.length > 0 ? (
          <section className="mb-7">
            <Group>
              {refusals.map((refusal, index) => (
                <Row key={`${refusal.candidateId ?? "week"}-${index}`}>
                  <p className="text-[13px] text-muted-foreground">{refusal.reason}</p>
                </Row>
              ))}
            </Group>
          </section>
        ) : null}

        {candidates ? (
          <section className="mb-7">
            <SectionHeading title="Pick what you fancy" action={<Pill tone={chosen.length ? "good" : "neutral"}>{chosen.length} chosen</Pill>} />
            <Group>
              {candidates.map((candidate) => {
                const picked = chosen.includes(candidate.candidateId);
                return (
                  <Row key={candidate.candidateId}>
                    <button type="button" onClick={() => toggleMeal(candidate.candidateId)} className="flex w-full items-center justify-between gap-3 text-left">
                      <span className="min-w-0">
                        <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{dayLabel(candidate.plannedFor)}</span>
                        <span className="mt-1 block text-[15px] font-semibold">{candidate.label}</span>
                        <span className="mt-0.5 block text-[13px] text-muted-foreground">{candidate.why}</span>
                      </span>
                      <Pill tone={picked ? "good" : "neutral"}>{picked ? "In the week" : "Skip"}</Pill>
                    </button>
                  </Row>
                );
              })}
            </Group>
            <button
              type="button"
              onClick={() => void save()}
              disabled={chosen.length === 0}
              className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Save this week
            </button>
            {saveError ? <p className="mt-3 text-[13px] text-destructive">{saveError}</p> : null}
            {saved !== null ? (
              <p className="mt-3 text-[13px] text-muted-foreground">
                Saved {saved} meal{saved === 1 ? "" : "s"} for the week. Nothing at home has changed and nothing has been ordered.{" "}
                <Link to="/cycle" className="font-medium text-primary underline-offset-4 hover:underline">Back to your week</Link>
              </p>
            ) : null}
          </section>
        ) : null}

        <p className="pb-4 text-center text-[12px] text-muted-foreground">Meals you plan never change what's in your kitchen.</p>
      </Shell>
      <AppFooter />
    </div>
  );
}
