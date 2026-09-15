import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, TriangleAlert } from "lucide-react";
import { AppHeader, AppFooter } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Evidence, Group, PageTitle, Row, SectionHeading, Shell } from "@/components/household/household-ui";
import { prepareHouseholdIntake, authorizationFromRequest } from "@/lib/household-input/intake";
import { releaseHumanDelivery } from "@/lib/household-input/release.functions";
import { approveDeliveryBasket, getDeliveryBasket } from "@/lib/procurement/delivery-basket.functions";
import { getAppliedDeliveryReceipt } from "@/lib/household-view/delivery-receipt.functions";
import { describeDeliveryScreen } from "@/lib/household-view/delivery-screen";
import type { DeliveryReceiptDetection } from "@/lib/household-view/delivery-receipt";

import { startOperatorSession } from "@/lib/operator-week.functions";
import type { DeliveryBasketRead } from "@/lib/procurement/delivery-basket.functions";
import type { HouseholdIntakeSubmission } from "@/lib/household-input/types";

export const Route = createFileRoute("/delivery")({
  head: () => ({ meta: [{ title: "Record a delivery — foodOS" }, { name: "description", content: "Review the canonical basket, confirm delivery, record only exceptions, and review exact household events before any state change." }] }),
  component: DeliveryPage,
});

type DeliveryState = "ARRIVED" | "MISSING" | "SUBSTITUTED";
type Line = { lineId: string; itemKey: string; productName: string; orderedQuantity: number; unit: string; state: DeliveryState; replacementItemKey: string };

function isOperatorAuthError(detail: string) {
  return /Operator session required|Operator session expired|Invalid operator session/.test(detail);
}

