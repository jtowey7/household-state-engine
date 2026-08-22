import { describe, expect, it } from "vitest";
import { assertReleaseIdentityStable } from "./release-identity";

describe("Family Alpha immutable release identity guard", () => {
  it("allows main to advance after release capture when runtime remains the approved release", () => {
    const approvedReleaseSha = "release-A";
    const mainBeforeAppend = "release-A";
    const mainAfterFinalCheck = "release-B";
    const deployedRuntimeSha = "release-A";

    expect(() =>
      assertReleaseIdentityStable(approvedReleaseSha, mainBeforeAppend, deployedRuntimeSha),
    ).not.toThrow();
    expect(() =>
      assertReleaseIdentityStable(approvedReleaseSha, mainAfterFinalCheck, deployedRuntimeSha),
    ).not.toThrow();
  });

  it("refuses when the deployed runtime is not the immutable approved release", () => {
    expect(() =>
      assertReleaseIdentityStable("release-A", "release-A", "release-B"),
    ).toThrow(/immutable release release-A, runtime release-B/);
  });
});
