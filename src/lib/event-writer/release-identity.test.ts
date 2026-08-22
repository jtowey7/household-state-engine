import { describe, expect, it } from "vitest";
import { assertReleaseIdentityStable } from "./release-identity";

describe("Family Alpha final release identity guard", () => {
  it("accepts only when main and deployed runtime still match the approved head", () => {
    expect(() =>
      assertReleaseIdentityStable("abc", "abc", "abc"),
    ).not.toThrow();
  });

  it("refuses when main advances after preflight", () => {
    expect(() =>
      assertReleaseIdentityStable("abc", "def", "abc"),
    ).toThrow(/Release identity changed before append/);
  });

  it("refuses when the deployed runtime drifts after the initial runtime check", () => {
    expect(() =>
      assertReleaseIdentityStable("abc", "abc", "def"),
    ).toThrow(/Release identity changed before append/);
  });

  it("refuses when both identities are different from the approved head", () => {
    expect(() =>
      assertReleaseIdentityStable("abc", "def", "ghi"),
    ).toThrow(/expected abc, current main def, runtime ghi/);
  });
});