function DeliveryPage() {
  const [basket, setBasket] = useState<DeliveryBasketRead | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operatorToken, setOperatorToken] = useState("");
  const [operatorError, setOperatorError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [needsOperatorSession, setNeedsOperatorSession] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [result, setResult] = useState<ReturnType<typeof prepareHouseholdIntake> | null>(null);
  const [submission, setSubmission] = useState<HouseholdIntakeSubmission | null>(null);
  const [preparedAt, setPreparedAt] = useState<string | null>(null);
  const [releaseResult, setReleaseResult] = useState<Awaited<ReturnType<typeof releaseHumanDelivery>> | null>(null);
  const [approvalResult, setApprovalResult] = useState<Awaited<ReturnType<typeof approveDeliveryBasket>> | null>(null);
  const [approving, setApproving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [alreadyCountedIn, setAlreadyCountedIn] = useState<Extract<DeliveryReceiptDetection, { confirmed: true }> | null>(null);


  const loadBasket = useCallback(() => {
    setLoadError(null);
    setAlreadyCountedIn(null);
    getDeliveryBasket().then(async (read) => {
      setBasket(read);
      if (read.status === "NOT_READY" && isOperatorAuthError(read.detail)) {
        setNeedsOperatorSession(true);
        return;
      }
      setNeedsOperatorSession(false);
      if (read.status === "READY" && read.approval.status === "APPROVED") {
        setLines(read.basket.lines.map((line, index) => ({ lineId: `${read.basket.basketId}:${index + 1}`, itemKey: line.itemKey, productName: line.productName, orderedQuantity: line.orderedQuantity, unit: line.packUnit, state: "ARRIVED", replacementItemKey: "" })));
      } else {
        setLines([]);
      }
      // Fail-closed: only Applied canonical delivery events for this exact
      // basket identity count as proof the food already arrived.
      if (read.status === "READY") {
        try {
          const receipt = await getAppliedDeliveryReceipt({ data: { basketId: read.basket.basketId, basketVersion: read.approval.basketVersion, basketFingerprint: read.approval.basketFingerprint } });
          setAlreadyCountedIn(receipt.status === "CONFIRMED" ? receipt.receipt : null);
        } catch {
          setAlreadyCountedIn(null);
        }
      }
    }).catch((error) => setLoadError(error instanceof Error ? error.message : "Unable to load the canonical delivery basket."));
  }, []);


  useEffect(() => { void loadBasket(); }, [loadBasket]);

  const connectOperator = async () => {
    setConnecting(true);
    setOperatorError(null);
    try {
      const response = await startOperatorSession({ data: { token: operatorToken } });
      if (!response.ok) throw new Error(response.error ?? "Operator authentication failed");
      setOperatorToken("");
      await loadBasket();
    } catch (error) {
      setOperatorError(error instanceof Error ? error.message : String(error));
    } finally {
      setConnecting(false);
    }
  };

  const updateLine = (index: number, patch: Partial<Line>) => setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const exceptionCount = useMemo(() => lines.filter((line) => line.state !== "ARRIVED").length, [lines]);

  const approveBasket = async () => {
    if (!basket || basket.status !== "READY" || basket.approval.status !== "PENDING") return;
    setApproving(true);
    setApprovalResult(null);
    try {
      const response = await approveDeliveryBasket({ data: { basketId: basket.basket.basketId, basketFingerprint: basket.approval.basketFingerprint, acknowledgeExceptions: true } });
      setApprovalResult(response);
      if (response.ok) void loadBasket();
    } catch (error) {
      setApprovalResult({ ok: false, detail: error instanceof Error ? error.message : "Unable to approve the basket." });
    } finally {
      setApproving(false);
    }
  };

  const buildSubmission = (inputLines: Line[]): HouseholdIntakeSubmission | null => {
    if (!basket || basket.status !== "READY" || basket.approval.status !== "APPROVED" || inputLines.length === 0) return null;
    const now = new Date().toISOString();
    const unresolved = inputLines.find((line) => line.state === "SUBSTITUTED" && !line.replacementItemKey.trim());
    if (unresolved) {
      setResult({ ok: false, code: "INVALID_EVIDENCE", detail: `A replacement canonical item is required for ${unresolved.productName}.` });
      return null;
    }
    return {
      kind: "DELIVERY",
      input: {
        basketId: basket.basket.basketId,
        orderReference: `MANUAL-PURCHASE:${basket.basket.basketId}`,
        retailer: basket.basket.retailer ?? "",
        capturedAt: now,
        capturedBy: "James",
        delivery: {
          deliveryId: `MANUAL-DELIVERY:${basket.basket.basketId}:${now}`,
          dispatchId: `MANUAL-PURCHASE:${basket.basket.basketId}`,
          basketId: basket.basket.basketId,
          basketVersion: basket.approval.basketVersion,
          basketFingerprint: basket.approval.basketFingerprint,
          deliveredAt: now,
          reconciliationStatus: "RECONCILED",
          lines: inputLines.filter((line) => line.state !== "MISSING").map((line) => ({
            lineId: line.lineId,
            itemKey: line.state === "SUBSTITUTED" ? line.replacementItemKey.trim() : line.itemKey,
            expectedItemKey: line.state === "SUBSTITUTED" ? line.itemKey : null,
            deliveredQuantity: line.orderedQuantity,
            unit: line.unit,
            substituted: line.state === "SUBSTITUTED",
          })),
        },
      },
    };
  };

  const prepare = (inputLines: Line[]) => {
    setResult(null);
    try {
      const nextSubmission = buildSubmission(inputLines);
      if (!nextSubmission) return;
      const fixedPreparedAt = new Date().toISOString();
      setSubmission(nextSubmission);
      setPreparedAt(fixedPreparedAt);
      setReleaseResult(null);
      setResult(prepareHouseholdIntake(nextSubmission, { now: () => fixedPreparedAt }));
    } catch (error) {
      setSubmission(null);
      setPreparedAt(null);
      setResult({ ok: false, code: "CANONICALISATION_FAILED", detail: error instanceof Error ? error.message : String(error) });
    }
  };

  const allArrived = () => {
    const arrived = lines.map((line) => ({ ...line, state: "ARRIVED" as const, replacementItemKey: "" }));
    setLines(arrived);
    prepare(arrived);
  };

  const approveAndRelease = async () => {
    if (!result?.ok || !submission || !preparedAt) return;
    setReleasing(true);
    try {
      const approvals = result.approvalRequests.map((request) => authorizationFromRequest(request, {
        authorizationId: `AUTH-${crypto.randomUUID()}`,
        approvedBy: "James",
        approvedAt: new Date().toISOString(),
        evidenceDetail: "James explicitly approved the exact delivery event shown in the Food OS proposal.",
      }));
      setReleaseResult(await releaseHumanDelivery({ data: { submission, approvals, preparedAt } }));
    } catch (error) {
      setReleaseResult({ ok: false, code: "CANONICALISATION_FAILED", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setReleasing(false);
    }
  };

  const basketReady = basket?.status === "READY";
  const countedIn = alreadyCountedIn !== null;
  const basketApproved = basketReady && basket.approval.status === "APPROVED" && !countedIn;
  const basketPending = basketReady && basket.approval.status === "PENDING" && !countedIn;


  const settled = countedIn || Boolean(releaseResult?.ok && releaseResult.written);
  const screen = describeDeliveryScreen({
    basketReady: Boolean(basketReady),
    approvalStatus: basketReady ? basket.approval.status === "APPROVED" ? "APPROVED" : "PENDING" : null,
    countedIn,
    justCountedIn: Boolean(releaseResult?.ok && releaseResult.written),
  });

  return <div className="ctl-page"><AppHeader eyebrow="Household" /><Shell>
    <Link to="/food" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to food</Link>
    <PageTitle eyebrow="Your shopping" title={screen.title} lede={screen.body} />

    {settled ? <section className="mb-7">
      <div className="rounded-2xl bg-[var(--ctl-surface-sunken)] p-5">
        <div className="flex items-center gap-2"><CheckCircle2 className="size-5 text-primary" /><p className="text-[15px] font-semibold">Delivered</p></div>
        <Link to="/food" className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">See your food</Link>
      </div>
    </section> : <>
      {loadError ? <Evidence label="We couldn't load your delivery">{loadError}</Evidence> : null}
      {needsOperatorSession ? <section className="mb-7 rounded-2xl border border-border bg-card p-5"><SectionHeading title="Connect FoodOS" /><p className="text-[13px] leading-relaxed text-muted-foreground">Enter your connection code to see this week's delivery.</p><div className="mt-4 flex gap-2"><Input type="password" value={operatorToken} onChange={(event) => setOperatorToken(event.target.value)} placeholder="Connection code" autoComplete="off" /><Button type="button" onClick={() => void connectOperator()} disabled={connecting || !operatorToken.trim()}>{connecting ? "Connecting…" : "Connect"}</Button></div>{operatorError ? <p className="mt-3 text-[13px] text-destructive">{operatorError}</p> : null}</section> : null}
      {!loadError && basket && basket.status !== "READY" && !needsOperatorSession ? <Evidence label="Nothing to confirm">There's no delivery waiting for you right now.</Evidence> : null}

      {basketPending ? <section className="mb-7"><SectionHeading title="Check this shop first" action={<Badge variant="outline">Needs you</Badge>} /><Group>
        <Row><p className="text-sm font-semibold">{basket.basket.retailer}</p><p className="mt-1 text-xs text-muted-foreground">{basket.basket.lines.length} things to buy</p></Row>
        {basket.basket.exceptions.map((exception, index) => <Row key={`${exception.code}:${exception.itemKey ?? "basket"}:${index}`}><p className="text-sm font-semibold">{exception.itemKey ?? "This shop"}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{exception.detail}</p></Row>)}
      </Group><Button type="button" className="mt-4" onClick={approveBasket} disabled={approving}>{approving ? "Saving…" : "Looks right — agree this shop"}</Button>{approvalResult ? <div className="mt-3">{approvalResult.ok ? <Evidence label="Agreed">Loading the next step…</Evidence> : <Evidence label="Not agreed">{approvalResult.detail}</Evidence>}</div> : null}</section> : null}

      {basketApproved ? <section className="mb-7">
        <div className="rounded-2xl bg-[var(--ctl-surface-sunken)] p-5">
          <p className="text-[15px] font-semibold">{basket.basket.retailer} · {basket.basket.lines.length} things</p>
          <Button type="button" className="mt-4" onClick={allArrived}>Everything arrived</Button>
        </div>
        <details className="mt-4 rounded-2xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">Something's missing or different</summary>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Mark only what didn't come as expected, then save the change.</p>
          <Group>{lines.map((line, index) => <Row key={line.lineId}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">{line.productName}</p><p className="mt-1 text-xs text-muted-foreground">{line.orderedQuantity} {line.unit}</p></div><div className="flex flex-wrap gap-2">{(["ARRIVED", "MISSING", "SUBSTITUTED"] as const).map((state) => <Button key={state} type="button" variant={line.state === state ? "default" : "outline"} onClick={() => updateLine(index, { state, replacementItemKey: state === "SUBSTITUTED" ? line.replacementItemKey : "" })}>{state === "ARRIVED" ? "Came" : state === "MISSING" ? "Didn't come" : "Something else"}</Button>)}</div></div>{line.state === "SUBSTITUTED" ? <Input className="mt-3" aria-label={`Replacement for ${line.productName}`} value={line.replacementItemKey} onChange={(e) => updateLine(index, { replacementItemKey: e.target.value })} placeholder="What arrived instead" /> : null}</Row>)}</Group>
          {exceptionCount > 0 ? <div className="mt-3"><Button type="button" onClick={() => prepare(lines)}>Save what arrived</Button></div> : null}
        </details>
      </section> : null}

      {result ? <section className="mb-7"><SectionHeading title="Ready to save" action={result.ok ? <Badge><CheckCircle2 className="mr-1 size-3" /> Ready</Badge> : <Badge variant="destructive"><TriangleAlert className="mr-1 size-3" /> Not saved</Badge>} />{result.ok ? <><p className="mb-3 text-sm text-muted-foreground">Check this looks right, then save it into your food.</p><Group>{result.records.map((record) => <Row key={record.eventId}><p className="text-sm font-semibold">{record.row.Item as string}</p></Row>)}</Group><Button type="button" className="mt-4" onClick={approveAndRelease} disabled={releasing}>{releasing ? "Saving…" : "Save this into my food"}</Button></> : <Evidence label="FoodOS couldn't save this">{result.detail}</Evidence>}</section> : null}
      {releaseResult && !(releaseResult.ok && releaseResult.written) ? <section className="mb-7"><SectionHeading title="Nothing saved" action={<Badge variant="destructive">Not saved</Badge>} />{releaseResult.ok ? <p className="text-sm text-muted-foreground">Nothing in your food changed.</p> : <Evidence label="FoodOS couldn't save this">{releaseResult.detail}</Evidence>}</section> : null}
    </>}
  </Shell><AppFooter /></div>;
}
