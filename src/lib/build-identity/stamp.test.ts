import { describe, expect, it } from "vitest";
import {
  BUILD_ID_ASSET,
  LOCAL_BUILD_ID,
  isStampedReleaseIdentity,
  mergeNoStoreHeaderRule,
  resolveBuildId,
} from "./stamp";

const SHA = "066e5fae1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f";

describe("runtime build identity stamping", () => {
  it("regression #616: GITHUB_SHA overrides a stale committed local-development identity", () => {
    // The repository ships public/runtime-build-id.txt containing
    // `local-development`. The previous "write only when missing" strategy
    // deployed that stale value, so exact-SHA verification failed closed.
    expect(resolveBuildId(SHA, `${LOCAL_BUILD_ID}\n`)).toBe(SHA);
  });

  it("overrides a stale identity from an earlier deploy", () => {
    expect(resolveBuildId(SHA, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n")).toBe(SHA);
  });

  it("trims whitespace so the stamped value matches the workflow's exact comparison", () => {
    expect(resolveBuildId(`  ${SHA}\n`, undefined)).toBe(SHA);
  });

  it("falls back to the existing identity, then local-development, off CI", () => {
    expect(resolveBuildId(undefined, "prior-value\n")).toBe("prior-value");
    expect(resolveBuildId(undefined, undefined)).toBe(LOCAL_BUILD_ID);
    expect(resolveBuildId("", "   ")).toBe(LOCAL_BUILD_ID);
  });

  it("classifies release versus local identities", () => {
    expect(isStampedReleaseIdentity(SHA)).toBe(true);
    expect(isStampedReleaseIdentity(LOCAL_BUILD_ID)).toBe(false);
    expect(isStampedReleaseIdentity("")).toBe(false);
  });

  it("adds the no-store rule for the identity asset without discarding build-generated rules", () => {
    const generated = "/assets/*\n  cache-control: public, max-age=31536000, immutable";
    const merged = mergeNoStoreHeaderRule(generated);
    expect(merged).toContain("/assets/*");
    expect(merged).toContain(`/${BUILD_ID_ASSET}`);
    expect(merged).toContain("no-store");
  });

  it("is idempotent and never duplicates the identity rule across rebuilds", () => {
    const once = mergeNoStoreHeaderRule(undefined);
    const twice = mergeNoStoreHeaderRule(once);
    expect(twice).toBe(once);
    expect(twice.match(new RegExp(`/${BUILD_ID_ASSET}`, "g"))).toHaveLength(1);
  });
});
