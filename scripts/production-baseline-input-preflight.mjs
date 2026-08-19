export const CANONICAL_FOOD_OS_BASE_ID = "appmqDptH3taN8uby";

export function assertCanonicalBaselineBaseId(baseId) {
  if (typeof baseId !== "string" || baseId.trim() !== CANONICAL_FOOD_OS_BASE_ID) {
    throw new Error(
      `Production baseline refused: Airtable base ID does not match the canonical Food OS base ${CANONICAL_FOOD_OS_BASE_ID}.`,
    );
  }
}
