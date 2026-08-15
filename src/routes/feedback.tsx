import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronDown,
  CircleAlert,
  Info,
  Quote,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FEEDBACK_CASES,
  RUNTIME_NOT_PROVISIONED,
  attentionMeta,
  casesByAttention,
  propagationLabel,
  type AttentionLevel,
  type FeedbackCase,
} from "@/lib/feedback";

export const Route = createFileRoute("/feedback")({
  head: () => ({
    meta: [
      { title: "Feedback review — Food OS" },
      {
        name: "description",
        content:
          "See how Food OS would treat household feedback: a one-off reaction, a durable preference, and a hard safety constraint — with affected areas, propagation status and proof requirements. Synthetic, read-only.",
      },
      { property: "og:title", content: "Feedback review — Food OS" },
      {
        property: "og:description",
        content:
          "One-off reactions stay local, repeated reports become preferences, safety constraints block and escalate. Read-only synthetic review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FeedbackReview,
});

/* ---------------------------------------------------------------- *
 * SYNTHETIC, READ-ONLY REVIEW SURFACE.
 * No propagation executes here; nothing is persisted or dispatched.
 * ---------------------------------------------------------------- */

const attentionLook: Record<
  AttentionLevel,
  { pill: string; card: string; rail: string; icon: typeof Info }
> = {
  LOCAL: {
    pill: "bg-muted text-muted-foreground border-border",
    card: "border-border bg-card",
    rail: "bg-border",
    icon: Info,
  },
  DURABLE: {
    pill: "bg-accent/60 text-accent-foreground border-accent-foreground/25",
    card: "border-accent-foreground/25 bg-card",
    rail: "bg-accent-foreground/50",
    icon: Sparkles,
  },
  CRITICAL: {
    pill: "bg-destructive/12 text-destructive border-destructive/35",
    card: "border-destructive/45 bg-destructive/[0.04] shadow-md",
    rail: "bg-destructive",
    icon: ShieldAlert,
  },
};

function FeedbackCard({ item }: { item: FeedbackCase }) {
  const [openWhy, setOpenWhy] = useState(false);
  const look = attentionLook[item.attention];
  const Icon = look.icon;
  const meta = attentionMeta[item.attention];

  return (
    <article className={`relative overflow-hidden rounded-2xl border p-4 ${look.card}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${look.rail}`} aria-hidden="true" />

      <div className="flex flex-wrap items-center gap-2 pl-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${look.pill}`}
        >
          <Icon className="size-3" />
          {meta.label}
        </span>
        {item.blocking ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-0.5 text-[11px] font-semibold text-destructive-foreground">
            <TriangleAlert className="size-3" /> Blocking
          </span>
        ) : null}
        <span className="ml-auto text-[11px] text-muted-foreground">
          seen {item.occurrences}×
        </span>
      </div>

      <blockquote className="mt-3 flex gap-2 pl-2 text-sm leading-relaxed text-foreground">
        <Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span>“{item.text}”</span>
      </blockquote>
      <p className="mt-1.5 pl-2 text-[11px] text-muted-foreground">
        {item.actor} · {item.evidenceSource}
      </p>

      <p className="mt-3 pl-2 text-xs italic text-muted-foreground">{meta.blurb}</p>

      <div className="mt-3 pl-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Affected areas
        </h3>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {item.affectedAreas.map((area) => (
            <Badge key={area} variant="secondary" className="rounded-full text-[11px] font-normal">
              {area}
            </Badge>
          ))}
        </div>
      </div>

      <dl className="mt-3 space-y-2 rounded-xl bg-muted/60 p-3 pl-3 text-xs">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">Propagation</dt>
          <dd className="text-right font-medium text-foreground">
            {propagationLabel[item.propagation]}
          </dd>
        </div>
        {item.consequence ? (
          <div>
            <dt className="text-muted-foreground">
              Would create ({item.consequence.kind.toLowerCase()})
            </dt>
            <dd className="mt-0.5 text-foreground">{item.consequence.label}</dd>
            <dd className="mt-0.5 text-muted-foreground">{item.consequence.detail}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted-foreground">Must be proven first</dt>
          <dd className="mt-0.5 text-foreground">{item.regressionRequirement}</dd>
        </div>
      </dl>

      {item.escalation ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/35 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {item.escalation}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setOpenWhy((v) => !v)}
        aria-expanded={openWhy}
        className="mt-3 inline-flex items-center gap-1.5 pl-2 text-xs font-medium text-primary"
      >
        <Info className="size-3.5" />
        Why this level?
        <ChevronDown className={`size-3.5 transition-transform ${openWhy ? "rotate-180" : ""}`} />
      </button>
      {openWhy ? (
        <p className="mt-2 rounded-xl bg-secondary/70 p-3 text-xs leading-relaxed text-secondary-foreground">
          {item.rationale}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 pl-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          className="h-9 rounded-xl text-xs"
        >
          Apply {item.consequence?.kind.toLowerCase() ?? "change"} — unavailable
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled
          className="h-9 rounded-xl text-xs"
        >
          Dismiss — unavailable
        </Button>
      </div>
      <p className="mt-1.5 pl-2 text-[11px] text-muted-foreground">
        Controls are shown to explain the intended interaction. They are inert in this prototype.
      </p>
    </article>
  );
}

function FeedbackReview() {
  const cases = casesByAttention(FEEDBACK_CASES);

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" width="max-w-md" />
      <div className="mx-auto w-full max-w-md px-5 pb-24 pt-6">
        <header className="mb-5">
          <h1 className="mt-3 font-display text-3xl leading-tight text-foreground">
            What Food OS heard
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Not everything you say should change everything. A one-off reaction stays a note, a
            repeated one becomes a preference, and a safety constraint stops the line.
          </p>
          <Badge variant="outline" className="mt-3 text-[11px] font-normal">
            Synthetic examples — read-only
          </Badge>
        </header>

        <div className="mb-6 flex items-start gap-2 ctl-notice p-3.5 text-xs leading-relaxed">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <p>{RUNTIME_NOT_PROVISIONED}</p>
        </div>

        <section className="space-y-4">
          {cases.map((item) => (
            <FeedbackCard key={item.feedbackId} item={item} />
          ))}
        </section>

        <div className="mt-8 grid gap-2">
          <Button asChild variant="outline" className="h-11 w-full rounded-xl">
            <Link to="/sweep">Back to the quick stock sweep</Link>
          </Button>
          <Button asChild variant="ghost" className="h-11 w-full rounded-xl">
            <Link to="/">Back to Food OS</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
