import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms" };

// DRAFT: have this reviewed before public launch, and before the restaurant portal opens.
export default function Terms() {
  return (
    <main className="page">
      <div className="pagebar"><Link href="/" className="logo">bhukkad<b>.</b></Link></div>
      <article className="panel prose">
        <h1 style={{ fontSize: 30 }}>Terms of use</h1>
        <p className="muted">Draft, last updated October 26, 2026.</p>
        <h2>Ratings are opinions</h2>
        <p>Rate places you&apos;ve actually eaten at. Ratings and notes are your honest opinion of your own visit.</p>
        <h2>What&apos;s not allowed</h2>
        <ul>
          <li>Rating a place you own, work at, or compete with.</li>
          <li>Paying for, trading or coordinating ratings.</li>
          <li>Hate, harassment, threats, or personal details about staff or other diners.</li>
          <li>Spam, ads or links in notes.</li>
        </ul>
        <h2>Moderation</h2>
        <p>We may hide ratings that break these rules or that our checks flag as coordinated. Flagged ratings stop counting toward a score while we review them. Anyone can report a rating.</p>
        <h2>Restaurant owners</h2>
        <p>Verified owners can reply to ratings and update their listing. Owners can&apos;t remove or hide ratings.</p>
        <h2>No guarantees</h2>
        <p>Hours, menus and locations can be out of date. Check with the restaurant before you go, especially for allergies.</p>
      </article>
    </main>
  );
}
