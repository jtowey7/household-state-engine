import { createFileRoute } from "@tanstack/react-router";
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
import { describeAddFoodForm, describeExistingFoodChoice } from "@/lib/food-ui/add-food-form";
import {
  browsableLocations,
  filterBrowsableFoods,
} from "@/lib/food-ui/inventory-browse";
import { matchExistingInventory } from "@/lib/food-ui/inventory-match";
import { compactInventoryContext } from "@/lib/food-ui/inventory-presentation";
import { COMMON_UNIT_CHIPS } from "@/lib/food-ui/unit-chips";
import { resolveAddedAmount } from "@/lib/food-ui/add-food-quantity";
import { householdRefusalMessage } from "@/lib/food-ui/refusal-copy";
import { getOperatorInventory, type OperatorInventoryItem } from "@/lib/operator-inventory.functions";
import { startOperatorSession } from "@/lib/operator-week.functions";
import {
  changedPrefill,
  someLeftPrefill,
  wholeAmountGonePrefill,
  type ActionPrefill,
} from "@/lib/household-input/action-shortcuts";
import { prepareHouseholdIntake, authorizationFromRequest } from "@/lib/household-input/intake";
import { parseNaturalQuantity } from "@/lib/household-input/natural-quantity";
import { releaseHumanDelivery } from "@/lib/household-input/release.functions";
import type { HouseholdIntakeSubmission } from "@/lib/household-input/types";
import { deliveryStockView } from "@/lib/household-view/delivery";
import { foodGroupEmoji, groupFoods, type FoodGroupName } from "@/lib/household-view/food-grouping";


