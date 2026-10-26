"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addDish, addVisit, deleteRating, rate, report, toggleDishVote, toggleSave, type ActionResult } from "@/app/actions";

function useAction(slug: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok && res.needsSignIn) {
        router.push(`/login?next=/p/${slug}`);
        return;
      }
      setMsg(res.ok ? (res.message ? { ok: true, text: res.message } : null) : { ok: false, text: res.error });
      if (res.ok) after?.();
    });
  return { pending, msg, run };
}

export function PlaceActions(props: {
  placeId: string;
  slug: string;
  signedIn: boolean;
  visitCount: number;
  saved: boolean;
  myRating: { score: number; note: string | null } | null;
}) {
  const { placeId, slug, signedIn, visitCount, saved, myRating } = props;
  const { pending, msg, run } = useAction(slug);
  const [score, setScore] = useState<number | null>(myRating?.score ?? null);
  const [note, setNote] = useState(myRating?.note ?? "");

  return (
    <section className="panel stack">
      <div className="btnrow">
        <button className={"btn" + (visitCount ? " on" : "")} disabled={pending} onClick={() => run(() => addVisit(placeId, slug))}>
          {visitCount ? `✓ Been here${visitCount > 1 ? ` ${visitCount}×` : ""} · check in again` : "Been here"}
        </button>
        <button className={"btn" + (saved ? " on" : "")} disabled={pending} onClick={() => run(() => toggleSave(placeId, slug, saved))}>
          {saved ? "★ Want to try" : "☆ Want to try"}
        </button>
      </div>

      <div className="stack">
        <h2 style={{ fontSize: 22 }}>{myRating ? "Your rating" : "Rate it"}</h2>
        {!signedIn ? <p className="muted" style={{ margin: 0 }}>Sign in to rate. It takes one tap with Google.</p> : null}
        <div className="scale" role="radiogroup" aria-label="Score from 1 to 10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} role="radio" aria-checked={score === n} aria-pressed={score === n} onClick={() => setScore(n)}>{n}</button>
          ))}
        </div>
        <label className="field" htmlFor="note">
          A line about it (optional)
          <textarea id="note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="The masala dosa was crisp, sambar tasted homemade…" />
        </label>
        <div className="btnrow">
          <button className="btn primary" disabled={pending || score === null} onClick={() => score && run(() => rate(placeId, slug, score, note))}>
            {pending ? "Saving…" : myRating ? "Update rating" : "Post rating"}
          </button>
          {myRating ? (
            <button className="btn" disabled={pending} onClick={() => run(() => deleteRating(placeId, slug), () => { setScore(null); setNote(""); })}>
              Remove my rating
            </button>
          ) : null}
        </div>
      </div>
      {msg ? <p className={msg.ok ? "ok" : "err"} style={{ margin: 0 }} role="status">{msg.text}</p> : null}
    </section>
  );
}

export function DishList(props: {
  placeId: string;
  slug: string;
  signedIn: boolean;
  dishes: { id: number; name: string; votes: number; mine: boolean }[];
}) {
  const { placeId, slug, signedIn, dishes } = props;
  const { pending, msg, run } = useAction(slug);
  const [name, setName] = useState("");

  return (
    <div className="stack">
      {dishes.length === 0 ? <p className="muted" style={{ margin: 0 }}>No dishes yet. Add the one you&apos;d tell a friend to order.</p> : null}
      <div className="dishes">
        {dishes.map((d) => (
          <div className="dish" key={d.id}>
            <span>{d.name}</span>
            <button aria-pressed={d.mine} disabled={pending} onClick={() => run(() => toggleDishVote(d.id, placeId, slug, d.mine))} aria-label={`${d.mine ? "Remove upvote for" : "Upvote"} ${d.name}`}>
              ▲ {d.votes}
            </button>
          </div>
        ))}
      </div>
      <form
        className="addrow"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addDish(placeId, slug, name), () => setName(""));
        }}
      >
        <input id="dish" type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={signedIn ? "Add a dish, e.g. Paneer 65" : "Sign in to add dishes"} aria-label="Dish name" />
        <button className="btn" type="submit" disabled={pending || name.trim().length < 2}>Add</button>
      </form>
      {msg ? <p className={msg.ok ? "ok" : "err"} style={{ margin: 0 }} role="status">{msg.text}</p> : null}
    </div>
  );
}

export function ReportButton({ itemType, itemId, slug }: { itemType: "rating" | "reply" | "dish" | "place"; itemId: string; slug: string }) {
  const { pending, msg, run } = useAction(slug);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (msg?.ok) return <span className="muted" style={{ fontSize: 12 }}>Reported</span>;
  if (!open) return <button className="muted" style={{ fontSize: 12, fontWeight: 700 }} onClick={() => setOpen(true)}>Report</button>;
  return (
    <form
      className="addrow"
      style={{ width: "100%", marginTop: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => report(itemType, itemId, reason, slug));
      }}
    >
      <input type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="What's wrong with it?" aria-label="Reason for report" />
      <button className="btn" type="submit" disabled={pending}>Send</button>
      {msg && !msg.ok ? <span className="err">{msg.text}</span> : null}
    </form>
  );
}
