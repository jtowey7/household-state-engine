import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "foodOS — your household food operation" },
      {
        name: "description",
        content:
          "foodOS keeps your household food under control: what's happening this week, what you already have, and what needs doing next.",
      },
      { property: "og:title", content: "foodOS — your household food operation" },
      {
        property: "og:description",
        content:
          "foodOS keeps your household food under control: what's happening this week, what you already have, and what needs doing next.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/cycle" });
  },
  component: () => null,
});
