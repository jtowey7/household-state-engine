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
});
