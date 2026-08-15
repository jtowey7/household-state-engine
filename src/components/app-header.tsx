import { Link } from "@tanstack/react-router";
import { Leaf } from "lucide-react";
import type { ReactNode } from "react";

type NavItem = { to: string; label: string };

/**
 * Shared FoodOS navigation chrome. Presentation only — it carries no product
 * state and changes no routing behaviour, it just gives every surface the same
 * brand mark, link set and responsive rhythm.
 */
const HOUSEHOLD_NAV: NavItem[] = [
  { to: "/", label: "Home" },
  { to: "/sweep", label: "Stock sweep" },
  { to: "/feedback", label: "What it heard" },
];

const OPERATOR_NAV: NavItem[] = [
  { to: "/control", label: "Control" },
  { to: "/console", label: "Console" },
  { to: "/runtime-household", label: "Runtime" },
];

export function AppHeader({
  eyebrow,
  width = "max-w-5xl",
  right,
}: {
  eyebrow?: string;
  width?: string;
  right?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
      <div
        className={`mx-auto grid ${width} grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-5`}
      >
        <Link to="/" className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-[var(--ctl-shadow)]">
            <Leaf className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-[17px] font-semibold leading-none tracking-tight">
              Food OS
            </span>
            {eyebrow ? (
              <span className="mt-1 block truncate font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {eyebrow}
              </span>
            ) : null}
          </span>
        </Link>

        <div className="flex items-center gap-1.5">
          <nav className="hidden items-center gap-1 md:flex">
            {[...HOUSEHOLD_NAV, ...OPERATOR_NAV].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-full px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                activeProps={{ className: "bg-accent text-accent-foreground" }}
                activeOptions={{ exact: item.to === "/" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {right}
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-border/60 px-4 py-2 md:hidden">
        {[...HOUSEHOLD_NAV, ...OPERATOR_NAV].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="shrink-0 rounded-full border border-border px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors"
            activeProps={{ className: "bg-accent text-accent-foreground border-transparent" }}
            activeOptions={{ exact: item.to === "/" }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function AppFooter({ width = "max-w-5xl" }: { width?: string }) {
  return (
    <footer className="border-t border-border/70">
      <div
        className={`mx-auto flex ${width} flex-col gap-2 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-5`}
      >
        <p>Food OS · household food operator · prototype</p>
        <p>Synthetic demo data only. No live inventory, retailer or purchasing.</p>
      </div>
    </footer>
  );
}
