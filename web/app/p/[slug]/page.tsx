import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { PlaceActions, DishList, ReportButton } from "@/components/PlaceActions";
import SetupNotice from "@/components/SetupNotice";
import { CATEGORIES, type Cuisine } from "@/lib/categories";
import { isConfigured } from "@/lib/env";
import { createClient, getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

type PlaceRecord = {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lon: number;
  address: string | null;
  city: string | null;
  cuisine: Cuisine;
  phone: string | null;
  website: string | null;
  place_scores: { score: number; rating_count: number; recent_count: number; top_dish: string | null; top_dish_votes: number } | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

async function loadPlace(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("places")
    .select("id, slug, name, lat, lon, address, city, cuisine, phone, website, place_scores(score, rating_count, recent_count, top_dish, top_dish_votes)")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return null;
  const p = data as unknown as PlaceRecord;
  return { ...p, place_scores: one(p.place_scores as unknown as PlaceRecord["place_scores"] | PlaceRecord["place_scores"][]) };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  if (!isConfigured()) return {};
  const { slug } = await params;
  const p = await loadPlace(slug);
  if (!p) return { title: "Place not found" };
  const c = CATEGORIES[p.cuisine];
  const s = p.place_scores;
  const scoreLine = s && s.rating_count > 0 ? `${Number(s.score).toFixed(1)}/10 from ${s.rating_count} ratings` : "No ratings yet";
  const description = `${c.label} in ${p.city ?? "the Bay Area"} · ${scoreLine}${s?.top_dish ? ` · order the ${s.top_dish}` : ""}`;
  return {
    title: p.name,
    description,
    openGraph: { title: `${c.emoji} ${p.name}`, description, url: `/p/${p.slug}` },
    twitter: { card: "summary", title: `${c.emoji} ${p.name}`, description },
  };
}

export default async function PlacePage({ params }: Params) {
  if (!isConfigured()) return <SetupNotice />;
  const { slug } = await params;
  const place = await loadPlace(slug);
  if (!place) notFound();

  const { supabase, user } = await getUser();
  const c = CATEGORIES[place.cuisine];
  const s = place.place_scores;

  const [dishesRes, ratingsRes] = await Promise.all([
    supabase.from("dishes").select("id, name, dish_votes(count)").eq("place_id", place.id),
    supabase
      .from("ratings")
      .select("user_id, score, note, flagged, updated_at, profiles(display_name), business_replies(body, created_at)")
      .eq("place_id", place.id)
      .order("updated_at", { ascending: false })
      .limit(30),
  ]);

  type DishRow = { id: number; name: string; dish_votes: { count: number }[] };
  const dishRows = (dishesRes.data ?? []) as unknown as DishRow[];

  let myVotes: number[] = [];
  let myRating: { score: number; note: string | null } | null = null;
  let visitCount = 0;
  let saved = false;
  if (user) {
    const dishIds = dishRows.map((d) => d.id);
    const [votesRes, ratingRes, visitsRes, saveRes] = await Promise.all([
      dishIds.length ? supabase.from("dish_votes").select("dish_id").eq("user_id", user.id).in("dish_id", dishIds) : Promise.resolve({ data: [] }),
      supabase.from("ratings").select("score, note").eq("user_id", user.id).eq("place_id", place.id).maybeSingle(),
      supabase.from("visits").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("place_id", place.id),
      supabase.from("saves").select("place_id").eq("user_id", user.id).eq("place_id", place.id).maybeSingle(),
    ]);
    myVotes = ((votesRes.data ?? []) as { dish_id: number }[]).map((v) => v.dish_id);
    myRating = (ratingRes.data as { score: number; note: string | null } | null) ?? null;
    visitCount = visitsRes.count ?? 0;
    saved = Boolean(saveRes.data);
  }

  const dishes = dishRows
    .map((d) => ({ id: d.id, name: d.name, votes: d.dish_votes?.[0]?.count ?? 0, mine: myVotes.includes(d.id) }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));

  type RatingRow = {
    user_id: string;
    score: number;
    note: string | null;
    flagged: boolean;
    updated_at: string;
    profiles: { display_name: string | null } | { display_name: string | null }[] | null;
    business_replies: { body: string; created_at: string }[] | { body: string; created_at: string } | null;
  };
  const ratings = ((ratingsRes.data ?? []) as unknown as RatingRow[]).map((r) => ({
    ...r,
    name: one(r.profiles)?.display_name || "A Bhukkad",
    reply: one(r.business_replies),
  }));

  const address = [place.address, place.city].filter(Boolean).join(", ");
  const why = !s || s.rating_count === 0
    ? `No ratings yet. Starting from the ${c.label} average.`
    : `${s.rating_count} rating${s.rating_count === 1 ? "" : "s"}${s.recent_count ? ` · ${s.recent_count} this month` : ""}${s.top_dish ? ` · ${s.top_dish} upvoted ${s.top_dish_votes}×` : ""}`;

  return (
    <main className="page">
      <div className="pagebar">
        <Link href="/" className="logo">bhukkad<b>.</b></Link>
        <div className="spacer" style={{ flex: 1 }} />
        {user ? <Link className="pillbtn" href="/me">My map</Link> : <Link className="pillbtn" href={`/login?next=/p/${place.slug}`}>Sign in</Link>}
      </div>

      <div className="stack">
        <section className="panel stack">
          <div className="hero" style={{ "--c": c.hex } as CSSProperties}>
            <div className="em">{c.emoji}</div>
            <div style={{ minWidth: 0 }}>
              <h1>{place.name}</h1>
              <div className="sub">{c.label}{address ? ` · ${address}` : ""}</div>
            </div>
          </div>
          <div className="scorebox">
            <div className="bigscore">{s ? Number(s.score).toFixed(1) : "–"}<small> /10</small></div>
            <div className="why">Bhukkad Score<br />{why}</div>
          </div>
          <div className="btnrow">
            <a className="btn" href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}`} target="_blank" rel="noopener">Directions</a>
            {place.website ? <a className="btn" href={place.website} target="_blank" rel="noopener">Website</a> : null}
            {place.phone ? <span className="btn" style={{ userSelect: "all" }}>{place.phone}</span> : null}
          </div>
        </section>

        <PlaceActions
          placeId={place.id}
          slug={place.slug}
          signedIn={Boolean(user)}
          visitCount={visitCount}
          saved={saved}
          myRating={myRating}
        />

        <section className="panel stack">
          <h2 style={{ fontSize: 22 }}>What to order</h2>
          <DishList placeId={place.id} slug={place.slug} signedIn={Boolean(user)} dishes={dishes} />
        </section>

        <section className="panel">
          <h2 style={{ fontSize: 22, marginBottom: 8 }}>Ratings</h2>
          {ratings.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No ratings yet. Yours will be the first.</p>
          ) : (
            ratings.map((r) => (
              <article className="review" key={r.user_id}>
                <div className="head">
                  <span className="s">{r.score}</span>
                  <b>{r.name}</b>
                  <span className="muted" style={{ fontSize: 13 }}>{new Date(r.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  {r.flagged ? <span className="flagged">· under review, not counted in the score</span> : null}
                  <span style={{ flex: 1 }} />
                  {user && user.id !== r.user_id ? <ReportButton itemType="rating" itemId={`${r.user_id}:${place.id}`} slug={place.slug} /> : null}
                </div>
                {r.note ? <p>{r.note}</p> : null}
                {r.reply ? <p className="reply"><b>Owner:</b> {r.reply.body}</p> : null}
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
