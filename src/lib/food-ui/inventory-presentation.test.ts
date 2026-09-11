import { describe, expect, it } from "vitest";
import { COMMON_FOOD_UNITS, normalizeFoodUnit, softFoodSection } from "./inventory-presentation";

describe("inventory presentation",()=>{
 it("normalises common unit aliases without silently converting meaning",()=>{expect(normalizeFoodUnit("packs")).toBe("pack");expect(normalizeFoodUnit("kilograms")).toBe("kg");expect(normalizeFoodUnit("tins")).toBe("tin/can");expect(normalizeFoodUnit("litres")).toBe("litre");expect(normalizeFoodUnit("handful")).toBe("handful");});
 it("keeps the common unit vocabulary finite and user-facing",()=>{expect(COMMON_FOOD_UNITS).toEqual(["pack","bag","box","bottle","tin/can","tub","jar","carton","loaf","kg","g","litre","ml"]);});
 it("uses explicit category signals before heuristic item-name matching",()=>{expect(softFoodSection("peas","Frozen")).toBe("Frozen");expect(softFoodSection("tuna","Fish")).toBe("Fish");expect(softFoodSection("milk","Dairy")).toBe("Dairy");});
 it("provides forgiving supermarket-like grouping with Other fallback",()=>{expect(softFoodSection("two packs of mince")).toBe("Meat");expect(softFoodSection("frozen peas")).toBe("Frozen");expect(softFoodSection("conference pears")).toBe("Fresh");expect(softFoodSection("Tesco cola zero")).toBe("Drinks & Treats");expect(softFoodSection("mystery household ingredient")).toBe("Other");});
});
