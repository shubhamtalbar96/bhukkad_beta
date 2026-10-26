// Public settings, read once. Missing values don't crash the build; pages show a setup message instead.
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "",
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://bhukkad.io").replace(/\/$/, ""),
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
};

export const isConfigured = () => Boolean(env.supabaseUrl && env.supabaseAnonKey);
