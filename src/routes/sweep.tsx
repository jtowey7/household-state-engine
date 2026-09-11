import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy route: the old Quick Stock Sweep was a synthetic TEST-only surface.
 * It must never be presented as a household control surface. Real household
 * inventory actions now live on /food, where they use the canonical inventory
 * identity and protected household-state path.
 */
export const Route = createFileRoute("/sweep")({
  beforeLoad: () => {
    throw redirect({ to: "/food" });
  },
  component: () => null,
});
