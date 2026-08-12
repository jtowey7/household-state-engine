/** Deterministic, dependency-free canonicalisation + hashing helpers. */

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/** 128-bit FNV-1a style digest rendered as hex. Deterministic across runs. */
export function digest(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
    h3 = Math.imul(h3 ^ (c + i), 3266489917) >>> 0;
    h4 = (Math.imul(h4 ^ c, 2654435761) + h1) >>> 0;
  }
  return [h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, "0")).join("");
}

export function hashOf(value: unknown): string {
  return digest(canonicalize(value));
}
