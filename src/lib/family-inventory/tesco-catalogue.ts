/**
 * Real Tesco links for the shopping list. Two tiers, both genuine URLs —
 * nothing here is a guessed or fabricated product page:
 *
 * 1. KNOWN_PRODUCTS: direct product-page URLs with real SKUs, captured
 *    from the household's own prior verified Tesco orders (Family Alpha
 *    basket, 2026-08-30). Tesco SKUs and prices do drift over time, so
 *    treat these as "last verified 2026-08-30" rather than guaranteed —
 *    that's why every shopping-list entry also gets the search link.
 * 2. The search URL (`/shop/en-GB/search?query=...`) is Tesco's real,
 *    always-working search pattern — also taken from the same verified
 *    catalogue data — so every item gets at least a working link even
 *    when there's no known direct product match.
 */
export const KNOWN_TESCO_PRODUCTS: Record<string, { url: string; productName: string; verifiedOn: string }> = {
  "spaghetti": { url: "https://www.tesco.com/shop/en-GB/products/254878424", productName: "Tesco Spaghetti Pasta 1Kg", verifiedOn: "2026-08-30" },
  "beef mince": { url: "https://www.tesco.com/shop/en-GB/products/282470731", productName: "Tesco Lean Beef Steak Mince 5% Fat 750g", verifiedOn: "2026-08-30" },
  "chopped tomatoes": { url: "https://www.tesco.com/shop/en-GB/products/251825089", productName: "Tesco Italian Chopped Tomatoes 400G", verifiedOn: "2026-08-30" },
  "garlic": { url: "https://www.tesco.com/shop/en-GB/products/313168547", productName: "Tesco Large Garlic", verifiedOn: "2026-08-30" },
  "celery": { url: "https://www.tesco.com/shop/en-GB/products/311672834", productName: "Tesco Celery", verifiedOn: "2026-08-30" },
  "natural yoghurt": { url: "https://www.tesco.com/shop/en-GB/products/299770281", productName: "Tesco Natural Yogurt 500G", verifiedOn: "2026-08-30" },
  "salad leaves": { url: "https://www.tesco.com/shop/en-GB/products/292593115", productName: "Tesco Mixed Leaf Salad 120G", verifiedOn: "2026-08-30" },
  "red peppers": { url: "https://www.tesco.com/shop/en-GB/products/258421636", productName: "Tesco Red Peppers Each", verifiedOn: "2026-08-30" },
  "chicken breast": { url: "https://www.tesco.com/shop/en-GB/products/323658459", productName: "Tesco British Chicken Breast Fillets 1KG", verifiedOn: "2026-08-30" },
  "halloumi": { url: "https://www.tesco.com/shop/en-GB/products/295580293", productName: "Tesco Halloumi 225G", verifiedOn: "2026-08-30" },
  "tomatoes": { url: "https://www.tesco.com/shop/en-GB/products/314098829", productName: "Tesco Classic Round Tomatoes 6 Pack", verifiedOn: "2026-08-30" },
  "breaded fish": { url: "https://www.tesco.com/shop/en-GB/products/266195171", productName: "Tesco 4 Breaded Cod Fillets 500G", verifiedOn: "2026-08-30" },
  "lemon": { url: "https://www.tesco.com/shop/en-GB/products/253556398", productName: "Tesco Lemons Each", verifiedOn: "2026-08-30" },
  "frozen chips": { url: "https://www.tesco.com/shop/en-GB/products/299538966", productName: "Hearty Food Co Straight Cut Chips 1.5Kg", verifiedOn: "2026-08-30" },
  "mushy peas": { url: "https://www.tesco.com/shop/en-GB/products/263903641", productName: "Tesco British Mushy Peas 300G", verifiedOn: "2026-08-30" },
  "quiche": { url: "https://www.tesco.com/shop/en-GB/products/288017298", productName: "Tesco Quiche Lorraine 400g", verifiedOn: "2026-08-30" },
  "baked beans": { url: "https://www.tesco.com/shop/en-GB/products/256947789", productName: "Tesco Baked Beans In Tomato Sauce 4X420g", verifiedOn: "2026-08-30" },
  "burger buns": { url: "https://www.tesco.com/shop/en-GB/products/301971576", productName: "St Pierre Plain Brioche Burger Buns 6 Pack", verifiedOn: "2026-08-30" },
  "kidney beans": { url: "https://www.tesco.com/shop/en-GB/products/259061829", productName: "Tesco Red Kidney Beans In Water 400G", verifiedOn: "2026-08-30" },
  "parmesan": { url: "https://www.tesco.com/shop/en-GB/products/255081368", productName: "Tesco Grated Parmigiano Reggiano 100G", verifiedOn: "2026-08-30" },
  "houmous": { url: "https://www.tesco.com/shop/en-GB/products/320967265", productName: "Tesco Houmous 300g", verifiedOn: "2026-08-30" },
  "lettuce": { url: "https://www.tesco.com/shop/en-GB/products/253557495", productName: "Tesco Iceberg Lettuce Each", verifiedOn: "2026-08-30" },
};

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

export interface TescoLink {
  /** A direct product page, only present when we have a previously-verified match. */
  directUrl: string | null;
  directProductName: string | null;
  directVerifiedOn: string | null;
  /** Always present: Tesco's real search page for this item, guaranteed to work. */
  searchUrl: string;
}

/** Looks up a known direct product link and always provides a real search-page fallback. */
export function tescoLinksFor(itemName: string): TescoLink {
  const key = normalise(itemName);
  const known = KNOWN_TESCO_PRODUCTS[key];
  const searchUrl = `https://www.tesco.com/shop/en-GB/search?query=${encodeURIComponent(itemName.trim())}`;
  if (!known) {
    return { directUrl: null, directProductName: null, directVerifiedOn: null, searchUrl };
  }
  return { directUrl: known.url, directProductName: known.productName, directVerifiedOn: known.verifiedOn, searchUrl };
}
