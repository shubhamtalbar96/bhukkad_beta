import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <div className="pagebar"><Link href="/" className="logo">bhukkad<b>.</b></Link></div>
      <section className="panel stack">
        <h1 style={{ fontSize: 30 }}>That place isn&apos;t on the map</h1>
        <p className="muted" style={{ margin: 0 }}>It may have closed or the link may be old.</p>
        <div><Link className="btn primary" href="/">Back to the map</Link></div>
      </section>
    </main>
  );
}
