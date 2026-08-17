import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Shared household presentation primitives — layout and tone only. */

export function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl px-5 pb-24 pt-6 sm:pt-8">{children}</div>;
}

export function PageTitle({
  eyebrow,
  title,
  lede,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
}) {
  return (
    <header className="mb-7">
      {eyebrow ? (
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="mt-2 font-display text-[28px] font-semibold leading-tight tracking-tight sm:text-4xl">
        {title}
      </h1>
      {lede ? (
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">{lede}</p>
      ) : null}
    </header>
  );
}

export function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
      <h2 className="truncate font-display text-[15px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h2>
      {action}
    </div>
  );
}

export type Tone = "neutral" | "good" | "attention" | "accent";

const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-[color-mix(in_oklab,var(--ctl-green)_16%,transparent)] text-[var(--ctl-green-deep)]",
  attention: "bg-[color-mix(in_oklab,var(--ctl-amber)_18%,transparent)] text-[var(--ctl-amber-deep)]",
  accent: "bg-[color-mix(in_oklab,var(--ctl-pink)_35%,transparent)] text-[var(--ctl-pink-deep)]",
};

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold leading-none",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A soft grouped surface — replaces the old dense bordered card stacks. */
export function Group({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[calc(var(--ctl-radius)+0.15rem)] bg-card shadow-[var(--ctl-shadow)] ring-1 ring-border/60",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Row({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-border/50 px-4 py-3.5 last:border-b-0 sm:px-5", className)}>
      {children}
    </div>
  );
}

/**
 * Image slot — accepts an imported asset now, or renders a calm placeholder so
 * pages do not need restructuring when better photography arrives.
 */
export function ImageSlot({
  src,
  alt,
  className,
  ratio = "aspect-[16/9]",
  priority = false,
  children,
}: {
  src?: string;
  alt: string;
  className?: string;
  ratio?: string;
  priority?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[calc(var(--ctl-radius)+0.15rem)] bg-[var(--ctl-surface-sunken)]",
        ratio,
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          {...(priority ? {} : { loading: "lazy" as const })}
          className="h-full w-full object-cover"
        />
      ) : null}
      {children}
    </div>
  );
}

/** Progressive disclosure for engineering detail on household surfaces. */
export function Evidence({ label = "Show evidence", children }: { label?: string; children: ReactNode }) {
  return (
    <details className="group mt-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        {label}
        <span className="transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="mt-3 rounded-[calc(var(--ctl-radius)-0.35rem)] bg-[var(--ctl-surface-sunken)] p-3 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}
