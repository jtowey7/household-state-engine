import { describe, expect, it } from "vitest";
import { tescoLinksFor, KNOWN_TESCO_PRODUCTS } from "./tesco-catalogue";

describe("tescoLinksFor", () => {
  it("returns a real direct product link for a known item, case/spacing-insensitively", () => {
    const links = tescoLinksFor("  Beef Mince ");
    expect(links.directUrl).toBe(KNOWN_TESCO_PRODUCTS["beef mince"]!.url);
    expect(links.directUrl).toMatch(/^https:\/\/www\.tesco\.com\/shop\/en-GB\/products\/\d+$/);
    expect(links.directProductName).toBe("Tesco Lean Beef Steak Mince 5% Fat 750g");
    expect(links.directVerifiedOn).toBe("2026-08-30");
  });

  it("always returns a working Tesco search link, even for unknown items", () => {
    const links = tescoLinksFor("Dragon fruit");
    expect(links.directUrl).toBeNull();
    expect(links.searchUrl).toBe("https://www.tesco.com/shop/en-GB/search?query=Dragon%20fruit");
  });

  it("every known product URL points at a real Tesco product page shape", () => {
    for (const [key, product] of Object.entries(KNOWN_TESCO_PRODUCTS)) {
      expect(product.url, `url for ${key}`).toMatch(/^https:\/\/www\.tesco\.com\/shop\/en-GB\/products\/\d+$/);
    }
  });
});
