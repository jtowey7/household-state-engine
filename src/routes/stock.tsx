import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { AppFooter, AppHeader } from "@/components/app-header";
import {
  Evidence,
  Group,
  PageTitle,
  Pill,
  Row,
  SectionHeading,
  Shell,
} from "@/components/household/household-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildHouseholdStockReadout, describeStockApprovalBoundary } from "@/lib/household-stock-readout";
import type { StockEntryInput } from "@/lib/household-stock-readout";
import {
  loadStockEntries,
  saveStockEntries,
  stockNow,
  stockObservedAt,
  stockReportedBy,
} from "@/lib/household-view/stock-session";


export const Route = createFileRoute("/stock")({
  head: () => ({
    meta: [
      { title: "Enter what you have — foodOS" },
      {
        name: "description",
        content:
          "Count what is in the house, confirm each line, and see the stock foodOS will plan the week and the shop around.",
      },
      { property: "og:title", content: "Enter what you have — foodOS" },
      {
        property: "og:description",
        content: "Enter your current stock and see what the week will be planned around.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StockPage,
});

const OBSERVED_AT = stockObservedAt;
const NOW = stockNow;

function StockPage() {
  const [entries, setEntries] = useState<StockEntryInput[]>(() => loadStockEntries());
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");

  useEffect(() => {
    saveStockEntries(entries);
  }, [entries]);

  const readout = useMemo(
    () => buildHouseholdStockReadout(entries, { now: NOW, reportedBy: stockReportedBy }),
    [entries],
  );


  const boundary = useMemo(
    () => describeStockApprovalBoundary(entries, { now: NOW, reportedBy: stockReportedBy }),
    [entries],
  );

  const confirmed = readout.lines.filter((line) => line.approved);
  const pending = readout.lines.filter((line) => !line.approved);

  function addEntry() {
    const trimmed = item.trim();
    if (!trimmed) return;
    const parsed = Number(quantity);
    setEntries((prev) => [
      ...prev,
      {
        entryId: `entry-${prev.length + 1}-${trimmed.toLowerCase().replace(/\s+/g, "-")}`,
        itemKey: trimmed,
        quantity: Number.isFinite(parsed) && quantity.trim() !== "" ? parsed : quantity,
        unit: unit.trim(),
        observedAt: OBSERVED_AT,
      },
    ]);
    setItem("");
    setQuantity("");
    setUnit("");
  }

  function approve(entryId: string) {
    setEntries((prev) =>
      prev.map((entry) => (entry.entryId === entryId ? { ...entry, approved: true } : entry)),
    );
  }

  return (
    <div className="ctl-page">
      <AppHeader eyebrow="Household" />
      <Shell>
        <PageTitle
          eyebrow="Food"
          title="Enter what you have"
          lede="Count what is actually in the house. Nothing counts towards your week until you confirm the line yourself."
        />

        <section className="mb-7">
          <SectionHeading title="Add an item" />
          <Group className="p-4 sm:p-5">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_auto]">
              <Input
                aria-label="Item"
                placeholder="Item, e.g. Butter"
                value={item}
                onChange={(e) => setItem(e.target.value)}
              />
              <Input
                aria-label="Amount"
                placeholder="Amount"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              <Input
                aria-label="Unit"
                placeholder="Unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
              <Button type="button" onClick={addEntry}>
                Add
              </Button>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              Each line is held as a proposal until you confirm it. foodOS never changes your
              household record on its own, and nothing here orders anything.
            </p>
          </Group>
        </section>

        {pending.length > 0 ? (
          <section className="mb-7">
            <SectionHeading
              title="Waiting for you to confirm"
              action={<Pill tone="attention">{pending.length}</Pill>}
            />
            <Group>
              {pending.map((line) => (
                <Row key={line.entryId}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold leading-snug">{line.itemKey}</p>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        {line.quantity} {line.unit} · not counted yet
                      </p>
                    </div>
                    <Button type="button" size="sm" onClick={() => approve(line.entryId)}>
                      Confirm
                    </Button>
                  </div>
                </Row>
              ))}
            </Group>
          </section>
        ) : null}

        <section className="mb-7">
          <SectionHeading
            title="What you have now"
            action={<Pill tone={confirmed.length > 0 ? "good" : "neutral"}>{confirmed.length}</Pill>}
          />
          {confirmed.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nothing confirmed yet — confirm a line above and it will appear here.
            </p>
          ) : (
            <Group>
              {confirmed.map((line) => (
                <Row key={line.entryId}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold leading-snug">{line.itemKey}</p>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">
                        {line.blocked ? "Needs a check before planning" : "Counted and ready for the week"}
                      </p>
                    </div>
                    <span className="shrink-0 text-right text-[15px] font-semibold tabular-nums">
                      {line.quantity}
                      <span className="ml-0.5 text-[12px] font-medium text-muted-foreground">
                        {line.unit}
                      </span>
                    </span>
                  </div>
                </Row>
              ))}
            </Group>
          )}
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            {readout.handoff.readyForQuantityRun
              ? `${readout.handoff.items.length} ${readout.handoff.items.length === 1 ? "item is" : "items are"} ready to be used for planning your `
              : "Something needs a check before this can be used for your "}
            <Link to="/week" className="font-medium text-primary underline-offset-4 hover:underline">
              week
            </Link>{" "}
            and your{" "}
            <Link to="/shop" className="font-medium text-primary underline-offset-4 hover:underline">
              shopping list
            </Link>
            .
          </p>
        </section>

        {readout.rejections.length > 0 ? (
          <section className="mb-7">
            <SectionHeading
              title="Could not be counted"
              action={<Pill tone="attention">{readout.rejections.length}</Pill>}
            />
            <Group>
              {readout.rejections.map((rejection) => (
                <Row key={rejection.exceptionId}>
                  <p className="text-[15px] font-semibold leading-snug">
                    {rejection.itemKey ?? "Unnamed item"}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    Needs an exact amount and unit before foodOS will count it.
                  </p>
                </Row>
              ))}
            </Group>
          </section>
        ) : null}

        <section className="mb-7">
          <SectionHeading title="Nothing leaves this screen" />
          <Group className="p-4 sm:p-5">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Confirming a line updates what you see here and what your week is planned around. It
              does not change your household record — that still needs a separate, explicit approval,
              and no order is placed from this app.
            </p>
            <Evidence label="Show what an approval would need">
              <ul className="space-y-2">
                {boundary.lines.map((line) => (
                  <li key={line.entryId}>
                    <span className="font-medium">{line.itemKey || "Unnamed item"}</span>{" "}
                    {line.request ? (
                      <>
                        — {line.request.summary} · Event ID {line.request.eventId.slice(0, 12)} ·
                        payload hash {line.request.payloadHash.slice(0, 12)} · evidence{" "}
                        {line.request.requiredEvidenceSource}
                      </>
                    ) : (
                      <>— refused, no approval request issued: {line.refusal}</>
                    )}
                  </li>
                ))}
                {boundary.lines.length === 0 ? <li>No entries yet.</li> : null}
              </ul>
              <p className="mt-2">
                These are requests, not approvals: they carry no decision and no approver, so they
                cannot satisfy the protected writer on their own (productionMutation: false).
              </p>
            </Evidence>
          </Group>
        </section>

        <Evidence label="Show the underlying record">
          Every entry is canonicalised as a record-class Test Correction proposal on the existing
          protected write boundary (wouldWrite: false, no connector). Only entries with explicit human
          approval enter the isolated replay; snapshot {readout.snapshot.snapshotId.slice(0, 12)} /
          replay {readout.snapshot.replayId.slice(0, 12)}, status {readout.snapshot.reconciliationStatus}
          , feeding the existing QUANTITY REQUIREMENTS handoff. No Production household mutation and no
          retailer I/O is reachable from this surface.
        </Evidence>
      </Shell>
      <AppFooter />
    </div>
  );
}
