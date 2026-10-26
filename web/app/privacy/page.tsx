import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy" };

// DRAFT: have this reviewed before public launch. It describes what the app actually stores today.
export default function Privacy() {
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  return (
    <main className="page">
      <div className="pagebar"><Link href="/" className="logo">bhukkad<b>.</b></Link></div>
      <article className="panel prose">
        <h1 style={{ fontSize: 30 }}>Privacy</h1>
        <p className="muted">Draft, last updated October 26, 2026.</p>
        <h2>What we store</h2>
        <p>Your email address and, if you sign in with Google, your name and profile photo. The ratings, notes, dish votes, check-ins and saved places you create.</p>
        <h2>What others can see</h2>
        <p>Ratings and notes are public with your display name. Check-ins and saved places are private to you.</p>
        <h2>Your location</h2>
        <p>Your browser shares your location with the page only to sort places by distance and show where you are on the map. We don&apos;t store it.</p>
        <h2>Services we use</h2>
        <p>Supabase hosts the database and sign-in. Mapbox draws the map. Vercel hosts the site. Cloudflare provides DNS, bot protection and privacy-friendly visit counts.</p>
        <h2>Deleting your data</h2>
        <p>Delete your account from your <Link href="/me">profile page</Link>. That removes your account and everything listed above.</p>
        <h2>California residents</h2>
        <p>You can ask what we hold about you and ask us to delete it. We don&apos;t sell personal information.</p>
        <h2>Contact</h2>
        <p>{contact ? <>Email <span style={{ userSelect: "all" }}>{contact}</span>.</> : "Contact details will be added before public launch."}</p>
      </article>
    </main>
  );
}
