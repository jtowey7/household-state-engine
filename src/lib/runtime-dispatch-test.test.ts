import { describe, expect, it } from "vitest";
import { runDispatchAdapterRuntimeProof } from "./runtime-dispatch-test";

describe("runtime dispatch proof", () => {
  it("uses a fresh synthetic dispatch identity on repeated proof runs", async () => {
    const first = await runDispatchAdapterRuntimeProof();
    const second = await runDispatchAdapterRuntimeProof();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.dispatch.dispatchId).not.toBe(second.dispatch.dispatchId);
  });
});
