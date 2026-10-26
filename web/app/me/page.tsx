import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import AccountSettings from "@/components/AccountSettings";
import SetupNotice from "@/components/SetupNotice";
import { CATEGORIES, CUISINES, type Cuisine } from "@/lib/categories";
import { isConfigured } from "@/lib/env";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My Bhukkad" };
export const dynamic = "force-dynamic";

type PlaceLite = { slug: string; name: string; cuisine: Cuisine; city: string | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default async function MePage() {
  if (!isConfigured()) return <SetupNotice />;
  const { supabase, user } = await getUser();
  if (!user) redirect("/login?next=/me");

  const [profileRes, visitsRes, ratingsRes, savesRes] = await Promise.all([
    supabase.from("profiles").select("display_name, created_at").eq("id", user.id).maybeSingle(),
    supabase.from("visits").select("place_id, visited_on, places(slug, name, cuisine, city)").eq("user_id", user.id).order("visited_on", { ascending: false }),
    supabase.from("ratings").select("score, updated_at, places(slug, name, cuisine, city)").eq("user_id", user.id).order("updated_at", { ascending: false }),
    supabase.from("saves").select("created_at, places(slug, name, cuisine, city)").eq("user_id", user.id).order("created_at", { ascending: false }),
  ]);

  type VisitRow = { place_id: string; visited_on: string; places: PlaceLite | PlaceLite[] | null };
  type RatingRow = { score: number; updated_at: string; places: PlaceLite | PlaceLite[] | null };
  type SaveRow = { created_at: string; places: PlaceLite | PlaceLite[] | null };

  const visits = (visitsRes.data ?? []) as unknown as VisitRow[];
  const ratings = ((ratingsRes.data ?? []) as unknown as RatingRow[]).map((r) => ({ ...r, place: one(r.places) })).filter((r) => r.place);
  const saves = ((savesRes.data ?? []) as unknown as SaveRow[]).map((r) => ({ ...r, place: one(r.places) })).filter((r) => r.place);

  // One row per place visited, newest first, with a visit count.
  const byPlace = new Map<string, { place: PlaceLite; last: string; count: number }>();
  for (const v of visits) {
    const place = one(v.places);
    if (!place) continue;
    const cur = byPlace.get(v.place_id);
    if (cur) cur.count += 1;
    else byPlace.set(v.place_id, { place, last: v.visited_on, count: 1 });
  }
  const visited = [...byPlace.values()];
  const cuisinesTried = CUISINES.filter((k) => visited.some((v) => v.place.cuisine === k));
  const name = profileRes.data?.display_name ?? user.email ?? "you";
  const fmt = (d: string) => new Date(d + (d.length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <main className="page">
      <div className="pagebar">
        <Link href="/" className="logo">bhukkad<b>.</b></Link>
        <div style={{ flex: 1 }} />
        <form action="/auth/signout" method="post"><button className="pillbtn" type="submit">Sign out</button></form>
      </div>

      <div className="stack">
        <section className="panel stack">
          <h1 style={{ fontSize: 30 }}>Hi {name.split(" ")[0]} 😋</h1>
          <div className="statgrid">
            <div className="stat"><b>{visited.length}</b><span>places tried</span></div>
            <div className="stat"><b>{ratings.length}</b><span>ratings</span></div>
            <div className="stat"><b>{cuisinesTried.length}/5</b><span>styles covered</span></div>
          </div>
          <div className="btnrow">
            <Link className="btn primary" href="/me/map">Open my food map</Link>
            <Link className="btn" href="/">Find somewhere new</Link>
          </div>
          {cuisinesTried.length < 5 && visited.length > 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Still to try: {CUISINES.filter((k) => !cuisinesTried.includes(k)).map((k) => `${CATEGORIES[k].emoji} ${CATEGORIES[k].label}`).join(", ")}
            </p>
          ) : null}
        </section>

        <section className="panel stack">
          <h2 style={{ fontSize: 22 }}>Been here</h2>
          {visited.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nothing yet. Open any place and tap Been here.</p>
          ) : (
            <div className="list">
              {visited.map((v) => (
                <Link key={v.place.slug} href={`/p/${v.place.slug}`} style={{ "--c": CATEGORIES[v.place.cuisine].hex } as CSSProperties}>
                  <span className="e">{CATEGORIES[v.place.cuisine].emoji}</span>
                  <span className="t">{v.place.name}</span>
                  <span className="r">{v.count > 1 ? `${v.count}× · ` : ""}{fmt(v.last)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel stack">
          <h2 style={{ fontSize: 22 }}>Want to try</h2>
          {saves.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Tap ☆ on a place to save it here.</p>
          ) : (
            <div className="list">
              {saves.map((s) => (
                <Link key={s.place!.slug} href={`/p/${s.place!.slug}`} style={{ "--c": CATEGORIES[s.place!.cuisine].hex } as CSSProperties}>
                  <span className="e">{CATEGORIES[s.place!.cuisine].emoji}</span>
                  <span className="t">{s.place!.name}</span>
                  <span className="r">{s.place!.city ?? ""}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel stack">
          <h2 style={{ fontSize: 22 }}>Your ratings</h2>
          {ratings.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>You haven&apos;t rated anything yet.</p>
          ) : (
            <div className="list">
              {ratings.map((r) => (
                <Link key={r.place!.slug} href={`/p/${r.place!.slug}`} style={{ "--c": CATEGORIES[r.place!.cuisine].hex } as CSSProperties}>
                  <span className="e">{CATEGORIES[r.place!.cuisine].emoji}</span>
                  <span className="t">{r.place!.name}</span>
                  <span className="r"><b>{r.score}</b>/10 · {fmt(r.updated_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <AccountSettings displayName={profileRes.data?.display_name ?? ""} />
      </div>
    </main>
  );
}
