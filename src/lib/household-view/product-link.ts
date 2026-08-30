/**
 * FoodOS product-link classification — PRESENTATION ONLY.
 *
 * Classifies a recorded canonical basket line URL as a DIRECT product page or
 * a NON-DIRECT locator (search results, category browse, bare storefront).
 * It never rewrites, invents or repairs a URL, and never mutates the canonical
 * basket: it only decides how honestly the existing recorded link is presented.
 */

export type ProductLinkClass = "DIRECT" | "NON_DIRECT" | "MISSING";

export interface ProductLinkPresentation {
  kind: ProductLinkClass;
  /** Safe href to render, only present for a DIRECT product link. */
  href: string | null;
  /** Household-facing explanation when the recorded link is not usable as a product link. */
  note: string | null;
}

const NON_DIRECT_SEGMENTS = new Set(["search", "browse", "categories", "category", "zone"]);

/** True only for an HTTPS URL whose path identifies one specific product. */
export function isDirectProductUrl(url: string | undefined | null): boolean {
  if (typeof url !== "string" || url.trim().length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;

  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => NON_DIRECT_SEGMENTS.has(segment.toLowerCase()))) return false;
  if (parsed.searchParams.has("query") || parsed.searchParams.has("q")) return false;

  const productIndex = segments.findIndex((segment) => {
    const normalised = segment.toLowerCase();
    return normalised === "products" || normalised === "product" || normalised === "ip";
  });
  if (productIndex === -1) return false;

  const identifier = segments[productIndex + 1];
  return typeof identifier === "string" && identifier.trim().length > 0;
}

export function describeProductLink(url: string | undefined | null): ProductLinkPresentation {
  if (typeof url !== "string" || url.trim().length === 0) {
    return {
      kind: "MISSING",
      href: null,
      note: "No supermarket product link recorded for this line.",
    };
  }
  if (isDirectProductUrl(url)) {
    return { kind: "DIRECT", href: url.trim(), note: null };
  }
  return {
    kind: "NON_DIRECT",
    href: null,
    note: "The recorded link points to a supermarket search or category page, not a specific product. FoodOS is withholding it until a direct product link is recorded on a new approved basket version.",
  };
}

export interface ProductLinkCoverage {
  total: number;
  direct: number;
  nonDirect: number;
  missing: number;
  /** True only when every line carries a direct product link. */
  complete: boolean;
}

export function summariseProductLinks(
  urls: readonly (string | undefined)[],
): ProductLinkCoverage {
  let direct = 0;
  let nonDirect = 0;
  let missing = 0;
  for (const url of urls) {
    const kind = describeProductLink(url).kind;
    if (kind === "DIRECT") direct += 1;
    else if (kind === "NON_DIRECT") nonDirect += 1;
    else missing += 1;
  }
  return { total: urls.length, direct, nonDirect, missing, complete: urls.length > 0 && direct === urls.length };
}
