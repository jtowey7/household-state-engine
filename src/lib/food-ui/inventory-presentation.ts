export const COMMON_FOOD_UNITS = ["pack","bag","box","bottle","tin/can","tub","jar","carton","loaf","kg","g","litre","ml"] as const;
export type CommonFoodUnit = (typeof COMMON_FOOD_UNITS)[number];
const UNIT_ALIASES: Record<string, CommonFoodUnit> = { pack:"pack",packs:"pack",packet:"pack",packets:"pack",bag:"bag",bags:"bag",box:"box",boxes:"box",bottle:"bottle",bottles:"bottle",tub:"tub",tubs:"tub",jar:"jar",jars:"jar",tin:"tin/can",tins:"tin/can",can:"tin/can",cans:"tin/can",carton:"carton",cartons:"carton",loaf:"loaf",loaves:"loaf",kg:"kg",kgs:"kg",kilogram:"kg",kilograms:"kg",g:"g",gram:"g",grams:"g",l:"litre",litre:"litre",litres:"litre",liter:"litre",liters:"litre",ml:"ml",millilitre:"ml",millilitres:"ml",milliliter:"ml",milliliters:"ml" };
export function normalizeFoodUnit(value:string):string { return UNIT_ALIASES[value.trim().toLowerCase()] ?? value.trim().toLowerCase(); }
export const SOFT_FOOD_SECTIONS = ["Fresh","Meat","Fish","Dairy","Cupboard","Frozen","Drinks & Treats","Other"] as const;
export type SoftFoodSection = (typeof SOFT_FOOD_SECTIONS)[number];
const sectionRules:Array<{section:SoftFoodSection;terms:string[]}>=[
{section:"Frozen",terms:["frozen","ice cream","ice lolly","peas","chips","fries","hash brown","naan"]},
{section:"Fish",terms:["salmon","mackerel","sardine","tuna","cod","haddock","fish","prawn","prawns"]},
{section:"Meat",terms:["beef","mince","chicken","lamb","pork","bacon","ham","sausage","sausages","chorizo","turkey"]},
{section:"Dairy",terms:["milk","cheese","yogurt","yoghurt","cream","butter","custard","crumpet","egg","eggs"]},
{section:"Drinks & Treats",terms:["cola","pepsi","juice","squash","coffee","tea","chocolate","sweet","sweets","popcorn","ice lolly","magnum","cornetto","solero"]},
{section:"Fresh",terms:["apple","pear","banana","berry","berries","tomato","tomatoes","cucumber","pepper","peppers","carrot","carrots","celery","lettuce","broccoli","fruit","vegetable","salad"]}
];
export function softFoodSection(item:string,category?:string|null):SoftFoodSection { const source=`${category??""} ${item}`.trim().toLowerCase(); const c=(category??"").trim().toLowerCase(); if(c.includes("frozen"))return"Frozen";if(c.includes("fish"))return"Fish";if(c.includes("meat"))return"Meat";if(c.includes("dairy"))return"Dairy";if(c.includes("drink")||c.includes("treat"))return"Drinks & Treats";if(c.includes("fresh"))return"Fresh";if(c.includes("cupboard")||c.includes("pantry"))return"Cupboard";for(const r of sectionRules)if(r.terms.some(t=>source.includes(t)))return r.section;return"Other"; }
