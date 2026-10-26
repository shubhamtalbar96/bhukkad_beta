"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string; needsSignIn?: boolean };

const SIGN_IN: ActionResult = { ok: false, error: "Sign in to do that.", needsSignIn: true };

function done(slug: string, message?: string): ActionResult {
  revalidatePath(`/p/${slug}`);
  revalidatePath("/me");
  return { ok: true, message };
}

export async function rate(placeId: string, slug: string, score: number, note: string): Promise<ActionResult> {
  const { supabase, user } = await getUser();
  if (!user) return SIGN_IN;
  if (!Number.isInteger(score) || score < 1 || score > 10) return { ok: false, error: "Pick a score from 1 to 10." };
  const cleanNote = note.trim().slice(0, 1000) || null;

  // Update first; only score and note are editable, so an upsert (which rewrites the key columns) is not allowed.
  const { data: updated, error: updateError } = await supabase
    .from("ratings")
    .update({ score, note: cleanNote })
    .eq("user_id", user.id)
    .eq("place_id", placeId)
    .select("place_id");
  if (updateError) return { ok: false, error: updateError.message };

  if (!updated || updated.length === 0) {
    const { error } = await supabase.from("ratings").insert({ user_id: user.id, place_id: placeId, score, note: cleanNote });
    if (error) {
      if (error.code === "42501") return { ok: false, error: "Owners can't rate their own place." };
      return { ok: false, error: error.message };
    }
  }

  await supabase.rpc("refresh_one_place_score", { target: placeId });
  return done(slug, "Rating saved.");
}

export async function deleteRating(placeId: string, slug: string): Promise<ActionResult> {
  const { supabase, user } = await getUser();
  if (!user) return SIGN_IN;
  const { error } = await supabase.from("ratings").delete().eq("user_id", user.id).eq("place_id", placeId);
  if (error) return { ok: false, error: error.message };
  await supabase.rpc("refresh_one_place_score", { target: placeId });
  return done(slug, "Rating removed.");
}

export async function addVisit(placeId: string, slug: string): Promise<ActionResult> {
  const { supabase, user } = await getUser();
  if (!user) return SIGN_IN;
  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await supabase
    .from("visits")
    .select("id")
    .eq("user_id", user.id)
    .eq("place_id", placeId)
    .eq("visited_on", today)
    .limit(1);
  if (existing && existing.length > 0) return { ok: true, message: "Already checked in today." };
  const { error } = await supabase.from("visits").insert({ user_id: user.id, place_id: placeId });
  if (error) return { ok: false, error: error.message };
  return done(slug, "Checked in. It's on your map.");
}

export async function toggleSave(placeId: string, slug: string, saved: boolean): Promise<ActionResult> {
  const { supabase, user } = await getUser();
  if (!user) return SIGN_IN;
  const { error } = saved
    ? await supabase.from("saves").delete().eq("user_id", user.id).eq("place_id", placeId)
    : await supabase.from("saves").insert({ user_id: user.id, place_id: placeId });
  if (error) return { ok: false, error: error.message };
  return done(slug, saved ? "Removed from Want to try." : "Added to Want to try.");
}

export async function toggleDishVote(dishId: number, placeId: string, slug: string, voted: boolean): Promise<ActionResult> {
  const { supabase, user } = await getUser();
  if (!user) return SIGN_IN;
  const { error } = voted
    ? await supabase.from("dish_votes").delete().eq("user_id", user.id).eq("dish_id", dishId)
    : await supabase.from("dish_votes").insert({ user_id: user.id, dish_id: dishId });
  if (error) return { ok: false, error: error.message };
  await supabase.rpc("refresh_one_place_score", { target: placeId });
  return done(slug);
}

export async function addDish(placeId: string, slug: string, name: string): Promise<ActionResult> {
  const { supabase, user } = await getUser();
  if (!user) return SIGN_IN;
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (clean.length < 2) return { ok: false, error: "Type a dish name." };

  const { data: dish, error } = await supabase
    .from("dishes")
    .insert({ place_id: placeId, name: clean, created_by: user.id })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: `${clean} is already on the list. Upvote it instead.` };
    return { ok: false, error: error.message };
  }
  // Adding a dish counts as your vote for it.
  await supabase.from("dish_votes").insert({ user_id: user.id, dish_id: dish.id });
  await supabase.rpc("refresh_one_place_score", { target: placeId });
  return done(slug, `Added ${clean}.`);
}

export async function updateDisplayName(name: string): Promise<ActionResult> {
  const { supabase, user } = await getUser();
  if (!user) return SIGN_IN;
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (clean.length < 2) return { ok: false, error: "Use at least 2 characters." };
  const { error } = await supabase.from("profiles").update({ display_name: clean }).eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/me");
  return { ok: true, message: "Name saved." };
}

// Deletes the account and, through cascading foreign keys, every rating, visit, vote and save.
export async function deleteAccount(confirmText: string): Promise<ActionResult> {
  const { supabase, user } = await getUser();
  if (!user) return SIGN_IN;
  if (confirmText.trim().toLowerCase() !== "delete") return { ok: false, error: 'Type "delete" to confirm.' };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Account deletion isn't switched on yet. Use the contact link on the privacy page and we'll delete it for you." };
  const placeIds = ((await supabase.from("ratings").select("place_id").eq("user_id", user.id)).data ?? []).map((r: { place_id: string }) => r.place_id);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: error.message };
  for (const id of placeIds) await admin.rpc("refresh_place_scores", { target: id });
  await supabase.auth.signOut();
  revalidatePath("/");
  return { ok: true, message: "Your account and data are deleted." };
}

export async function report(itemType: "rating" | "reply" | "dish" | "place", itemId: string, reason: string, slug: string): Promise<ActionResult> {
  const { supabase, user } = await getUser();
  if (!user) return SIGN_IN;
  const clean = reason.trim().slice(0, 500);
  if (clean.length < 3) return { ok: false, error: "Say briefly what's wrong." };
  const { error } = await supabase.from("reports").insert({ reporter_id: user.id, item_type: itemType, item_id: itemId, reason: clean });
  if (error) return { ok: false, error: error.message };
  return done(slug, "Thanks. We'll take a look.");
}
