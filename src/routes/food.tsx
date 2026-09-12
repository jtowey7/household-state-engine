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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getOperatorInventory, type OperatorInventoryItem } from "@/lib/operator-inventory.functions";
import { startOperatorSession } from "@/lib/operator-week.functions";
import { prepareHouseholdIntake, authorizationFromRequest } from "@/lib/household-input/intake";
import { releaseHumanDelivery } from "@/lib/household-input/release.functions";
import type { HouseholdIntakeSubmission } from "@/lib/household-input/types";
import { deliveryStockView } from "@/lib/household-view/delivery";

export const Route = createFileRoute("/food")({
  head: () => ({
    meta: [
      { title: "Food you have — foodOS" },
      { name: "description", content: "See the household's current food by where it lives, then correct or update it explicitly." },
      { property: "og:title", content: "Food you have — foodOS" },
      { property: "og:description", content: "Household stock, grouped by practical location and category." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FoodPage,
});

type StockAction = "USED" | "WASTED" | "CHANGED" | "ADDED";
type ActiveAction = { action: StockAction; item: OperatorInventoryItem | null };

type ParsedFood = { description: string; quantity: string; unit: string };

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseNaturalFoodDescription(value: string): ParsedFood {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return { description: "", quantity: "", unit: "" };

  const match = trimmed.match(/^(?:(\d+(?:\.\d+)?)|(one|two|three|four|five|six|seven|eight|nine|ten))\s+(packs?|packet|packets|bags?|boxes?|bottles?|tubs?|jars?|tins?|cans?|cartons?|loaves?|kg|kgs|kilograms?|g|grams?|l|litres?|liters?|ml)\s+(.+)$/i);
  if (!match) return { description: trimmed, quantity: "", unit: "" };

  const quantity = match[1] ?? NUMBER_WORDS[(match[2] ?? "").toLowerCase()] ?? "";
  const rawUnit = (match[3] ?? "").toLowerCase();
  const unit = rawUnit.startsWith("pack") ? "pack" : rawUnit.replace(/s$/, "");
  return { description: match[4] ?? trimmed, quantity: String(quantity), unit };
}

function locationEmoji(group: string): string {
  const lower = group.toLowerCase();
  if (lower.includes("fridge") || lower.includes("chill")) return "🧊";
  if (lower.includes("freezer") || lower.includes("frozen")) return "❄️";
  if (lower.includes("pantry") || lower.includes("cupboard") || lower.includes("larder")) return "🥫";
  if (lower.includes("fruit") || lower.includes("veg") || lower.includes("counter")) return "🍎";
  return "🧺";
}

function FoodPage() {
  const [inventory, setInventory] = useState<OperatorInventoryItem[] | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null);
  const [actionItem, setActionItem] = useState("");
  const [actionQuantity, setActionQuantity] = useState("");
  const [actionUnit, setActionUnit] = useState("");
  const [actionResult, setActionResult] = useState<ReturnType<typeof prepareHouseholdIntake> | null>(null);
  const [actionSubmission, setActionSubmission] = useState<HouseholdIntakeSubmission | null>(null);
  const [preparedAt, setPreparedAt] = useState<string | null>(null);
  const [releaseResult, setReleaseResult] = useState<Awaited<ReturnType<typeof releaseHumanDelivery>> | null>(null);
  const [acting, setActing] = useState(false);

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

  useEffect(() => { void loadInventory(); }, [loadInventory]);

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
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()];
  }, [inventory]);

  const openAction = (action: StockAction, item: OperatorInventoryItem | null = null) => {
    setActiveAction({ action, item });
    setActionItem(item?.item ?? "");
    setActionQuantity(item?.quantity == null ? "" : String(item.quantity));
    setActionUnit(item?.unit ?? "");
    setActionResult(null);
    setActionSubmission(null);
    setPreparedAt(null);
    setReleaseResult(null);
  };

  const closeAction = () => {
    setActiveAction(null);
    setActionResult(null);
    setActionSubmission(null);
    setPreparedAt(null);
    setReleaseResult(null);
    setActionItem("");
    setActionQuantity("");
    setActionUnit("");
  };

  const prepareAction = () => {
    if (!activeAction) return;
    const parsed = activeAction.action === "ADDED" ? parseNaturalFoodDescription(actionItem) : { description: actionItem.trim(), quantity: actionQuantity, unit: actionUnit.trim() };
    const item = parsed.description;
    const quantityText = parsed.quantity || actionQuantity;
    const unit = parsed.unit || actionUnit.trim();
    const quantity = Number(quantityText);
    if (!item || !unit || !Number.isFinite(quantity) || quantity < 0) {
      setActionResult({ ok: false, code: "STOCK_INPUT_REFUSED", detail: activeAction.action === "ADDED" ? "Try something like “two packs of mince”, or give the food, amount and unit separately." : "Give the food a name, an exact amount left, and a unit. FoodOS will not guess any of them." });
      return;
    }

    const now = new Date().toISOString();
    const reason = activeAction.action === "USED"
      ? "Explicit household action: food consumed; human stated the amount now remaining."
      : activeAction.action === "WASTED"
        ? "Explicit household action: food discarded; human stated the amount now remaining."
        : activeAction.action === "ADDED"
          ? "Explicit household action: new food added to household stock. Natural household description was parsed into a quantity and unit before entering the existing canonical event path."
          : "Explicit household action: household stock changed; human stated the corrected amount.";

    const submission: HouseholdIntakeSubmission = {
      kind: "STOCK_CORRECTION",
      report: {
        exceptionId: `HOUSEHOLD-STOCK-${crypto.randomUUID()}`,
        itemKey: item,
        statedStateAfter: quantity,
        unit,
        observedAt: now,
        reportedBy: "James",
        source: "FoodOS household inventory",
        evidence: `James explicitly reported the ${activeAction.action === "USED" ? "consumed" : activeAction.action === "WASTED" ? "discarded" : activeAction.action.toLowerCase()} / stock change for ${item} from the household control surface.`,
        confidence: "High",
        reason,
        ...(activeAction.item?.quantity != null ? { statedStateBefore: activeAction.item.quantity } : {}),
        recordClass: "Production",
      },
    };

    const fixedPreparedAt = new Date().toISOString();
    try {
      setActionSubmission(submission);
      setPreparedAt(fixedPreparedAt);
      setReleaseResult(null);
      setActionResult(prepareHouseholdIntake(submission, { now: () => fixedPreparedAt }));
    } catch (cause) {
      setActionSubmission(null);
      setPreparedAt(null);
      setActionResult({ ok: false, code: "CANONICALISATION_FAILED", detail: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  const approveAction = async () => {
    if (!actionResult?.ok || !actionSubmission || !preparedAt) return;
    setActing(true);
    try {
      const approvals = actionResult.approvalRequests.map((request) => authorizationFromRequest(request, {
        authorizationId: `AUTH-${crypto.randomUUID()}`,
        approvedBy: "James",
        approvedAt: new Date().toISOString(),
        evidenceDetail: "James explicitly approved the exact stock change shown in the FoodOS household control surface.",
      }));
      const result = await releaseHumanDelivery({ data: { submission: actionSubmission, approvals, preparedAt } });
      setReleaseResult(result);
      if (result.ok && result.written) await loadInventory();
    } catch (cause) {
      setReleaseResult({ ok: false, code: "CANONICALISATION_FAILED", detail: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" />
      <Shell>
        <PageTitle eyebrow="Food" title="What you have" lede={inventory ? "Everything foodOS knows you have, grouped by where it lives. Tap a food to update it." : "See what's in the house, then tell foodOS when something runs out, gets binned, or comes home."} />

        {!inventory ? (
          <section className="mb-7 rounded-2xl border border-border bg-card p-4 sm:p-5">
            <SectionHeading title="Connect foodOS" />
            <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">Connect once to see what you have. The credential is used only to establish a short-lived session; it is never shown back or stored in the page.</p>
            <div className="flex gap-2">
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Your foodOS credential" className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" autoComplete="off" />
              <button type="button" onClick={() => void connect()} disabled={connecting || !token.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{connecting ? "Connecting…" : "Connect"}</button>
            </div>
            {error ? <p className="mt-3 text-[13px] text-destructive">{error}</p> : null}
          </section>
        ) : null}

        {inventory ? (
          <div className="mb-7 flex flex-wrap gap-2">
            <Button type="button" onClick={() => openAction("ADDED")}>+ Add food</Button>
            <Link to="/sweep" className="rounded-md border px-3 py-2 text-sm font-medium">Quick stock check</Link>
          </div>
        ) : null}

        {activeAction ? (
          <section className="mb-7 rounded-2xl border border-primary/30 bg-card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <SectionHeading title={activeAction.action === "USED" ? "Food consumed" : activeAction.action === "WASTED" ? "Food discarded" : activeAction.action === "ADDED" ? "Add food" : "Change stock"} />
              <Button type="button" variant="ghost" size="sm" onClick={closeAction}>Close</Button>
            </div>
            <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">{activeAction.action === "ADDED" ? "Just describe what you bought or brought home. For example: “two packs of mince”. foodOS will work out the exact amount before saving anything." : "Tell FoodOS the exact amount left now. Nothing is inferred from the meal plan or from time passing."}</p>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
              <Input aria-label="Food" placeholder={activeAction.action === "ADDED" ? "e.g. two packs of mince" : "Food"} value={actionItem} onChange={(e) => setActionItem(e.target.value)} />
              <Input aria-label="Amount now" inputMode="decimal" placeholder="Amount" value={actionQuantity} onChange={(e) => setActionQuantity(e.target.value)} />
              <Input aria-label="Unit" placeholder="pack, kg, g…" value={actionUnit} onChange={(e) => setActionUnit(e.target.value)} />
              <Button type="button" onClick={prepareAction}>Review change</Button>
            </div>
            {actionResult ? (
              <div className="mt-4">
                {actionResult.ok ? (
                  <>
                    <Evidence label="Ready for your approval">{actionResult.approvalRequests[0]?.summary ?? "One household stock event is ready."} The exact event will be written only after you approve it.</Evidence>
                    <Button type="button" className="mt-3" onClick={() => void approveAction()} disabled={acting}>{acting ? "Saving…" : "Approve this change"}</Button>
                  </>
                ) : <Evidence label="FoodOS needs a clearer report">{actionResult.detail}</Evidence>}
              </div>
            ) : null}
            {releaseResult ? (
              <div className="mt-3">
                {releaseResult.ok ? <Evidence label={releaseResult.written ? "Saved" : "Not saved"}>{releaseResult.written ? "Saved to your household record — what you have above is up to date." : "foodOS did not save anything; the approval step did not complete, so nothing changed."}</Evidence> : <Evidence label="Change refused">{releaseResult.detail}</Evidence>}
              </div>
            ) : null}
          </section>
        ) : null}

        {inventory ? (
          <section className="mb-7">
            <SectionHeading title="Your food" action={<Pill tone="neutral">{inventory.length} {inventory.length === 1 ? "item" : "items"}</Pill>} />
            {groups.map(([group, items]) => (
              <section key={group} className="mb-5">
                <SectionHeading title={`${locationEmoji(group)} ${group}`} action={<Pill tone="neutral">{items.length}</Pill>} />
                <Group>
                  {items.map((item) => (
                    <Row key={item.id}>
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold leading-snug">{item.item}</p>
                          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{item.status ? `${item.status} · ` : ""}{item.bestBefore ? `best before ${item.bestBefore}` : "No date recorded"}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Button type="button" size="sm" variant="outline" onClick={() => openAction("USED", item)}>Consumed</Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => openAction("WASTED", item)}>Discarded</Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => openAction("CHANGED", item)}>Changed</Button>
                          </div>
                        </div>
                        <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums">{item.quantity === null ? "—" : item.quantity}{item.unit ? <span className="ml-1 text-[12px] font-medium text-muted-foreground">{item.unit}</span> : null}</span>
                      </div>
                    </Row>
                  ))}
                </Group>
              </section>
            ))}
          </section>
        ) : null}

        <ImageSlot src={foodCover} alt="Neatly organised fridge shelves and pantry jars" className="mb-7" />

        <section className="mb-7">
          <SectionHeading title="Last delivery" action={<Pill tone={deliveryStockView.settled ? "good" : "attention"}>{deliveryStockView.settled ? "Counted" : "Needs a check"}</Pill>} />
          <p className="mb-3 -mt-1 text-[13px] text-muted-foreground">{deliveryStockView.lineCount} checked-off {deliveryStockView.lineCount === 1 ? "item" : "items"} from your last delivery are included above.</p>
          <Evidence label="Why this is here">Delivered food you approved is added to what you have automatically, so you don't have to count it in twice.</Evidence>
        </section>

        <p className="text-[13px] leading-relaxed text-muted-foreground">Something look wrong? <Link to="/sweep" className="font-medium text-primary underline-offset-4 hover:underline">Do a quick stock check</Link>.</p>
      </Shell>
      <AppFooter />
    </div>
  );
}