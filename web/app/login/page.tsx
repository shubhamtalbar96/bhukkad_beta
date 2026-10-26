import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getUser } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (isConfigured()) {
    const { user } = await getUser();
    if (user) redirect(safeNext);
  }

  return (
    <main className="page">
      <div className="pagebar">
        <Link href="/" className="logo">bhukkad<b>.</b></Link>
      </div>
      <section className="panel stack" style={{ maxWidth: 440 }}>
        <h1 style={{ fontSize: 30 }}>Sign in to rate and track</h1>
        <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
          Rate places, upvote what to order, and build a map of every Indian spot you&apos;ve tried.
        </p>
        {error ? <p className="err" style={{ margin: 0 }}>That sign-in link didn&apos;t work. It may have expired, so request a new one.</p> : null}
        <LoginForm next={safeNext} />
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          By signing in you agree to the <Link href="/terms">terms</Link> and <Link href="/privacy">privacy policy</Link>.
        </p>
      </section>
    </main>
  );
}
