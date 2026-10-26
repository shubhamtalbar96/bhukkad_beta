export type Cuisine = "snacks" | "south" | "north" | "pan" | "truck";
export type Filter = Cuisine | "all";

export const CATEGORIES: Record<Filter, { label: string; emoji: string; hex: string }> = {
  all: { label: "All", emoji: "🍽️", hex: "#1d1a2b" },
  snacks: { label: "Snacks & Chaat", emoji: "🥟", hex: "#ffb21e" },
  south: { label: "South Indian", emoji: "🍛", hex: "#22c07a" },
  north: { label: "North Indian", emoji: "🫓", hex: "#ff7a3d" },
  pan: { label: "Pan-Indian", emoji: "🥘", hex: "#2fb8e6" },
  truck: { label: "Food trucks", emoji: "🚚", hex: "#ff5fae" },
};

export const CUISINES: Cuisine[] = ["snacks", "south", "north", "pan", "truck"];

// Best guess from a place's name and categories. The LLM tagging pass and owners can correct it later.
export function classify(name: string, categories: string[] = []): Cuisine {
  const n = name.toLowerCase();
  const c = categories.join(" ").toLowerCase();
  if (/food_truck|food truck/.test(c) || /truck|cart\b/.test(n)) return "truck";
  if (/chaat|pani ?puri|vada pav/.test(n)) return "snacks";
  if (/dosa|idli|udupi|saravana|chettinad|andhra|madras|kerala|tamil|telugu|hyderabad|mylapore|anjappar|paradise|kannada|malabar|chennai|bangalore|bengaluru|south indian/.test(n)) return "south";
  if (/bakery|dessert|sweet|ice_cream|snack/.test(c) || /sweet|snack|samosa|jalebi|halwai|bakery|chai|mithai|kulfi/.test(n)) return "snacks";
  if (/punjab|tandoor|dhaba|mughal|amritsar|delhi|lucknow|kashmir|rajasthan|himalaya|kebab|kabob|north indian|nepal|everest/.test(n)) return "north";
  return "pan";
}
