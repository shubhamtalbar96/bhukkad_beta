import type { Cuisine } from "@/lib/categories";
import { createClient } from "@/lib/supabase/server";

// The shape the map and list use. Kept small so the whole South Bay ships in one response.
export type MapPlace = {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lon: number;
  cuisine: Cuisine;
  address: string;
  score: number | null;
  ratingCount: number;
  recentCount: number;
  topDish: string | null;
};

type PlaceRow = {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lon: number;
  cuisine: Cuisine;
  address: string | null;
  city: string | null;
  place_scores: { score: number; rating_count: number; recent_count: number; top_dish: string | null } | null;
};

export function toMapPlace(r: PlaceRow): MapPlace {
  // PostgREST returns a one-to-one join as an object, but be safe if it ever comes back as an array.
  const raw = r.place_scores as unknown;
  const s = (Array.isArray(raw) ? raw[0] : raw) as PlaceRow["place_scores"];
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    cuisine: r.cuisine,
    address: [r.address, r.city].filter(Boolean).join(", "),
    score: s ? Number(s.score) : null,
    ratingCount: s?.rating_count ?? 0,
    recentCount: s?.recent_count ?? 0,
    topDish: s?.top_dish ?? null,
  };
}

export const PLACE_COLUMNS = "id, slug, name, lat, lon, cuisine, address, city, place_scores(score, rating_count, recent_count, top_dish)";

export async function getMapPlaces(): Promise<MapPlace[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("places").select(PLACE_COLUMNS).eq("status", "active").limit(5000);
  if (error) throw new Error(`Couldn't load places: ${error.message}`);
  return ((data ?? []) as unknown as PlaceRow[]).map(toMapPlace);
}
