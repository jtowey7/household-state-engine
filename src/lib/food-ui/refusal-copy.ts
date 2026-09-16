/**
 * Food OS — turning an internal refusal into plain household language.
 *
 * Internal codes and contract wording are never shown on the household
 * surface. When a refusal is not recognised, a calm generic sentence is used
 * rather than the raw diagnostic.
 */

export function householdRefusalMessage(input: { code?: string | null; detail?: string | null }): string {
  const detail = (input.detail ?? "").trim();

  if (/unit .* is not in the household unit contract|the report states no unit/i.test(detail)) {
    return "FoodOS did not recognise that measure. Choose one of the amounts shown, then try again.";
  }
  if (/MISSING_QUANTITY|states no quantity/i.test(detail)) {
    return "FoodOS needs an exact amount. Type how much there is, then try again.";
  }
  if (/AMBIGUOUS_QUANTITY|not an unambiguous number/i.test(detail)) {
    return "That amount was not clear enough to use. Type it as a number, then try again.";
  }
  if (/MISSING_ITEM|names no item/i.test(detail)) {
    return "FoodOS needs the name of the food. Type it, then try again.";
  }
  if (/CONFLICT/i.test(`${input.code ?? ""} ${detail}`)) {
    return "This update no longer matches your food list. Close this and start the change again.";
  }
  const both = `${input.code ?? ""} ${detail}`;
  if (/operator session|session expired|session required|NOT_READY/i.test(both)) {
    return "FoodOS is not signed in to your household record right now, so nothing was saved. Connect again, then save this update.";
  }
  if (/not configured|connector|NO_CONNECTOR|CONNECTOR_FAILED|PRODUCTION_WRITE_(UNAVAILABLE|DISABLED)/i.test(both)) {
    return "FoodOS is not connected to your household record right now, so nothing was saved. Nothing about this update is wrong.";
  }
  if (/POLICY_(ID|VERSION)_(MISMATCH|REQUIRED)|AUTHORIZATION_(SCOPE_MISMATCH|REQUIRED|NOT_GRANTED)|SYNTHETIC_PROVENANCE_REFUSED|TEST_RECORD_REFUSED/i.test(both)) {
    return "FoodOS is not permitted to save this kind of change to your household record yet, so nothing changed. This is not something you can fix from here.";
  }


  // Anything already written in household language is shown as-is; anything
  // that looks like an internal diagnostic is replaced.
  if (detail && !/[A-Z]{3,}_[A-Z_]+|canonical|payload|event id|policy|connector|schema/i.test(detail)) {
    return detail;
  }
  return "FoodOS could not use this update, so nothing in your food list changed. Check the food, amount and measure, then try again.";
}
