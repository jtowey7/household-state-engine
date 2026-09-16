import { describe, expect, it } from "vitest";

import { releaseOutcomeFor } from "./release-outcome";

describe("what the household is told after pressing Save", () => {
  it("states a real save plainly", () => {
    const outcome = releaseOutcomeFor({
      written: true,
      receipts: [{ outcome: "APPENDED_PRODUCTION", written: true }],
    });
    expect(outcome.saved).toBe(true);
    expect(outcome.label).toBe("Saved");
  });

  it("treats an already-saved update as saved, not as a failure", () => {
    const outcome = releaseOutcomeFor({
      written: false,
      receipts: [{ outcome: "DUPLICATE_NOOP", written: false }],
    });
    expect(outcome.saved).toBe(true);
    expect(outcome.message).toMatch(/already saved/i);
  });

  it("gives the real reason when the write was refused, without internal codes", () => {
    const outcome = releaseOutcomeFor({
      written: false,
      receipts: [
        {
          outcome: "REJECTED",
          written: false,
          rejection: {
            code: "CONNECTOR_FAILED",
            detail: "Airtable append failed [422]: UNKNOWN_FIELD_NAME",
          },
        },
      ],
    });
    expect(outcome.saved).toBe(false);
    expect(outcome.message).not.toMatch(/CONNECTOR_FAILED|Airtable|422|UNKNOWN_FIELD_NAME/);
    expect(outcome.message.length).toBeGreaterThan(20);
  });

  it("says plainly that saving did not finish when the approval never reached the write", () => {
    const outcome = releaseOutcomeFor({
      written: false,
      receipts: [{ outcome: "PROPOSED", written: false }],
    });
    expect(outcome.saved).toBe(false);
    expect(outcome.message).toMatch(/could not finish saving/i);
    expect(outcome.message).not.toMatch(/approval step|payload|event/i);
  });
});
