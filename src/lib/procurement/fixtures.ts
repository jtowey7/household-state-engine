import type { CatalogueEntry } from "./types";

/** SYNTHETIC retailer catalogue — no real retailer feed, no live pricing. */
export const shadowCatalogue: CatalogueEntry[] = [
  { itemKey: "oats-rolled", sku: "SKU-OAT-500", productName: "Rolled Oats 500g", retailer: "synthetic-grocer", packSize: 500, packUnit: "g", packPrice: 1.2 },
  { itemKey: "oats-rolled", sku: "SKU-OAT-1000", productName: "Rolled Oats 1kg", retailer: "synthetic-grocer", packSize: 1000, packUnit: "g", packPrice: 2.0 },
  { itemKey: "milk-whole", sku: "SKU-MILK-1L", productName: "Whole Milk 1L", retailer: "synthetic-grocer", packSize: 1, packUnit: "L", packPrice: 1.05 },
  { itemKey: "eggs-large", sku: "SKU-EGG-6", productName: "Large Eggs x6", retailer: "synthetic-grocer", packSize: 6, packUnit: "count", packPrice: 2.35 },
  { itemKey: "rice-basmati", sku: "SKU-RICE-1000", productName: "Basmati Rice 1kg", retailer: "synthetic-grocer", packSize: 1000, packUnit: "g", packPrice: 2.8 },
  { itemKey: "flour-plain", sku: "SKU-FLOUR-1500", productName: "Plain Flour 1.5kg", retailer: "synthetic-grocer", packSize: 1500, packUnit: "g", packPrice: 1.65 },
];