export const Route = createFileRoute("/food")({
  head: () => ({
    meta: [
      { title: "Food you have — foodOS" },
      { name: "description", content: "See the household's current food, then correct or update it explicitly." },
      { property: "og:title", content: "Food you have — foodOS" },
      { property: "og:description", content: "Everything your household has in, in simple food groups." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FoodPage,
});

type StockAction = "USED" | "WASTED" | "CHANGED" | "ADDED";
type ActiveAction = { action: StockAction; item: OperatorInventoryItem | null };

type ParsedFood = { description: string; quantity: string; unit: string };

function parseNaturalFoodDescription(value: string): ParsedFood {
  const parsed = parseNaturalQuantity(value);
  if (!parsed.resolved) return { description: parsed.item, quantity: "", unit: "" };
  return { description: parsed.item, quantity: String(parsed.quantity), unit: parsed.unit };
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
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeLocation, setActiveLocation] = useState<string | null>(null);
  const [showUnitDetails, setShowUnitDetails] = useState(false);

  const categories = useMemo(() => browsableCategories(inventory ?? []), [inventory]);
  const locations = useMemo(() => browsableLocations(inventory ?? []), [inventory]);

  const clearFilters = () => {
    setSearchQuery("");
    setActiveCategory(null);
    setActiveLocation(null);
  };

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

  const filteredFoods = useMemo(() => {
    if (!inventory) return [];
    return filterBrowsableFoods(inventory, {
      query: searchQuery,
      location: activeLocation,
    });
  }, [inventory, searchQuery, activeLocation]);

  const naturalPreview = useMemo(() => {
    if (activeAction?.action !== "ADDED") return null;
    if (!actionItem.trim()) return null;
    if (actionQuantity.trim() && actionUnit.trim()) return null;
    return parseNaturalQuantity(actionItem);
  }, [activeAction, actionItem, actionQuantity, actionUnit]);

  // Natural input such as "2 pints of milk" fills the food, amount and unit
  // fields so the household can review and edit them before adding.
  useEffect(() => {
    if (activeAction?.action !== "ADDED") return;
    if (actionQuantity.trim() || actionUnit.trim()) return;
    const parsed = parseNaturalQuantity(actionItem);
    if (!parsed.resolved) return;
    setActionItem(parsed.item);
    setActionQuantity(String(parsed.quantity));
    setActionUnit(parsed.unit);
  }, [activeAction, actionItem, actionQuantity, actionUnit]);

  const addFoodForm = useMemo(
    () => describeAddFoodForm({ item: actionItem, quantity: actionQuantity, unit: actionUnit }),
    [actionItem, actionQuantity, actionUnit],
  );

  // Unit chips are the only unit control in the Add flow. A unit the parser
  // resolved (e.g. "litres") is shown as a selected chip so nothing is lost.
  const addUnitOptions = useMemo<string[]>(() => {
    const typed = actionUnit.trim();
    const chips: string[] = [...COMMON_UNIT_CHIPS];
    if (typed && !chips.some((chip) => chip.toLowerCase() === typed.toLowerCase())) chips.unshift(typed);
    return chips;
  }, [actionUnit]);

  const addItemName = useMemo(() => {
    if (activeAction?.action !== "ADDED") return "";
    if (naturalPreview?.resolved) return naturalPreview.item;
    return actionItem.trim();
  }, [activeAction, naturalPreview, actionItem]);

  const addMatch = useMemo(() => {
    if (!addItemName || !inventory) return null;
    return matchExistingInventory(addItemName, inventory);
  }, [addItemName, inventory]);

  const acceptMatch = (canonicalItem: string) => {
    setActionItem(canonicalItem);
    if (naturalPreview?.resolved) {
      setActionQuantity(String(naturalPreview.quantity));
      setActionUnit(naturalPreview.unit);
    }
    setShowUnitDetails(false);
  };

  const openAction = (action: StockAction, item: OperatorInventoryItem | null = null) => {
    setActiveAction({ action, item });
    setSavedNotice(null);
    const prefill: ActionPrefill = item
      ? action === "CHANGED"
        ? changedPrefill(item)
        : action === "USED" || action === "WASTED"
          ? someLeftPrefill(item)
          : { item: item.item, quantity: "", unit: item.unit ?? "" }
      : { item: "", quantity: "", unit: "" };
    setActionItem(prefill.item);
    setActionQuantity(prefill.quantity);
    setActionUnit(prefill.unit);
    setActionResult(null);
    setActionSubmission(null);
    setPreparedAt(null);
    setReleaseResult(null);
    setShowUnitDetails(false);
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
    setShowUnitDetails(false);
  };

  const applyWholeAmountGone = () => {
    if (!activeAction?.item) return;
    const prefill = wholeAmountGonePrefill(activeAction.item);
    setActionItem(prefill.item);
    setActionQuantity(prefill.quantity);
    setActionUnit(prefill.unit);
    prepareAction(prefill);
  };

  const openAllGone = (item: OperatorInventoryItem) => {
    setActiveAction({ action: "USED", item });
    setSavedNotice(null);
    const prefill = wholeAmountGonePrefill(item);
    setActionItem(prefill.item);
    setActionQuantity(prefill.quantity);
    setActionUnit(prefill.unit);
    setActionResult(null);
    setActionSubmission(null);
    setPreparedAt(null);
    setReleaseResult(null);
    setShowUnitDetails(false);
    prepareAction(prefill, { action: "USED", item });
  };

  const prepareAction = (prefill?: ActionPrefill, overrideAction?: ActiveAction) => {
    const currentAction = overrideAction ?? activeAction;
    if (!currentAction) return;
    const baseItem = prefill?.item ?? actionItem;
    const baseQuantity = prefill?.quantity ?? actionQuantity;
    const baseUnit = prefill?.unit ?? actionUnit;
    const parsed = currentAction.action === "ADDED" ? parseNaturalFoodDescription(baseItem) : { description: baseItem.trim(), quantity: baseQuantity, unit: baseUnit.trim() };
    const item = parsed.description;
    const quantityText = parsed.quantity || baseQuantity;
    const unit = parsed.unit || baseUnit.trim();
    const quantity = Number(quantityText);
    if (!item || !unit || !Number.isFinite(quantity) || quantity < 0) {
      setActionResult({ ok: false, code: "STOCK_INPUT_REFUSED", detail: currentAction.action === "ADDED" ? "Try something like “two packs of mince”, or give the food, amount and unit separately." : "Give the food a name, an exact amount left, and a unit. FoodOS will not guess any of them." });
      return;
    }

    // Adding food to something the household already has means the amount now
    // there is the existing amount plus the new one. Nothing is guessed.
    const added = currentAction.action === "ADDED"
      ? resolveAddedAmount({ item, quantity, unit, existing: inventory ?? [] })
      : null;
    if (added && !added.ok) {
      setActionResult({ ok: false, code: "STOCK_INPUT_REFUSED", detail: added.message });
      return;
    }
    const itemKey = added?.ok ? (added.matchedItem ?? item) : item;
    const stateAfter = added?.ok ? added.stateAfter : quantity;
    const stateBefore = added?.ok
      ? added.stateBefore
      : currentAction.item?.quantity != null
        ? currentAction.item.quantity
        : null;


    const now = new Date().toISOString();
    const reason = currentAction.action === "USED"
      ? "Explicit household action: food consumed; human stated the amount now remaining."
      : currentAction.action === "WASTED"
        ? "Explicit household action: food discarded; human stated the amount now remaining."
        : currentAction.action === "ADDED"
          ? "Explicit household action: new food added to household stock. Natural household description was parsed into a quantity and unit before entering the existing canonical event path."
          : "Explicit household action: household stock changed; human stated the corrected amount.";

    const submission: HouseholdIntakeSubmission = {
      kind: "STOCK_CORRECTION",
      report: {
        exceptionId: `HOUSEHOLD-STOCK-${crypto.randomUUID()}`,
        itemKey: itemKey,
        statedStateAfter: stateAfter,
        unit,
        observedAt: now,
        reportedBy: "household operator",
        source: "FoodOS household inventory",
        evidence: `Household operator explicitly reported the ${currentAction.action === "USED" ? "consumed" : currentAction.action === "WASTED" ? "discarded" : currentAction.action.toLowerCase()} / stock change for ${item} from the household control surface.`,
        confidence: "High",
        reason,
        ...(stateBefore != null ? { statedStateBefore: stateBefore } : {}),
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
        approvedBy: "household operator",
        approvedAt: new Date().toISOString(),
        evidenceDetail: "Household operator explicitly approved the exact stock change shown in the FoodOS household control surface.",
      }));
      const result = await releaseHumanDelivery({ data: { submission: actionSubmission, approvals, preparedAt } });
      setReleaseResult(result);
      if (result.ok && result.written) {
        const savedItem = actionSubmission.kind === "STOCK_CORRECTION" ? actionSubmission.report.itemKey : "Item";
        closeAction();
        setSavedNotice(`${savedItem} updated.`);
        await loadInventory();
      }
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
        <PageTitle eyebrow="Food" title="What you have" lede={inventory ? "Everything foodOS knows you have. Tap a food to update it." : "See what's in the house, then tell foodOS when something runs out, gets binned, or comes home."} />

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
          </div>
        ) : null}

        {savedNotice ? (
          <p role="status" className="mb-7 rounded-xl border border-primary/20 bg-card px-4 py-3 text-[14px] font-medium">✓ {savedNotice} What you have below is up to date.</p>
        ) : null}

        {activeAction ? (
          <section className="mb-7 rounded-2xl border border-primary/30 bg-card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SectionHeading title={activeAction.action === "ADDED" ? "Add food" : activeAction.action === "USED" ? "Used" : activeAction.action === "WASTED" ? "Wasted" : "Change amount"} />
                {activeAction.item ? <p className="-mt-1 text-[18px] font-semibold leading-snug">{activeAction.item.item}</p> : null}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={closeAction}>Close</Button>
            </div>
            <p className="mb-4 mt-2 text-[13px] leading-relaxed text-muted-foreground">{activeAction.action === "ADDED" ? "Describe what came home, or enter the amount yourself." : activeAction.action === "CHANGED" ? "Enter the correct amount now." : "Enter how much is left now."}</p>
            {activeAction.item && (activeAction.action === "USED" || activeAction.action === "WASTED") ? (
              <div className="mb-4">
                <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={applyWholeAmountGone}>All gone</Button>
              </div>
            ) : null}
            {activeAction.action === "ADDED" ? (
              <>
                <div className="mb-3">
                  <label htmlFor="stock-food" className="mb-1.5 block text-[13px] font-medium">What came home?</label>
                  <Input id="stock-food" aria-label="Food" placeholder="e.g. 2 pints of milk" value={actionItem} onChange={(e) => setActionItem(e.target.value)} />
                </div>
                <div className="mb-3">
                  <label htmlFor="stock-amount" className="mb-1.5 block text-[13px] font-medium">How much</label>
                  <Input id="stock-amount" aria-label="How much" inputMode="decimal" placeholder="e.g. 2" value={actionQuantity} onChange={(e) => setActionQuantity(e.target.value)} />
                </div>
                <div className="mb-3">
                  <p className="mb-1.5 text-[13px] font-medium">Unit</p>
                  <div className="flex flex-wrap gap-1.5">
                    {addUnitOptions.map((chip) => {
                      const active = actionUnit.trim().toLowerCase() === chip.toLowerCase();
                      return <Button key={chip} type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} onClick={() => setActionUnit(chip)}>{chip}</Button>;
                    })}
                  </div>
                </div>
                {addFoodForm.summary ? (
                  <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">
                    Adding <span className="font-semibold text-foreground">{addFoodForm.summary}</span>. Change anything above before you add it.
                  </p>
                ) : (
                  <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">{addFoodForm.hint}</p>
                )}
                <Button type="button" className="w-full" disabled={!addFoodForm.complete} onClick={() => prepareAction()}>
                  {addFoodForm.primaryLabel}
                </Button>
              </>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div>
                    <label htmlFor="stock-amount" className="mb-1.5 block text-[13px] font-medium">Amount now</label>
                    <Input id="stock-amount" aria-label="Amount now" inputMode="decimal" placeholder="Enter an exact amount" value={actionQuantity} onChange={(e) => setActionQuantity(e.target.value)} />
                  </div>
                  <Button type="button" className="w-full sm:w-auto" onClick={() => prepareAction()}>Review</Button>
                </div>
                <Button type="button" size="sm" variant="ghost" className="mt-2" aria-expanded={showUnitDetails} onClick={() => setShowUnitDetails((shown) => !shown)}>
                  {actionUnit ? `Unit: ${actionUnit}` : "Choose a unit"} {showUnitDetails ? "▴" : "▾"}
                </Button>
                {showUnitDetails ? (
                  <div className="mt-2 rounded-lg bg-muted/60 p-3">
                    <label htmlFor="stock-unit" className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Unit</label>
                    <Input id="stock-unit" aria-label="Unit" placeholder="pack, kg, g…" value={actionUnit} onChange={(e) => setActionUnit(e.target.value)} />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {COMMON_UNIT_CHIPS.map((chip) => {
                        const active = actionUnit.trim().toLowerCase() === chip;
                        return <Button key={chip} type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} onClick={() => setActionUnit(chip)}>{chip}</Button>;
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            )}
            {addMatch ? (
              <div className="mt-3 rounded-lg bg-muted/60 p-3">
                {addMatch.kind === "unique" ? (
                  (() => {
                    const choice = describeExistingFoodChoice({
                      existingItem: addMatch.match.item,
                      quantity: actionQuantity,
                      unit: actionUnit,
                    });
                    return (
                      <>
                        <p className="text-[13px] font-medium leading-relaxed">{choice.heading}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button type="button" size="sm" onClick={() => acceptMatch(addMatch.match.item)}>
                            {choice.primaryLabel}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => acceptMatch(addItemName)}
                          >
                            {choice.secondaryLabel}
                          </Button>
                        </div>
                      </>
                    );
                  })()
                ) : addMatch.kind === "ambiguous" ? (
                  <>
                    <p className="text-[13px] leading-relaxed">
                      More than one food could match “{addItemName}”, so foodOS will not guess. Choose one, or
                      keep what you typed.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {addMatch.candidates.map((candidate) => (
                        <Button
                          key={candidate.id}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => acceptMatch(candidate.item)}
                        >
                          {candidate.item}
                        </Button>
                      ))}
                      <Button type="button" size="sm" onClick={() => acceptMatch(addItemName)}>
                        Keep “{addItemName}”
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    No food you already have matches “{addItemName}”. Carry on to add it as new, or type the
                    name as it appears in your food list.
                  </p>
                )}
              </div>
            ) : null}
            {actionResult ? (
              <div className="mt-4">
                {actionResult.ok ? (
                  <>
                    <Evidence label="Ready for review, but not saved yet">{actionResult.approvalRequests[0]?.summary ?? "One household stock update is ready."} This change is ready for review, but FoodOS cannot save a routine stock change like this yet. Nothing in your kitchen record has changed.</Evidence>
                    <div className="mt-3 inline-flex items-center rounded-md bg-muted px-3 py-2 text-[13px] font-medium text-muted-foreground">
                      FoodOS can't save this yet
                    </div>
                  </>
                ) : <Evidence label="FoodOS needs a clearer report">{householdRefusalMessage(actionResult)}</Evidence>}
              </div>
            ) : null}
            {releaseResult ? (
              <div className="mt-3">
                {releaseResult.ok ? <Evidence label={releaseResult.written ? "Saved" : "Not saved"}>{releaseResult.written ? "Saved to your household record — what you have above is up to date." : "foodOS did not save anything; the approval step did not complete, so nothing changed."}</Evidence> : <Evidence label="Change refused">{householdRefusalMessage(releaseResult)}</Evidence>}
              </div>
            ) : null}
          </section>
        ) : null}

        {inventory ? (
          <section className="mb-7">
            <SectionHeading title="Your food" />
            <div className="mb-4">
              <label htmlFor="food-search" className="sr-only">Find food</label>
              <Input
                id="food-search"
                type="search"
                autoComplete="off"
                placeholder="Find food by name, where it is, or category…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {categories.length > 0 || locations.length > 0 ? (
              <div className="mb-4 flex flex-wrap gap-4">
                {locations.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-[12px] font-medium text-muted-foreground">Where it is</p>
                    <div className="flex flex-wrap gap-1.5">
                      {locations.map((loc) => (
                        <Button
                          key={loc}
                          type="button"
                          size="sm"
                          variant={activeLocation === loc ? "default" : "outline"}
                          aria-pressed={activeLocation === loc}
                          onClick={() => setActiveLocation(activeLocation === loc ? null : loc)}
                        >
                          {loc}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {categories.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-[12px] font-medium text-muted-foreground">Category</p>
                    <div className="flex flex-wrap gap-1.5">
                      {categories.map((cat) => (
                        <Button
                          key={cat}
                          type="button"
                          size="sm"
                          variant={activeCategory === cat ? "default" : "outline"}
                          aria-pressed={activeCategory === cat}
                          onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                        >
                          {cat}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {(searchQuery.trim() || activeCategory || activeLocation) ? (
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="text-[12px] text-muted-foreground">
                  {filteredGroups.flatMap(([, list]) => list).length} {filteredGroups.flatMap(([, list]) => list).length === 1 ? "match" : "matches"}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
              </div>
            ) : null}
            {filteredGroups.length === 0 ? (
              <div className="space-y-2">
                <p className="text-[14px] text-muted-foreground">No food matches your filters.</p>
                {(searchQuery.trim() || activeCategory || activeLocation) ? (
                  <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
                ) : null}
              </div>
            ) : (
              filteredGroups.map(([group, items]) => (
                <section key={group} className="mb-5">
                  <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{foodGroupEmoji(group)} {group}</h2>
                  <Group>
                    {items.map((item) => {
                      const open = openItemId === item.id;
                      const context = compactInventoryContext(item.location, item.category);
                      const hasContext = context.location || context.category || item.bestBefore;
                      return (
                        <Row key={item.id}>
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => setOpenItemId(open ? null : item.id)}
                            className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1 text-left"
                          >
                            <span className="min-w-0">
                              <span className="block text-[15px] font-semibold leading-snug">{item.item}</span>
                              {hasContext ? (
                                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] leading-relaxed text-muted-foreground">
                                  {[
                                    context.location,
                                    context.category,
                                    item.bestBefore ? `best before ${item.bestBefore}` : null,
                                  ]
                                    .filter((part): part is string => Boolean(part))
                                    .map((part, index) => (
                                      <span key={part} className="flex items-center gap-x-1.5">
                                        {index > 0 ? <span aria-hidden>·</span> : null}
                                        {part}
                                      </span>
                                    ))}
                                </span>
                              ) : null}
                            </span>
                            <span className="flex shrink-0 items-center gap-2 text-right">
                              <span className="text-[15px] font-semibold tabular-nums">{item.quantity === null ? "—" : item.quantity}{item.unit ? <span className="ml-1 text-[12px] font-medium text-muted-foreground">{item.unit}</span> : null}</span>
                              <span aria-hidden className="text-muted-foreground">{open ? "▾" : "▸"}</span>
                            </span>
                          </button>
                          {open ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <Button type="button" size="sm" variant="outline" onClick={() => openAction("USED", item)}>Used</Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => openAction("WASTED", item)}>Wasted</Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => openAction("CHANGED", item)}>Changed</Button>
                              {item.unit ? (
                                <Button type="button" size="sm" onClick={() => openAllGone(item)}>All gone</Button>
                              ) : null}
                            </div>
                          ) : null}

                        </Row>
                      );
                    })}
                  </Group>
                </section>
              ))
            )}
          </section>
        ) : null}


        <ImageSlot src={foodCover} alt="Neatly organised fridge shelves and pantry jars" className="mb-7" />

        <section className="mb-7">
          <SectionHeading title="Last delivery" action={<Pill tone={deliveryStockView.settled ? "good" : "attention"}>{deliveryStockView.settled ? "Counted" : "Needs a check"}</Pill>} />
          <p className="mb-3 -mt-1 text-[13px] text-muted-foreground">{deliveryStockView.lineCount} checked-off {deliveryStockView.lineCount === 1 ? "item" : "items"} from your last delivery are included above.</p>
          <Evidence label="Why this is here">Delivered food you approved is added to what you have automatically, so you don't have to count it in twice.</Evidence>
        </section>

        <p className="text-[13px] leading-relaxed text-muted-foreground">Something look wrong? Tap the food above and tell foodOS what changed.</p>
      </Shell>
      <AppFooter />
    </div>
  );
}