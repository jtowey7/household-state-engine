import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";

import { AppFooter, AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import {
  Evidence,
  Group,
  PageTitle,
  Pill,
  Row,
  SectionHeading,
  Shell,
} from "@/components/household/household-ui";
import { cn } from "@/lib/utils";
import { getCanonicalBasketForShop } from "@/lib/procurement/canonical-basket.functions";
import type { CanonicalBasketReadResult } from "@/lib/procurement/canonical-basket";
import { describeBasketStatus } from "@/lib/household-view/basket-status";
import { describeProductLink, summariseProductLinks } from "@/lib/household-view/product-link";

export const Route = createFileRoute("/shop")({
  head: () => ({
    meta: [
      { title: "Basket to approve — foodOS" },
      {
        name: "description",
        content:
          "The FoodOS Shop surface renders only the canonical Airtable basket and fail-closes when that state is absent or inconsistent.",
      },
      { property: "og:title", content: "Basket to approve — foodOS" },
      {
        property: "og:description",
        content: "FoodOS never presents synthetic basket data as an actionable household approval.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShopPage,
});

function ShopPage() {
  const [state, setState] = useState<CanonicalBasketReadResult | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await getCanonicalBasketForShop();
      setState(result);
    } catch (error) {
      setState({
        status: "NOT_READY",
        source: "UNAVAILABLE",
        reason: "CONNECTOR_READ_FAILED",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" />
      <Shell>
        <PageTitle
          eyebrow="Shop"
          title={state?.status === "READY" ? "Your canonical basket" : "No canonical basket is ready"}
          lede={
            state?.status === "READY"
              ? "This basket is read directly from the canonical FoodOS control plane. The Shop surface does not maintain a second copy."
              : "FoodOS has not received a single complete, traceable basket from the canonical procurement path, so there is nothing safe to approve yet."
          }
        />

        <div className="mb-7 -mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            {isRefreshing ? "Refreshing…" : "Refresh basket"}
          </Button>
        </div>

        {state === null ? (
          <div className="ctl-hero mb-7 p-5 sm:p-6">
            <p className="text-[13px] text-muted-foreground">Checking the canonical basket…</p>
          </div>
        ) : state.status === "READY" ? (
          <CanonicalBasketView state={state} />
        ) : (
          <WithheldBasketView state={state} />
        )}
      </Shell>
      <AppFooter />
    </div>
  );
}

function CanonicalBasketView({ state }: { state: Extract<CanonicalBasketReadResult, { status: "READY" }> }) {
  const { basket, approval } = state;
  const approved = approval.status === "APPROVED";
  const linkCoverage = summariseProductLinks(basket.lines.map((line) => line.productUrl));

  return (
    <>
      <div className="ctl-hero mb-7 p-5 sm:p-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {approved ? "Approval status" : "Approval status"}
            </p>
            <p className="mt-1 font-display text-3xl font-semibold tracking-tight">
              {approved ? "Approved" : "Ready for your approval"}
            </p>
          </div>
          <Pill tone={approved ? "success" : "attention"}>{approved ? "Approved" : "Awaiting you"}</Pill>
        </div>
        <div className="mt-5 rounded-[calc(var(--ctl-radius))] bg-[var(--ctl-surface-sunken)] px-4 py-3.5">
          <p className="text-[13.5px] font-semibold leading-snug">
            {basket.retailer ?? "One supermarket"} · £{basket.totalCost.toFixed(2)} · {basket.lines.length} line{basket.lines.length === 1 ? "" : "s"}
          </p>
          <p className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {approved
                ? `Approved by ${approval.approvedBy} at ${approval.approvedAt}. The displayed basket is bound to its approval fingerprint.`
                : "The displayed basket is the canonical candidate. Approval has not been recorded, so no retailer transaction is implied."}
            </span>
          </p>
        </div>
      </div>

      <SectionHeading title="Canonical basket identity" />
      <Group>
        <Row>
          <dl className="grid grid-cols-1 gap-2 text-[12.5px] sm:grid-cols-2">
            <IdentityField label="Basket" value={basket.basketId} />
            <IdentityField
              label="Basket version"
              value={approval.basketVersion === undefined ? "—" : String(approval.basketVersion)}
            />
            <IdentityField label="Basket fingerprint" value={approval.basketFingerprint ?? "—"} />
            <IdentityField label="Judge" value={approval.judgeId} />
            <IdentityField label="Approval ID" value={approval.approvalId ?? "—"} />
            <IdentityField
              label="Approval policy"
              value={
                approval.policyIdentity
                  ? `${approval.policyIdentity} v${approval.policyVersion ?? "—"}`
                  : "—"
              }
            />
          </dl>
        </Row>
      </Group>

      <SectionHeading title={`What is in it, and why (${basket.lines.length} lines)`} />
      {linkCoverage.complete ? null : (
        <div className="mb-3 rounded-[calc(var(--ctl-radius))] bg-[var(--ctl-surface-sunken)] px-4 py-3.5">
          <p className="text-[13px] font-semibold leading-snug">
            {linkCoverage.direct} of {linkCoverage.total} lines have a direct supermarket product link
          </p>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            {linkCoverage.nonDirect > 0
              ? `${linkCoverage.nonDirect} recorded link${linkCoverage.nonDirect === 1 ? " points" : "s point"} to a supermarket search or category page rather than a specific product. `
              : ""}
            {linkCoverage.missing > 0
              ? `${linkCoverage.missing} line${linkCoverage.missing === 1 ? " has" : "s have"} no recorded link. `
              : ""}
            FoodOS will not rewrite the approved basket: fixing these needs a new basket candidate version and human re-approval.
          </p>
        </div>
      )}
      <Group>
        {basket.lines.map((line, index) => {
          const link = describeProductLink(line.productUrl);
          return (
            <Row key={`${line.itemKey}-${line.sku}-${index}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{line.productName}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                    {line.packCount} pack{line.packCount === 1 ? "" : "s"} · {line.orderedQuantity} {line.packUnit} · {line.itemKey}
                  </p>
                  {link.href ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-[12px] font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Open supermarket product
                    </a>
                  ) : (
                    <p className="mt-1 text-[12px] font-medium text-muted-foreground">{link.note}</p>
                  )}
                </div>
                <p className="shrink-0 text-[15px] font-semibold">£{line.lineCost.toFixed(2)}</p>
              </div>
            </Row>
          );
        })}
      </Group>

      <Evidence label="Canonical evidence">
        Source: Airtable BASKET CANDIDATES. The Shop surface accepts exactly one pending/approved basket,
        requires a complete serialized CandidateBasket payload, checks the judge verdict and summary against
        the payload, and for APPROVED rows re-validates the immutable approval identity/version/fingerprint,
        policy, judge and human provenance. It never creates, edits or dispatches a basket from this screen.
      </Evidence>
    </>
  );
}

function IdentityField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-[12px]">{value}</dd>
    </div>
  );
}


function WithheldBasketView({ state }: { state: Extract<CanonicalBasketReadResult, { status: "NOT_READY" }> }) {
  return (
    <>
      <div className="ctl-hero mb-7 p-5 sm:p-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Approval status
            </p>
            <p className="mt-1 font-display text-3xl font-semibold tracking-tight">
              Waiting for canonical basket
            </p>
          </div>
          <Pill tone="attention">Not ready</Pill>
        </div>
        <div className="mt-5 rounded-[calc(var(--ctl-radius))] bg-[var(--ctl-surface-sunken)] px-4 py-3.5">
          <p className="text-[13.5px] font-semibold leading-snug">
            Nothing is being ordered or approved from this screen
          </p>
          <p className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{describeBasketStatus(state).blocker ?? state.detail}</span>
          </p>
        </div>
      </div>

      <SectionHeading title="What happens next" />
      <Group>
        <Row>
          <p className="text-[15px] font-semibold">1. Build the basket</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
            Quantity requirements are matched to the configured one-supermarket catalogue and persisted as a canonical candidate.
          </p>
        </Row>
        <Row>
          <p className="text-[15px] font-semibold">2. Judge and review it</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
            The candidate must be complete, carry verified product identity and pass the Basket Phase 5 judge before it can appear here.
          </p>
        </Row>
        <Row>
          <p className="text-[15px] font-semibold">3. Approve the exact basket</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
            Human approval binds to the exact basket fingerprint/version. Only then can the downstream human supermarket transaction proceed.
          </p>
        </Row>
      </Group>

      <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
        Want to review the week first?{" "}
        <Link to="/week" className="font-medium text-primary underline-offset-4 hover:underline">
          Review the meals
        </Link>
        .
      </p>

      <Evidence label="Why the basket is withheld">
        The previous Shop route rendered synthetic demo.ts data directly. This route now reads the canonical Airtable
        BASKET CANDIDATES table instead. If the canonical candidate is absent, ambiguous, incomplete or provenance-invalid,
        the screen fails closed rather than inventing or copying a basket.
      </Evidence>
    </>
  );
}
