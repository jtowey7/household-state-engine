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
import { foodGroupEmoji, groupFoods } from "@/lib/household-view/food-grouping";

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

  const groups = useMemo(() => (inventory ? groupFoods(inventory) : []), [inventory]);

  const naturalPreview = useMemo(() => {
    if (activeAction?.action !== "ADDED") return null;
    if (!actionItem.trim()) return null;
    return parseNaturalQuantity(actionItem);
  }, [activeAction, actionItem]);

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

  const applyWholeAmountGone = () => {
    if (!activeAction?.item) return;
    const prefill = wholeAmountGonePrefill(activeAction.item);
    setActionItem(prefill.item);
    setActionQuantity(prefill.quantity);
    setActionUnit(prefill.unit);
    prepareAction(prefill);
  };

  const prepareAction = (prefill?: ActionPrefill) => {
    if (!activeAction) return;
    const baseItem = prefill?.item ?? actionItem;
    const baseQuantity = prefill?.quantity ?? actionQuantity;
    const baseUnit = prefill?.unit ?? actionUnit;
    const parsed = activeAction.action === "ADDED" ? parseNaturalFoodDescription(baseItem) : { description: baseItem.trim(), quantity: baseQuantity, unit: baseUnit.trim() };
    const item = parsed.description;
    const quantityText = parsed.quantity || baseQuantity;
    const unit = parsed.unit || baseUnit.trim();
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
              <SectionHeading title={activeAction.action === "USED" ? "Food consumed" : activeAction.action === "WASTED" ? "Food discarded" : activeAction.action === "ADDED" ? "Add food" : "Change stock"} />
              <Button type="button" variant="ghost" size="sm" onClick={closeAction}>Close</Button>
            </div>
            <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">{activeAction.action === "ADDED" ? "Just describe what you bought or brought home. For example: “two packs of mince”. foodOS will work out the exact amount before saving anything." : "Tell FoodOS the exact amount left now. Nothing is inferred from the meal plan or from time passing."}</p>
            {activeAction.item && (activeAction.action === "USED" || activeAction.action === "WASTED") ? (
              <div className="mb-4">
                <Button type="button" className="w-full sm:w-auto" onClick={applyWholeAmountGone}>
                  All of it is gone
                </Button>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">Some left? Enter the exact amount left below and choose Review change.</p>
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
              <Input aria-label="Food" placeholder={activeAction.action === "ADDED" ? "e.g. two packs of mince" : "Food"} value={actionItem} onChange={(e) => setActionItem(e.target.value)} />
              <Input aria-label="Amount now" inputMode="decimal" placeholder="Amount" value={actionQuantity} onChange={(e) => setActionQuantity(e.target.value)} />
              <Input aria-label="Unit" placeholder="pack, kg, g…" value={actionUnit} onChange={(e) => setActionUnit(e.target.value)} />
              <Button type="button" onClick={() => prepareAction()}>Review change</Button>
            </div>
            {naturalPreview ? (
              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                {naturalPreview.resolved ? (
                  <>foodOS read that as <span className="font-semibold text-foreground">{naturalPreview.quantity} {naturalPreview.unit}</span> of <span className="font-semibold text-foreground">{naturalPreview.item}</span>. Not right? Type the amount and unit yourself.</>
                ) : (
                  <>foodOS can't tell how much that is. Add an amount and unit — like “two packs of mince” — or fill the two boxes.</>
                )}
              </p>
            ) : null}
            {actionResult ? (
              <div className="mt-4">
                {actionResult.ok ? (
                  <>
                    <Evidence label="Ready to save">{actionResult.approvalRequests[0]?.summary ?? "One household stock update is ready."} Check this looks right, then save it.</Evidence>
                    <Button type="button" className="mt-3" onClick={() => void approveAction()} disabled={acting}>{acting ? "Saving…" : "Save this update"}</Button>
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
            <SectionHeading title="Your food" />
            {groups.map(([group, items]) => (
              <section key={group} className="mb-5">
                <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{foodGroupEmoji(group)} {group}</h2>
                <Group>
                  {items.map((item) => {
                    const open = openItemId === item.id;
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
                            {item.bestBefore ? <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">best before {item.bestBefore}</span> : null}
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
                          </div>
                        ) : null}
                      </Row>
                    );
                  })}
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

        <p className="text-[13px] leading-relaxed text-muted-foreground">Something look wrong? Tap the food above and tell foodOS what changed.</p>
      </Shell>
      <AppFooter />
    </div>
  );
}