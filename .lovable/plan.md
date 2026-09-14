# Restore the published operator connection

## Scope
- Keep the existing server-side session and constant-time token comparison.
- Detect whether the published runtime sees no token, one token, or conflicting token values from its available server environments.
- Return safe diagnostics that confirm availability and comparison outcome without exposing the token, its hash, or its length.
- Fail closed with a precise configuration message if two runtime sources disagree.
- Add focused regression tests, verify the published Connect flow, and publish the fix.

## Technical details
- Preserve trimming of surrounding whitespace and UTF-8 comparison semantics.
- Do not alter Airtable data, Production state, shopping, checkout, or any writer.
- Validate missing, mismatch, runtime-conflict, and successful session cases.
