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

  it("orders the page as meal planning, then the shopping list", () => {
    // The mental model: "what can we eat tonight" is the thing people open
    // the app for, so it leads; the top-up list is supporting detail
    // underneath it, collapsed by default. The full inventory isn't part
    // of this linear flow at all any more — it opens as a dialog from the
    // persistent header strip instead (see the dialog test below), so
    // there's no "where does it sit in the page" ordering to assert.
    const planIndex = FAMILY_PAGE_HTML.indexOf('id="planResult"');
    const shopIndex = FAMILY_PAGE_HTML.indexOf('id="shoppingDetails"');
    expect(planIndex).toBeGreaterThan(-1);
    expect(shopIndex).toBeGreaterThan(planIndex);
  });

  it("opens the full inventory as a dialog, closed by default, not inline in the page flow", () => {
    // Replaced the old collapsible <details> section: tapping the header
    // strip used to jump/scroll down to an inline section, which read as
    // two disconnected places showing the same inventory. A dialog is a
    // single, unambiguous entry point instead.
    expect(FAMILY_PAGE_HTML).toMatch(/<dialog id="inventoryDialog" class="full-sheet">/);
    expect(FAMILY_PAGE_HTML).not.toContain('id="inventoryDetails"');
  });

  it("gives each section/dialog an explanatory hint", () => {
    // The top plan hint, the inventory dialog, the shopping list section,
    // the "Just for tonight" dialog, the settings dialog's AI-details
    // toggle, the settings dialog's regenerate-full-plan action, and the
    // favorites dialog each carry one.
    const hintCount = (FAMILY_PAGE_HTML.match(/class="section-hint"/g) ?? []).length;
    expect(hintCount).toBe(7);
  });

  it("folds the add-food action into the inventory section instead of a persistent floating button", () => {
    expect(FAMILY_PAGE_HTML).not.toContain('class="fab"');
    expect(FAMILY_PAGE_HTML).toContain('class="add-food-btn"');
  });
});
