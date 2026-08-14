import { describe, expect, it } from "vitest";
import { classifyEvidencePrecision } from "./evidence-precision";

describe("baseline evidence precision", () => {
  it("treats an unqualified numeric source as exact", () => {
    expect(classifyEvidencePrecision("sealed 500g pack")).toBe("EXACT");
  });

  it("flags approximate and estimated quantities", () => {
    expect(classifyEvidencePrecision("approximately 500g left")).toBe("QUALIFIED_AMBIGUOUS");
    expect(classifyEvidencePrecision("estimated 500g")).toBe("QUALIFIED_AMBIGUOUS");
  });

  it("flags partial, used and opened stock", () => {
    expect(classifyEvidencePrecision("partial pack")).toBe("QUALIFIED_AMBIGUOUS");
    expect(classifyEvidencePrecision("500g, some used")).toBe("QUALIFIED_AMBIGUOUS");
    expect(classifyEvidencePrecision("opened bag")).toBe("QUALIFIED_AMBIGUOUS");
  });

  it("flags qualitative or uncertain amounts", () => {
    expect(classifyEvidencePrecision("a few left")).toBe("QUALIFIED_AMBIGUOUS");
    expect(classifyEvidencePrecision("small amount")).toBe("QUALIFIED_AMBIGUOUS");
    expect(classifyEvidencePrecision("trace remaining")).toBe("QUALIFIED_AMBIGUOUS");
    expect(classifyEvidencePrecision("quantity unknown")).toBe("QUALIFIED_AMBIGUOUS");
  });

  it("is deterministic and does not infer a replacement quantity", () => {
    const note = "roughly 250g; use first";
    expect(classifyEvidencePrecision(note)).toBe(classifyEvidencePrecision(note));
    expect(note).toBe("roughly 250g; use first");
  });
});
