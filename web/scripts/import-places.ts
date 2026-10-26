/**
 * Loads South Bay Indian places from Mapbox into Supabase.
 *
 * Run from web/:  npm run import:places
 * Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAPBOX_SEARCH_TOKEN
 *   MAPBOX_SEARCH_TOKEN is a Mapbox token with NO URL restriction, kept server-side only.
 *
 * Safe to re-run: places are upserted by (source, source_id), and existing slugs are kept.
 * Flags: --dry-run prints what would be written. --area=west,south,east,north overrides the box.
 */
import { createClient } from "@supabase/supabase-js";
import { classify, type Cuisine } from "../lib/categories";

type Feature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    mapbox_id?: string;
    address?: string;
    full_address?: string;
    place_formatted?: string;
    context?: { place?: { name?: string } };
    poi_category?: string[];
    poi_category_ids?: string[];
    metadata?: { phone?: string; website?: string };
  };
};

const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? "true"]; }));
const DRY = args.has("dry-run");
const AREA = (args.get("area")?.split(",").map(Number) ?? [-122.12, 37.24, -121.84, 37.58]) as [number, number, number, number];
const TEXT_QUERIES = ["chaat", "dosa", "biryani", "indian sweets", "punjabi dhaba", "indian food truck", "indian restaurant", "tandoori"];
const CENTERS: [number, number][] = [[-122.03, 37.37], [-121.93, 37.33], [-121.97, 37.53], [-122.08, 37.39], [-121.89, 37.42]];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const token = process.env.MAPBOX_SEARCH_TOKEN;
if (!token) throw new Error("Set MAPBOX_SEARCH_TOKEN (an unrestricted Mapbox token, server-side only).");
if (!DRY && (!supabaseUrl || !serviceKey)) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --dry-run.");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: URL): Promise<Feature[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`.slice(0, 200));
    return ((await res.json()) as { features?: Feature[] }).features ?? [];
  }
  return [];
}

function searchBox(path: string, params: Record<string, string | number>) {
  const u = new URL(`https://api.mapbox.com/search/searchbox/v1/${path}`);
  for (const [k, v] of Object.entries({ ...params, language: "en", access_token: token! })) u.searchParams.set(k, String(v));
  return get(u);
}

// Older Geocoding API, used when the Search Box API is refused for this account.
async function geocodeV5(q: string, center: [number, number]): Promise<Feature[]> {
  const u = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`);
  for (const [k, v] of Object.entries({ types: "poi", proximity: center.join(","), bbox: AREA.join(","), limit: 10, language: "en", access_token: token! })) u.searchParams.set(k, String(v));
  const res = await fetch(u);
  if (!res.ok) throw new Error(`geocoding ${res.status}`);
  const json = (await res.json()) as { features?: { id: string; text: string; place_name: string; center: [number, number]; properties?: { address?: string; category?: string }; context?: { id: string; text: string }[] }[] };
  return (json.features ?? []).map((f) => ({
    geometry: { coordinates: f.center },
    properties: {
      name: f.text,
      mapbox_id: f.id,
      address: f.properties?.address,
      full_address: f.place_name,
      context: { place: { name: f.context?.find((c) => c.id.startsWith("place."))?.text } },
      poi_category: [f.properties?.category ?? ""],
      poi_category_ids: (f.properties?.category ?? "").split(/,\s*/).map((c) => c.replace(/\s+/g, "_")),
    },
  }));
}

function isIndian(f: Feature) {
  const p = f.properties;
  const cats = [...(p.poi_category_ids ?? []), ...(p.poi_category ?? [])].join(" ").toLowerCase();
  return /indian/.test(cats) || /chaat|dosa|biryani|tandoor|punjab|udupi|dhaba|masala|desi|paratha|idli|samosa|mithai|india/i.test(p.name ?? "");
}

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);

async function collect(): Promise<Map<string, Feature>> {
  const found = new Map<string, Feature>();
  const add = (f: Feature, mustCheck: boolean) => {
    const id = f.properties.mapbox_id;
    if (!id || !f.properties.name || found.has(id)) return;
    if (mustCheck && !isIndian(f)) return;
    found.set(id, f);
  };

  try {
    const [w, s, e, n] = AREA;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const bbox = [w + ((e - w) * i) / 4, s + ((n - s) * j) / 4, w + ((e - w) * (i + 1)) / 4, s + ((n - s) * (j + 1)) / 4];
      (await searchBox("category/indian_restaurant", { bbox: bbox.join(","), limit: 25 })).forEach((f) => add(f, false));
    }
    for (const q of TEXT_QUERIES) for (const c of CENTERS) {
      (await searchBox("forward", { q, proximity: c.join(","), bbox: AREA.join(","), types: "poi", limit: 10 })).forEach((f) => add(f, true));
    }
    console.log(`Search Box: ${found.size} places`);
  } catch (err) {
    console.warn(`Search Box refused (${(err as Error).message}). Falling back to Geocoding v5.`);
    for (const q of TEXT_QUERIES) for (const c of CENTERS) (await geocodeV5(q, c)).forEach((f) => add(f, true));
    console.log(`Geocoding v5: ${found.size} places`);
  }
  return found;
}

async function main() {
  const found = await collect();
  const rows = [...found.values()].map((f) => {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const city = p.context?.place?.name ?? p.place_formatted?.split(",")[0]?.trim() ?? null;
    const cuisine: Cuisine = classify(p.name!, p.poi_category_ids ?? []);
    return {
      source: "mapbox",
      source_id: p.mapbox_id!,
      name: p.name!,
      lat,
      lon,
      address: p.address ?? null,
      city,
      cuisine,
      phone: p.metadata?.phone ?? null,
      website: p.metadata?.website ?? null,
      slug: `${slugify(p.name!)}-${slugify(city ?? "bay-area")}`,
    };
  });

  // Make slugs unique within this batch.
  const seen = new Map<string, number>();
  for (const r of rows) {
    const n = (seen.get(r.slug) ?? 0) + 1;
    seen.set(r.slug, n);
    if (n > 1) r.slug = `${r.slug}-${n}`;
  }

  const byCuisine = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.cuisine] = (acc[r.cuisine] ?? 0) + 1), acc), {});
  console.log(`Prepared ${rows.length} places:`, byCuisine);
  if (DRY) { console.table(rows.slice(0, 20).map(({ name, city, cuisine, slug }) => ({ name, city, cuisine, slug }))); return; }

  const supabase = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } });

  // Keep slugs that already exist so shared links never break.
  const { data: existing, error: readError } = await supabase.from("places").select("source_id, slug").eq("source", "mapbox");
  if (readError) throw readError;
  const existingSlug = new Map((existing ?? []).map((e) => [e.source_id as string, e.slug as string]));
  const taken = new Set((existing ?? []).map((e) => e.slug as string));
  for (const r of rows) {
    const keep = existingSlug.get(r.source_id);
    if (keep) { r.slug = keep; continue; }
    let slug = r.slug, k = 2;
    while (taken.has(slug)) slug = `${r.slug}-${k++}`;
    r.slug = slug;
    taken.add(slug);
  }

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("places").upsert(rows.slice(i, i + 200), { onConflict: "source,source_id" });
    if (error) throw error;
  }
  const { error: scoreError } = await supabase.rpc("refresh_place_scores", { target: null });
  if (scoreError) console.warn(`Scores not refreshed: ${scoreError.message}`);
  console.log(`Done. Upserted ${rows.length} places.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
