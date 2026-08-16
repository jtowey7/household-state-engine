import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production baseline Airtable confidence contract", () => {
  it("uses the live HOUSEHOLD EVENTS single-select vocabulary", () => {
    const source = readFileSync(new URL("./execute-production-baseline.ts", import.meta.url), "utf8");

    expect(source).toContain('confidence: "Confirmed"');
    expect(source).not.toContain('confidence: "High"');
  });
});
