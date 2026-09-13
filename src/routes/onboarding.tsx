import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-header";
import { Group, PageTitle, Pill, Row, SectionHeading, Shell } from "@/components/household/household-ui";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Set up your household — foodOS" },
      { name: "description", content: "A short, revisitable household setup for the facts FoodOS needs to plan food well." },
    ],
  }),
  component: OnboardingPage,
});

type Draft = {
  people: string;
  equipment: string[];
  constraints: string[];
  constraintNote: string;
  interests: string[];
  shoppingCadence: string;
  seasonal: string[];
  recurring: string[];
};

const emptyDraft: Draft = { people: "", equipment: [], constraints: [], constraintNote: "", interests: [], shoppingCadence: "", seasonal: [], recurring: [] };
const equipment = ["Oven", "Hob", "Microwave", "Air fryer", "Slow cooker"];
const constraints = ["No dietary restrictions", "Vegetarian sometimes", "Pescatarian sometimes", "Allergy / medical need", "Foods we avoid"];
const interests = ["Quick family meals", "Comfort food", "Healthy-ish", "World food", "Baking", "Trying new things"];
const seasonal = ["Christmas", "Pancake Day", "Summer / lighter food", "Winter / hearty food"];
const recurring = ["Busy school nights", "Regular takeaway night", "Weekend cooking", "Guests fairly often"];

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function OnboardingPage() {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saved, setSaved] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showReview, setShowReview] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("foodos-household-profile-draft");
      if (raw) setDraft({ ...emptyDraft, ...JSON.parse(raw) });
    } catch {
      // A local draft is convenience only; failure must not affect the household state path.
    }
  }, []);

  const summary = useMemo(() => {
    const parts = [];
    if (draft.people.trim()) parts.push(`${draft.people.trim()} people`);
    if (draft.equipment.length) parts.push(`${draft.equipment.length} kitchen tools`);
    if (draft.constraints.length) parts.push(`${draft.constraints.length} food notes`);
    if (draft.shoppingCadence) parts.push(draft.shoppingCadence);
    return parts.join(" · ") || "Nothing saved yet";
  }, [draft]);

  const reviewGroups = useMemo(() => {
    const groups: Array<{ title: string; values: string[] }> = [];
    if (draft.people.trim()) groups.push({ title: "Your household", values: [`${draft.people.trim()} people`] });
    if (draft.equipment.length) groups.push({ title: "What you can cook with", values: draft.equipment });
    if (draft.constraints.length) groups.push({ title: "Food notes", values: draft.constraints });
    if (draft.constraintNote.trim()) groups.push({ title: "Detail to remember", values: [draft.constraintNote.trim()] });
    if (draft.interests.length) groups.push({ title: "Food interests", values: draft.interests });
    if (draft.shoppingCadence) groups.push({ title: "Normal shopping", values: [draft.shoppingCadence] });
    if (draft.seasonal.length) groups.push({ title: "Seasonal patterns", values: draft.seasonal });
    if (draft.recurring.length) groups.push({ title: "Recurring routines", values: draft.recurring });
    return groups;
  }, [draft]);

  const saveDraft = () => {
    window.localStorage.setItem("foodos-household-profile-draft", JSON.stringify(draft));
    setSaved(true);
    setShowReview(false);
  };

  const clearDraft = () => {
    window.localStorage.removeItem("foodos-household-profile-draft");
    setDraft(emptyDraft);
    setSaved(false);
    setShowReview(false);
  };

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" />
      <Shell>
        <PageTitle eyebrow="Set up once, change anytime" title="Help FoodOS know your household" lede="A few useful facts are enough to start. You can change them later. You do not need to build a perfect profile." />

        <section className="mb-7 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4"><div><SectionHeading title="Your household" /><p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">How many people do you normally feed?</p></div><Pill tone="neutral">Core</Pill></div>
          <input aria-label="People in household" inputMode="numeric" value={draft.people} onChange={(event) => setDraft((current) => ({ ...current, people: event.target.value.replace(/[^0-9]/g, "") }))} placeholder="e.g. 6" className="mt-3 w-24 rounded-md border bg-background px-3 py-2 text-sm" />
        </section>

        <section className="mb-7"><SectionHeading title="What can you cook with?" /><Group><Row><div className="flex flex-wrap gap-2">{equipment.map((item) => <button key={item} type="button" onClick={() => setDraft((current) => ({ ...current, equipment: toggle(current.equipment, item) }))} className={`rounded-full border px-3 py-2 text-[13px] font-medium ${draft.equipment.includes(item) ? "bg-primary text-primary-foreground" : "bg-background"}`}>{item}</button>)}</div></Row></Group></section>

        <section className="mb-7"><SectionHeading title="Anything FoodOS should know?" /><Group><Row><div className="flex flex-wrap gap-2">{constraints.map((item) => <button key={item} type="button" onClick={() => setDraft((current) => ({ ...current, constraints: toggle(current.constraints, item) }))} className={`rounded-full border px-3 py-2 text-[13px] font-medium ${draft.constraints.includes(item) ? "bg-primary text-primary-foreground" : "bg-background"}`}>{item}</button>)}</div>{draft.constraints.includes("Foods we avoid") || draft.constraints.includes("Allergy / medical need") ? <input aria-label="Food constraint details" value={draft.constraintNote} onChange={(event) => setDraft((current) => ({ ...current, constraintNote: event.target.value }))} placeholder="e.g. no peanuts, Sam dislikes mushrooms" className="mt-3 w-full rounded-md border bg-background px-3 py-2 text-sm" /> : null}<p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">For medical or allergy information, be specific when you are ready. FoodOS should treat hard constraints differently from ordinary likes and dislikes.</p></Row></Group></section>

        <section className="mb-7"><SectionHeading title="How do you normally shop?" /><Group><Row><div className="flex flex-wrap gap-2">{["Once a week", "Twice a week", "Several small shops", "It varies"].map((item) => <button key={item} type="button" onClick={() => setDraft((current) => ({ ...current, shoppingCadence: item }))} className={`rounded-full border px-3 py-2 text-[13px] font-medium ${draft.shoppingCadence === item ? "bg-primary text-primary-foreground" : "bg-background"}`}>{item}</button>)}</div></Row></Group></section>

        <section className="mb-7"><SectionHeading title="What sounds like you?" /><Group><Row><p className="mb-3 text-[12px] text-muted-foreground">These shape suggestions, not rules.</p><div className="flex flex-wrap gap-2">{interests.map((item) => <button key={item} type="button" onClick={() => setDraft((current) => ({ ...current, interests: toggle(current.interests, item) }))} className={`rounded-full border px-3 py-2 text-[13px] font-medium ${draft.interests.includes(item) ? "bg-primary text-primary-foreground" : "bg-background"}`}>{item}</button>)}</div></Row></Group></section>

        <section className="mb-7 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4"><div><SectionHeading title="Seasons & recurring life" /><p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Only recurring patterns belong here. One-off guests, parties and special occasions stay one-off.</p></div><Pill tone="neutral">Optional</Pill></div>
          <button type="button" onClick={() => setShowMore((value) => !value)} className="mt-3 text-sm font-medium underline underline-offset-4">{showMore ? "Show less" : "Add seasonal or recurring patterns"}</button>
          {showMore ? <div className="mt-4 space-y-4"><div><p className="mb-2 text-[12px] font-medium text-muted-foreground">Seasonal</p><div className="flex flex-wrap gap-2">{seasonal.map((item) => <button key={item} type="button" onClick={() => setDraft((current) => ({ ...current, seasonal: toggle(current.seasonal, item) }))} className={`rounded-full border px-3 py-2 text-[13px] font-medium ${draft.seasonal.includes(item) ? "bg-primary text-primary-foreground" : "bg-background"}`}>{item}</button>)}</div></div><div><p className="mb-2 text-[12px] font-medium text-muted-foreground">Recurring routines</p><div className="flex flex-wrap gap-2">{recurring.map((item) => <button key={item} type="button" onClick={() => setDraft((current) => ({ ...current, recurring: toggle(current.recurring, item) }))} className={`rounded-full border px-3 py-2 text-[13px] font-medium ${draft.recurring.includes(item) ? "bg-primary text-primary-foreground" : "bg-background"}`}>{item}</button>)}</div></div></div> : null}
        </section>

        <section className="sticky bottom-3 rounded-2xl border border-border bg-card/95 p-4 shadow-sm backdrop-blur">
          <p className="text-[13px] font-medium">{summary}</p>
          <p className="mt-1 text-[12px] text-muted-foreground">Review what FoodOS heard before saving. This first slice saves a private draft on this device only.</p>
          <div className="mt-3 flex flex-wrap gap-2"><Button type="button" onClick={() => setShowReview((value) => !value)}>{showReview ? "Hide review" : "Review what FoodOS heard"}</Button><Button type="button" variant="secondary" onClick={clearDraft}>Clear</Button><Button asChild type="button" variant="ghost"><Link to="/food">Back to food</Link></Button></div>
          {showReview ? <div className="mt-4 rounded-xl border border-border bg-background p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">What FoodOS heard</h2><p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Check this summary. Nothing here changes your household account yet.</p></div><Pill tone="neutral">Review</Pill></div>{reviewGroups.length ? <div className="mt-4 space-y-4">{reviewGroups.map((group) => <div key={group.title}><p className="text-[12px] font-medium text-muted-foreground">{group.title}</p><div className="mt-1 flex flex-wrap gap-2">{group.values.map((value) => <span key={`${group.title}-${value}`} className="rounded-full border px-2.5 py-1 text-[12px]">{value}</span>)}</div></div>)}</div> : <p className="mt-4 text-[12px] text-muted-foreground">Nothing selected yet. Choose a few household facts above and review again.</p>}<div className="mt-4 flex flex-wrap gap-2"><Button type="button" onClick={saveDraft}>Save this draft</Button><Button type="button" variant="ghost" onClick={() => setShowReview(false)}>Keep editing</Button></div></div> : null}
          {saved ? <p className="mt-2 text-[12px] text-muted-foreground">Saved. Reopen this page whenever you want to change it.</p> : null}
        </section>
      </Shell>
    </div>
  );
}
