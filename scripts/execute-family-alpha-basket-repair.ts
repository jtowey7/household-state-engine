import { readFile } from "node:fs/promises";

const runtimeUrl = process.env.FOODOS_BASKET_RUNTIME_URL?.trim();
const writeToken = process.env.FOODOS_BASKET_WRITE_TOKEN?.trim();

const productUrls: Record<string, string> = {
  "254878424": "https://www.tesco.com/shop/en-GB/products/254878424",
  "282470731": "https://www.tesco.com/shop/en-GB/products/282470731",
  "251825089": "https://www.tesco.com/shop/en-GB/products/251825089",
  "313168547": "https://www.tesco.com/shop/en-GB/products/313168547",
  "311672834": "https://www.tesco.com/shop/en-GB/products/311672834",
  "299770281": "https://www.tesco.com/shop/en-GB/products/299770281",
  "292593115": "https://www.tesco.com/shop/en-GB/products/292593115",
  "258421636": "https://www.tesco.com/shop/en-GB/products/258421636",
  "TESCO-CHICKEN-1KG": "https://www.tesco.com/shop/en-GB/search?query=tesco+chicken+breast+fillet+1kg",
  "295580293": "https://www.tesco.com/shop/en-GB/products/295580293",
  "314098829": "https://www.tesco.com/shop/en-GB/products/314098829",
  "266195171": "https://www.tesco.com/shop/en-GB/products/266195171",
  "TESCO-LEMONS-EACH": "https://www.tesco.com/shop/en-GB/search?query=Tesco+Lemons+Each",
  "299538966": "https://www.tesco.com/shop/en-GB/browse/frozen-food/chips-potatoes-and-sides/chips-and-french-fries/frozen-chips-straight-cut-chips",
  "263903641": "https://www.tesco.com/shop/en-GB/products/263903641",
  "288017298": "https://www.tesco.com/shop/en-GB/products/288017298",
  "256947789": "https://www.tesco.com/shop/en-GB/products/256947789",
  "301971576": "https://www.tesco.com/shop/en-GB/products/301971576",
  "259061829": "https://www.tesco.com/shop/en-GB/products/259061829",
  "255081368": "https://www.tesco.com/shop/en-GB/products/255081368",
  "320967265": "https://www.tesco.com/shop/en-GB/products/320967265",
  "253557495": "https://www.tesco.com/shop/en-GB/products/253557495",
};

