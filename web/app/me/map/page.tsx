import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MapApp from "@/components/MapApp";
import SetupNotice from "@/components/SetupNotice";
import { isConfigured } from "@/lib/env";
import { PLACE_COLUMNS, toMapPlace } from "@/lib/places";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My food map" };
export const dynamic = "force-dynamic";

// Your personal Bhukkad map: only the places you've checked in at.
export default async function MyMapPage() {
  if (!isConfigured()) return <SetupNotice />;
  const { supabase, user } = await getUser();
  if (!user) redirect("/login?next=/me/map");

  const { data: visits } = await supabase.from("visits").select("place_id").eq("user_id", user.id);
  const ids = [...new Set((visits ?? []).map((v: { place_id: string }) => v.place_id))];
  const { data } = ids.length ? await supabase.from("places").select(PLACE_COLUMNS).in("id", ids) : { data: [] };
  const places = ((data ?? []) as unknown as Parameters<typeof toMapPlace>[0][]).map(toMapPlace);
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const initial = (profile?.display_name ?? user.email ?? "").trim().charAt(0).toUpperCase();

  return <MapApp places={places} mode="mine" visitedIds={ids} signedIn initial={initial} />;
}
