import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import foodCover from "@/assets/food-cover.jpg";
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
import { getOperatorInventory, type OperatorInventoryItem } from "@/lib/operator-inventory.functions";
import { getOperatorWeek, startOperatorSession } from "@/lib/operator-week.functions";
import { deliveryStockView } from "@/lib/household-view/delivery";

export const Route = createFileRoute("/food")({
  head: () => ({
    meta: [
      { title: "Food you have — foodOS" },
      {
        name: "description",
        content: "See the household's current food by where it lives, then correct or update it explicitly.",
      },
      { property: "og:title", content: "Food you have — foodOS" },
      {
        property: "og:description",
        content: "Household stock, grouped by practical location and category.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FoodPage,
});

function FoodPage() {
  const [inventory, setInventory] = useState<OperatorInventoryItem[] | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const loadInventory = useCallback(async () => {
    try {
      const result = await getOperatorInventory();
      if (result.ok) {
        setInventory(result.items);
        setError(null);
      } else {
        setInventory(null);
        setError(result.detail);
      }
    } catch (cause) {
      setInventory(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const result = await startOperatorSession({ data: { token } });
      if (!result.ok) throw new Error(result.error ?? "Could not connect to FoodOS");
      setToken("");
      await loadInventory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnecting(false);
    }
  };

  const groups = useMemo(() => {
    if (!inventory) return [];
    const grouped = new Map<string, OperatorInventoryItem[]>();
    for (const item of inventory) {
      const key = `${item.location} · ${item.category}`;
      const current = grouped.get(key) ?? [];
      current.push(item);
      grouped.set(key, current);
    }
    return [...grouped.entries()];
  }, [inventory]);

  const totalItems = inventory?.length ?? 0;

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" />
      <Shell>
        <PageTitle
          eyebrow="Food"
          title="What you have"
          lede={
            inventory
              ? `${totalItems} stock lines from the household record, grouped by where they actually live. Scheduled meals never reduce this number.`
              : "See the household's real stock, then tell FoodOS when something has changed."
          }
        />

        {!inventory ? (
          <section className="mb-7 rounded-2xl border border-border bg-card p-4 sm:p-5">
            <SectionHeading title="Connect FoodOS" />
            <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
              Connect once to see the current household stock. The credential is used only to establish a short-lived session; it is never shown back or stored in the page.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Operator credential"
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => void connect()}
                disabled={connecting || !token.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {connecting ? "Connecting…" : "Connect"}
              </button>
            </div>
            {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
          </section>
        ) : null}

        <section className="mb-7 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <SectionHeading title="Household control" />
          <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
            Change stock only when something actually changed: correct the amount, record food used or wasted, or add something new. FoodOS never infers consumption from a planned meal.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/stock" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Update stock</Link>
            <Link to="/sweep" className="rounded-md border px-3 py-2 text-sm font-medium">Quick stock sweep</Link>
            <Link to="/cycle" className="rounded-md border px-3 py-2 text-sm font-medium">View weekly cycle</Link>
          </div>
        </section>

        <ImageSlot src={foodCover} alt="Neatly organised fridge shelves and pantry jars" className="mb-7" />

        {inventory ? (
          <section className="mb-7">
            <SectionHeading title="Your food" action={<Pill tone="good">Live</Pill>} />
            {groups.map(([group, items]) => (
              <section key={group} className="mb-5">
                <SectionHeading title={group} action={<Pill tone="neutral">{items.length}</Pill>} />
                <Group>
                  {items.map((item) => (
                    <Row key={item.id}>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold leading-snug">{item.item}</p>
                          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                            {item.status ? `${item.status} · ` : ""}{item.bestBefore ? `best before ${item.bestBefore}` : "No date recorded"}
                          </p>
                        </div>
                        <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums">
                          {item.quantity === null ? "—" : item.quantity}
                          {item.unit ? <span className="ml-1 text-[12px] font-medium text-muted-foreground">{item.unit}</span> : null}
                        </span>
                      </div>
                    </Row>
                  ))}
                </Group>
              </section>
            ))}
          </section>
        ) : null}

        <section className="mb-7">
          <SectionHeading
            title="Last delivery"
            action={<Pill tone={deliveryStockView.settled ? "good" : "attention"}>{deliveryStockView.settled ? "Settled" : "Needs a check"}</Pill>}
          />
          <p className="mb-3 -mt-1 text-[13px] text-muted-foreground">
            {deliveryStockView.lineCount} checked-off {deliveryStockView.lineCount === 1 ? "item" : "items"} were added through the approved delivery flow.
          </p>
          <Evidence label="Why this is here">
            Delivery intake is already part of the protected household state path. This summary is retained here so the household can understand why newly delivered stock appeared without having to reconcile it manually.
          </Evidence>
        </section>

        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Something look wrong?{" "}
          <Link to="/stock" className="font-medium text-primary underline-offset-4 hover:underline">Tell FoodOS what you actually have</Link>
          {" "}or <Link to="/sweep" className="font-medium text-primary underline-offset-4 hover:underline">run a quick stock sweep</Link>.
        </p>
      </Shell>
      <AppFooter />
    </div>
  );
}
