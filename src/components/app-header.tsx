import { Link } from "@tanstack/react-router";
import { CalendarDays, Home, Refrigerator, ShoppingBasket } from "lucide-react";
import type { ReactNode } from "react";

import { FoodOsWordmark } from "@/components/foodos-wordmark";

type NavItem = { to: string; label: string; icon: typeof Home };

/** Shared household navigation. Engineering/operator surfaces are deliberately kept out of the consumer chrome. */
export const HOUSEHOLD_NAV: NavItem[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/week", label: "Week", icon: CalendarDays },
  { to: "/food", label: "Food", icon: Refrigerator },
  { to: "/shop", label: "Shop", icon: ShoppingBasket },
];

export const SYSTEM_NAV: { to: string; label: string; blurb: string }[] = [
  { to: "/control", label: "Control", blurb: "Health, attention and the operating flow." },
  { to: "/console", label: "Console", blurb: "State engine replay, quantities, candidate basket." },
  { to: "/runtime-household", label: "Runtime", blurb: "Runtime household state and safety boundary proof." },
  { to: "/sweep", label: "Stock sweep", blurb: "Expected vs confirmed reconciliation interaction." },
  { to: "/feedback", label: "Feedback", blurb: "Attention classification and propagation status." },
];

export function AppHeader({
  eyebrow,
  width = "max-w-3xl",
  right,
  status = false,
}: {
  eyebrow?: string;
  width?: string;
  right?: ReactNode;
  /** Opt-in only for surfaces that genuinely show synthetic/demo state. */
  status?: boolean;
}) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className={`mx-auto grid ${width} grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3`}>
          <Link to="/" className="flex min-w-0 items-center gap-2.5">
            <FoodOsWordmark />
            {eyebrow ? (
              <span className="hidden truncate text-[11px] uppercase tracking-[0.16em] text-muted-foreground sm:inline">{eyebrow}</span>
            ) : null}
          </Link>
          <div className="flex items-center gap-1.5">
            <nav className="hidden items-center gap-1 sm:flex">
              {HOUSEHOLD_NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="rounded-full px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
        {status ? (
          <div className="border-t border-border/50 bg-[var(--ctl-surface-sunken)]">
            <div className={`mx-auto grid ${width} grid-cols-[auto_minmax(0,1fr)] items-start gap-2 px-5 py-1.5 text-[11.5px] leading-snug text-muted-foreground`}>
              <span className="mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Demo household on synthetic data. No retailer is connected, so foodOS cannot place an order.</span>
            </div>
          </div>
        ) : null}
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 backdrop-blur sm:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {HOUSEHOLD_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex flex-col items-center gap-1 px-2 py-2.5 text-[11px] font-medium text-muted-foreground"
              activeProps={{ className: "text-primary" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              <item.icon className="h-[18px] w-[18px]" />
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}

export function AppFooter({ width = "max-w-3xl" }: { width?: string }) {
  return (
    <footer className="border-t border-border/60">
      <div className={`mx-auto flex ${width} flex-col gap-2 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between`}>
        <p>foodOS · simple outside, serious inside</p>
      </div>
    </footer>
  );
}
