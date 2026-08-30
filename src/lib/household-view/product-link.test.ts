import { describe, expect, it } from "vitest";

import { describeProductLink, isDirectProductUrl, summariseProductLinks } from "./product-link";

const DIRECT_CHICKEN = "https://www.tesco.com/shop/en-GB/products/323658459";
const SEARCH_CHICKEN = "https://www.tesco.com/shop/en-GB/search?query=tesco+chicken+breast+fillet+1kg";
const SEARCH_LEMON = "https://www.tesco.com/shop/en-GB/search?query=Tesco+Lemons+Each";
const BROWSE_CHIPS =
  "https://www.tesco.com/shop/en-GB/browse/frozen-food/chips-potatoes-and-sides/chips-and-french-fries/frozen-chips-straight-cut-chips";

describe("direct product link classification (presentation only)", () => {
  it("accepts a direct Tesco product page", () => {
    expect(isDirectProductUrl(DIRECT_CHICKEN)).toBe(true);
    expect(describeProductLink(DIRECT_CHICKEN)).toEqual({
      kind: "DIRECT",
      href: DIRECT_CHICKEN,
      note: null,
    });
  });

  it("rejects the recorded Tesco search links James tested", () => {
    for (const url of [SEARCH_CHICKEN, SEARCH_LEMON]) {
      expect(isDirectProductUrl(url)).toBe(false);
      const presentation = describeProductLink(url);
      expect(presentation.kind).toBe("NON_DIRECT");
      expect(presentation.href).toBeNull();
      expect(presentation.note).toContain("search");
    }
  });

  it("rejects the recorded frozen-chips category browse link", () => {
    expect(describeProductLink(BROWSE_CHIPS).kind).toBe("NON_DIRECT");
  });

  it("rejects non-HTTPS and malformed links", () => {
    expect(isDirectProductUrl("http://www.tesco.com/shop/en-GB/products/323658459")).toBe(false);
    expect(isDirectProductUrl("not-a-url")).toBe(false);
  });

  it("reports a missing link explicitly", () => {
    expect(describeProductLink(undefined).kind).toBe("MISSING");
    expect(describeProductLink("   ").kind).toBe("MISSING");
  });

  it("summarises coverage without inventing links", () => {
    const summary = summariseProductLinks([DIRECT_CHICKEN, SEARCH_LEMON, BROWSE_CHIPS, undefined]);
    expect(summary).toEqual({ total: 4, direct: 1, nonDirect: 2, missing: 1, complete: false });
  });

  it("is complete only when every line is a direct product page", () => {
    expect(summariseProductLinks([DIRECT_CHICKEN, "https://www.tesco.com/shop/en-GB/products/253556398"]).complete).toBe(
      true,
    );
  });
});
