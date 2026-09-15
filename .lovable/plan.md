# Simplify the Food stock action

## Scope
- Change only the existing `/food` action panel and its interaction presentation.
- Keep the inventory list, existing action meanings, All gone shortcut, natural-language parsing, canonical matching, review boundary, and fail-closed outcomes unchanged.
- Do not add persistence, authority, data-contract, shopping, checkout, or Production changes.

## Interaction
- Present a short action-specific heading and the selected food clearly.
- For Used and Wasted, lead with the existing one-tap “All gone” choice, then progressively reveal exact amount-left entry for the partial case.
- For Changed, show the current amount and ask only for the corrected amount.
- For Add, lead with the existing natural-language description; show separate amount and unit fields only when the description cannot provide them or the user chooses to enter details.
- Keep unit chips beside the unit field, with concise labels and a single full-width primary “Review” action on mobile.
- Keep canonical match choices and prepared/not-saved messaging visible only when relevant.

## Validation
- Add focused presentation-state tests where a pure seam is useful.
- Run the relevant household input, matching, unit-chip, and route-focused tests, plus TypeScript validation.
- Check the `/food` interaction at the mobile acceptance size without requiring Production writes.
