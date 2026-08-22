export function assertReleaseIdentityStable(
  expectedMainSha: string,
  finalMainSha: string,
  finalRuntimeSha: string,
): void {
  if (finalMainSha !== expectedMainSha || finalRuntimeSha !== expectedMainSha) {
    throw new Error(
      `Release identity changed before append: expected ${expectedMainSha}, current main ${finalMainSha}, runtime ${finalRuntimeSha}`,
    );
  }
}
