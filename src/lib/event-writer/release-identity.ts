/**
 * The controlled-write workflow is bound to an immutable GitHub Actions release SHA
 * (`github.sha`) and the deployed Worker identity. `main` is a moving ref and cannot
 * participate in an atomic cross-system check with the Airtable append, so it is
 * deliberately diagnostic rather than a write-time authority.
 *
 * This closes the TOCTOU window identified by issue #222: if main advances after the
 * immutable release was selected but before the Airtable append, the approved release
 * identity has not changed. The write remains bound to the exact checked-out release
 * and its deployed runtime, rather than to a moving branch ref.
 */
export function assertReleaseIdentityStable(
  expectedReleaseSha: string,
  _observedMainSha: string,
  observedRuntimeSha: string,
): void {
  if (observedRuntimeSha !== expectedReleaseSha) {
    throw new Error(
      `Release identity changed before append: expected immutable release ${expectedReleaseSha}, runtime ${observedRuntimeSha}`,
    );
  }
}
