import MapApp from "@/components/MapApp";
import SetupNotice from "@/components/SetupNotice";
import { isConfigured } from "@/lib/env";
import { getMapPlaces } from "@/lib/places";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isConfigured()) return <SetupNotice />;

  const [{ supabase, user }, places] = await Promise.all([getUser(), getMapPlaces()]);
  let visitedIds: string[] = [];
  let initial = "";
  if (user) {
    const [{ data: visits }, { data: profile }] = await Promise.all([
      supabase.from("visits").select("place_id").eq("user_id", user.id),
      supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
    ]);
    visitedIds = [...new Set((visits ?? []).map((v: { place_id: string }) => v.place_id))];
    initial = (profile?.display_name ?? user.email ?? "").trim().charAt(0).toUpperCase();
  }

  return <MapApp places={places} visitedIds={visitedIds} signedIn={Boolean(user)} initial={initial} />;
}
