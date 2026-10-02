import { describe, expect, it } from "vitest";
import { FAMILY_PAGE_HTML } from "./page";

describe("FAMILY_PAGE_HTML", () => {
  it("is well-formed HTML with the expected shell", () => {
    expect(FAMILY_PAGE_HTML).toContain("<title>Our Food</title>");
    expect(FAMILY_PAGE_HTML).toContain('id="list"');
    expect(FAMILY_PAGE_HTML).toContain('id="planResult"');
  });

  it("embeds syntactically valid JavaScript", () => {
    const match = FAMILY_PAGE_HTML.match(/<script>([\s\S]*)<\/script>/);
    expect(match).not.toBeNull();
    const script = match![1]!;
    // Compiling (not executing) catches the whole class of bug where string
    // concatenation inside an onclick="..." attribute breaks quoting — this
    // test would have failed on the escaped-quote bug fixed in this file.
    expect(() => new Function(script)).not.toThrow();
  });

  it("never emits an escaped-quote artifact inside an inline event handler", () => {
    // `onclick="fn(\'id\')"` is invalid in this context (there is no JS
    // string literal to escape out of); it must be a bare `'id'` instead.
    expect(FAMILY_PAGE_HTML).not.toMatch(/onclick=\\?"[^"]*\\'/);
  });

  it("orders the page as meal planning, then inventory, then the shopping list", () => {
    // The mental model: "what can we eat tonight" is the thing people open
    // the app for, so it leads; the full inventory and the top-up list are
    // supporting detail underneath it, each collapsed by default.
    const planIndex = FAMILY_PAGE_HTML.indexOf('id="planResult"');
    const invIndex = FAMILY_PAGE_HTML.indexOf('id="inventoryDetails"');
    const shopIndex = FAMILY_PAGE_HTML.indexOf('id="shoppingDetails"');
    expect(planIndex).toBeGreaterThan(-1);
    expect(invIndex).toBeGreaterThan(planIndex);
    expect(shopIndex).toBeGreaterThan(invIndex);
  });

  it("defaults the inventory section to collapsed", () => {
    expect(FAMILY_PAGE_HTML).toMatch(/<details class="section" id="inventoryDetails">/);
  });

  it("gives each of the three sections an explanatory hint", () => {
    const hintCount = (FAMILY_PAGE_HTML.match(/class="section-hint"/g) ?? []).length;
    expect(hintCount).toBe(3);
  });

  it("folds the add-food action into the inventory section instead of a persistent floating button", () => {
    expect(FAMILY_PAGE_HTML).not.toContain('class="fab"');
    expect(FAMILY_PAGE_HTML).toContain('class="add-food-btn"');
  });
});
