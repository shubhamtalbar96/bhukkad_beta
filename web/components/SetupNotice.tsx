// Shown only when the Supabase settings are missing, so a fresh deploy explains itself instead of crashing.
export default function SetupNotice() {
  return (
    <main className="page">
      <section className="panel stack">
        <h1 style={{ fontSize: 28 }}>bhukkad<span style={{ color: "var(--saffron)" }}>.</span> needs its settings</h1>
        <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
          Add <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to the
          environment, then redeploy. The setup guide in <code>docs/SETUP.md</code> walks through each one.
        </p>
      </section>
    </main>
  );
}
