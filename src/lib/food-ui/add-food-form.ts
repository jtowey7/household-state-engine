/**
 * Pure presentation state for the /food "Add food" form.
 *
 * Presentation only: it decides what the household sees and whether the single
 * primary action is offered yet. It never prepares, approves or writes
 * anything, and it never surfaces internal contract terminology.
 */
export interface AddFoodFormInput {
  item: string;
  quantity: string;
  unit: string;
}

export interface AddFoodFormState {
  /** True once food, amount and unit are all present and the amount is usable. */
  complete: boolean;
  /** The single primary action label. */
  primaryLabel: string;
  /** Plain household guidance for what is still needed, or null when complete. */
  hint: string | null;
  /** Human-readable summary of what will be added, when complete. */
  summary: string | null;
}

export const ADD_FOOD_PRIMARY_LABEL = "Add to food";

export function describeAddFoodForm(input: AddFoodFormInput): AddFoodFormState {
  const item = input.item.trim();
  const unit = input.unit.trim();
  const quantityText = input.quantity.trim();
  const quantity = Number(quantityText);
  const hasQuantity = quantityText !== "" && Number.isFinite(quantity) && quantity >= 0;

  if (!item) {
    return {
      complete: false,
      primaryLabel: ADD_FOOD_PRIMARY_LABEL,
      hint: "Start with the food — for example “2 pints of milk”.",
      summary: null,
    };
  }

  if (!hasQuantity && !unit) {
    return {
      complete: false,
      primaryLabel: ADD_FOOD_PRIMARY_LABEL,
      hint: "Add how much came home, and what it is measured in.",
      summary: null,
    };
  }

  if (!hasQuantity) {
    return {
      complete: false,
      primaryLabel: ADD_FOOD_PRIMARY_LABEL,
      hint: "Add how much came home.",
      summary: null,
    };
  }

  if (!unit) {
    return {
      complete: false,
      primaryLabel: ADD_FOOD_PRIMARY_LABEL,
      hint: "Choose what that amount is measured in — packs, kg, litres and so on.",
      summary: null,
    };
  }

  return {
    complete: true,
    primaryLabel: ADD_FOOD_PRIMARY_LABEL,
    hint: null,
    summary: `${quantityText} ${unit} of ${item}`,
  };
}

export interface ExistingFoodChoice {
  /** Plain statement of what foodOS already has. */
  heading: string;
  /** Single primary choice: fold this amount into the food already held. */
  primaryLabel: string;
  /** Single secondary choice: keep it apart from the existing food. */
  secondaryLabel: string;
}

/**
 * One clear reconciliation choice, in household language only. No internal
 * record, canonical or match terminology is ever exposed.
 */
export function describeExistingFoodChoice(input: {
  existingItem: string;
  quantity: string;
  unit: string;
}): ExistingFoodChoice {
  const amount = `${input.quantity.trim()} ${input.unit.trim()}`.trim();
  return {
    heading: `We found an existing food called ${input.existingItem}`,
    primaryLabel: amount
      ? `Add ${amount} to existing ${input.existingItem}`
      : `Add to existing ${input.existingItem}`,
    secondaryLabel: "Create a separate item",
  };
}