const rows = [
  ["spaghetti","254878424","Tesco Spaghetti Pasta 1Kg",750,"g",1000,1,1000,1.19,[],"recNyGQbucRmDpYOU"],
  ["beef mince","282470731","Tesco Lean Beef Steak Mince 5% Fat 750g",1250,"g",750,2,1500,14.30,["EVT-2026-08-15-TESCO-LEAN-BEEF-STEAK-MINCE-5-FA-CORRECTION-d2489547"],"rec2cuA1Lc6M17y4h"],
  ["chopped tomatoes","251825089","Tesco Italian Chopped Tomatoes 400G",800,"g",400,2,800,0.94,["EVT-2026-08-15-TESCO-ITALIAN-CHOPPED-TOMATOES-4-CORRECTION-3559044e"],"rec6vfdbvu8F72bHc"],
  ["Garlic","313168547","Tesco Large Garlic",1,"each",1,1,1,0.50,["EVT-2026-08-15-GARLIC-CORRECTION-0d922ef8"],"recuZb0sFtT5qCOuy"],
  ["celery","311672834","Tesco Celery",2,"stick",1,2,2,0.75,[],"recEJgRI4YfKT7YV2"],
  ["natural yoghurt","299770281","Tesco Natural Yogurt 500G",500,"g",500,1,500,1.15,[],"recWIWWmUzJoI9JWh"],
  ["salad leaves","292593115","Tesco Mixed Leaf Salad 120G",240,"g",120,2,240,2.40,[],"recpXYJGcE0P6SwTQ"],
  ["Tesco Red Peppers Each","258421636","Tesco Red Peppers Each",4,"each",1,4,4,2.80,["EVT-2026-08-15-RED-PEPPER-CORRECTION-8c3bc388"],"rec2ZUJVg9FsLb7q8"],
  ["Chicken breast","TESCO-CHICKEN-1KG","Tesco British Chicken Breast Fillets 1KG",200,"g",1000,1,1000,6.69,["EVT-2026-08-15-TESCO-BRITISH-CHICKEN-BREAST-FIL-CORRECTION-cddf22d1"],"recEZkGzmyxEoC880"],
  ["halloumi","295580293","Tesco Halloumi 225G",300,"g",225,2,450,3.98,["EVT-2026-08-15-TESCO-HALLOUMI-225G-CORRECTION-c5e8a2b3"],"rec3LhabANWwRpxYF"],
  ["tomatoes","314098829","Tesco Classic Round Tomatoes 6 Pack",12,"each",6,2,12,1.98,[],"recWBk2DNG8pZeqjj"],
  ["breaded fish","266195171","Tesco 4 Breaded Cod Fillets 500G",12,"portion",4,3,12,12.00,[],"recL960U4c5jQFvQt"],
  ["lemon","TESCO-LEMONS-EACH","Tesco Lemons Each",2,"each",1,2,2,0.74,[],"recuI3h9HcOpS0ntT"],
  ["frozen chips","299538966","Hearty Food Co Straight Cut Chips 1.5Kg",3250,"g",1500,3,4500,4.95,["EVT-2026-08-15-SUPER-CRISPY-FRENCH-FRIES-CORRECTION-73ceaa8d"],"recOXyCPTMzFuaMdR"],
  ["mushy peas","263903641","Tesco British Mushy Peas 300G",3,"x300g pack",1,3,3,1.47,[],"rec6levxdnFSvAF0m"],
  ["large quiche","288017298","Tesco Quiche Lorraine 400g",2,"item",1,2,2,5.00,[],"recy7ECAsHytZRWjW"],
  ["baked beans","256947789","Tesco Baked Beans In Tomato Sauce 4X420g",4,"x400g can",4,1,4,1.55,[],"rectiGaLob6U6eH1Z"],
  ["burger buns","301971576","St Pierre Plain Brioche Burger Buns 6 Pack",6,"item",6,1,6,2.90,[],"reclUHcloK0WgDoO7"],
  ["kidney beans","259061829","Tesco Red Kidney Beans In Water 400G",3,"x400g can",1,3,3,1.17,[],"recXNtY84dSH16WPl"],
  ["parmesan","255081368","Tesco Grated Parmigiano Reggiano 100G",100,"g",100,1,100,2.80,[],"recO9TrGr3IDDzM9y"],
  ["houmous","320967265","Tesco Houmous 300g",200,"g",300,1,300,1.50,["EVT-2026-08-15-TESCO-HOUMOUS-200G-CORRECTION-2c7f82c6"],"rec7NwbQ87VSbh3r6"],
  ["lettuce","253557495","Tesco Iceberg Lettuce Each",2,"each",1,2,2,1.78,[],"recxl6Kz3Sfov7qWF"],
] as const;

const lines = rows.map(([itemKey, sku, productName, requiredQuantity, unit, packSize, packCount, orderedQuantity, lineCost, sourceEventIds, requirementId]) => ({
  itemKey,
  sku,
  productName,
  productUrl: productUrls[sku],
  retailer: "Tesco",
  requiredQuantity,
  unit,
  packSize,
  packUnit: unit,
  packCount,
  orderedQuantity,
  lineCost,
  sourceEventIds,
  requirementIds: [requirementId],
  requirementCount: 1,
}));

const basket = {
  basketId: "Family Alpha MVP basket — 24–30 Aug 2026 — regenerated",
  planId: "Family-Alpha-QuantityRun-2026-08-27",
  snapshotId: "d00dbb3c83496304fcb3eef4eeb2d7e6",
  replayId: "6a3730319cc3014ba5a4f3ef35bf114e",
  replayTimestamp: "2026-08-16T00:00:00.000Z",
  retailer: "Tesco",
  lines,
  exceptions: [],
  totalCost: 72.54,
  coverage: {
    demandItemKeys: lines.map((line) => line.itemKey),
    sourcedItemKeys: lines.map((line) => line.itemKey),
    unsourcedItemKeys: [],
    complete: true,
  },
  complete: true,
  readyForReview: true,
  readyForApproval: true,
  dispatched: false,
  requiresHumanApproval: true,
};

if (!runtimeUrl || !writeToken) {
  console.error("Missing FOODOS_BASKET_RUNTIME_URL or FOODOS_BASKET_WRITE_TOKEN; refusing to send.");
  process.exit(2);
}

const response = await fetch(runtimeUrl.replace(/\\/$/, "") + "/runtime/basket/candidate", {
  method: "POST",
  headers: {
    authorization: `Bearer ${writeToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    basket,
    runId: `family-alpha-basket-repair-${new Date().toISOString()}`,
  }),
});

const body = await response.text();
console.log(body);
if (!response.ok) process.exit(1);
