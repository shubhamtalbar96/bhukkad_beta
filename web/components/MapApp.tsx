"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Map as MapboxMap, Marker as MapboxMarker, GeoJSONSource } from "mapbox-gl";
import { CATEGORIES, CUISINES, type Filter } from "@/lib/categories";
import type { MapPlace } from "@/lib/places";
import { env } from "@/lib/env";

type LngLat = [number, number];
type Light = "dawn" | "day" | "dusk" | "night";
type Mapbox = typeof import("mapbox-gl").default;

const DEFAULT_CENTER: LngLat = [-121.9886, 37.3541]; // Santa Clara
const BASEMAP: Record<string, string | boolean> = {
  colorLand: "#eef3df", colorWater: "#56c6f4", colorGreenspace: "#9fe07f", colorMotorways: "#ffcf3a",
  colorTrunks: "#ffe27d", colorRoads: "#ffffff", colorCommercial: "#ffe3ec", colorEducation: "#e3dcff",
  colorMedical: "#ffd9d9", colorIndustrial: "#e6e2d6",
  showPointOfInterestLabels: false, showTransitLabels: false, showPedestrianRoads: false, show3dObjects: true,
};

const lightForHour = (h: number): Light => (h < 6 || h >= 20 ? "night" : h < 8 ? "dawn" : h >= 17 ? "dusk" : "day");
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

function km(a: LngLat, b: LngLat) {
  const R = 6371, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const fmtMi = (k: number) => { const mi = k * 0.621; return mi < 0.1 ? "right here" : mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`; };
const scoreText = (p: MapPlace) => (p.score === null ? "new" : p.score.toFixed(1));

export type MapAppProps = {
  places: MapPlace[];
  mode?: "explore" | "mine";
  visitedIds?: string[];
  signedIn?: boolean;
  initial?: string;
};

export default function MapApp({ places, mode = "explore", visitedIds = [], signedIn = false, initial = "" }: MapAppProps) {
  const mapEl = useRef<HTMLDivElement>(null);
  const cardsEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const glRef = useRef<Mapbox | null>(null);
  const markers = useRef(new Map<string, MapboxMarker>());
  const meMarker = useRef<MapboxMarker | null>(null);
  const programmatic = useRef(false);
  const spinning = useRef(false);

  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userLoc, setUserLoc] = useState<LngLat | null>(null);
  const [located, setLocated] = useState(false);
  const [sheetMin, setSheetMin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<string>(env.mapboxToken ? "" : "The map token is missing. Set NEXT_PUBLIC_MAPBOX_TOKEN.");
  const [light, setLight] = useState<Light>("day");
  const [buzz, setBuzz] = useState(false);
  const [threeD, setThreeD] = useState(true);
  const [spin, setSpin] = useState(false);
  const [desktop, setDesktop] = useState(false);

  const visited = useMemo(() => new Set(visitedIds), [visitedIds]);
  const origin = useCallback((): LngLat => userLoc ?? DEFAULT_CENTER, [userLoc]);

  const visible = useMemo(() => {
    const o = userLoc ?? DEFAULT_CENTER;
    return places
      .filter((p) => filter === "all" || p.cuisine === filter)
      .map((p) => ({ ...p, d: km(o, [p.lon, p.lat]) }))
      .sort((a, b) => a.d - b.d);
  }, [places, filter, userLoc]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: places.length };
    for (const p of places) c[p.cuisine] = (c[p.cuisine] ?? 0) + 1;
    return c;
  }, [places]);

  const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const focusOffset = useCallback((): [number, number] => (window.innerWidth >= 900 ? [208, 20] : [0, -100]), []);

  // ---------- location ----------
  const locate = useCallback(
    () =>
      new Promise<LngLat | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        const t = setTimeout(() => resolve(null), 7000);
        navigator.geolocation.getCurrentPosition(
          (p) => { clearTimeout(t); resolve([p.coords.longitude, p.coords.latitude]); },
          () => { clearTimeout(t); resolve(null); },
          { timeout: 6000, maximumAge: 600000 },
        );
      }),
    [],
  );

  const swoop = useCallback(
    (center: LngLat) => {
      mapRef.current?.flyTo({ center, offset: focusOffset(), zoom: mode === "mine" ? 11.5 : 14.2, pitch: 58, bearing: -20, duration: reduceMotion() ? 0 : 6000, curve: 1.9, essential: true });
    },
    [focusOffset, mode],
  );

  // ---------- map setup (once) ----------
  useEffect(() => {
    if (!env.mapboxToken || !mapEl.current) return;
    let cancelled = false;
    let introSpin = true;
    const startLight = lightForHour(new Date().getHours());
    setLight(startLight);
    setDesktop(window.innerWidth >= 900);
    const onResize = () => setDesktop(window.innerWidth >= 900);
    window.addEventListener("resize", onResize);

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !mapEl.current) return;
      glRef.current = mapboxgl;
      mapboxgl.accessToken = env.mapboxToken;
      const map = new mapboxgl.Map({
        container: mapEl.current,
        style: "mapbox://styles/mapbox/standard",
        projection: "globe",
        center: [-110, 33],
        zoom: 1.6,
        logoPosition: "bottom-right",
      });
      mapRef.current = map;

      map.on("style.load", () => {
        for (const [k, v] of Object.entries({ ...BASEMAP, lightPreset: startLight })) {
          try { map.setConfigProperty("basemap", k, v); } catch { /* older style: ignore */ }
        }
        try {
          map.setFog({ range: [1, 10], color: "#cfeefd", "high-color": "#7fd0ff", "horizon-blend": 0.08, "space-color": "#1d2a6b", "star-intensity": 0.4 });
        } catch { /* fog unsupported */ }
      });
      map.on("error", (e) => {
        const status = (e.error as { status?: number } | undefined)?.status;
        if ((status === 401 || status === 403) && !map.isStyleLoaded()) setToast("Mapbox refused the map token. Check its URL restrictions.");
      });
      map.on("dragstart", () => { spinning.current = false; setSpin(false); });

      map.on("load", async () => {
        const start = performance.now();
        if (!reduceMotion()) {
          const turn = () => { if (!introSpin) return; map.setCenter([-110 + (performance.now() - start) / 60, 33]); requestAnimationFrame(turn); };
          turn();
        }
        map.addSource("places", {
          type: "geojson", data: fc([]), cluster: true, clusterRadius: 64, clusterMaxZoom: 15,
          clusterProperties: Object.fromEntries(CUISINES.map((k) => [k, ["+", ["case", ["==", ["get", "cuisine"], k], 1, 0]]])),
        });
        map.addSource("buzz", { type: "geojson", data: fc([]) });
        map.addSource("link", { type: "geojson", data: fc([]) });
        map.addLayer({
          id: "buzz-heat", type: "heatmap", source: "buzz", layout: { visibility: "none" }, slot: "middle",
          paint: {
            "heatmap-weight": ["get", "w"], "heatmap-intensity": 1.4,
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 30, 15, 90], "heatmap-opacity": 0.75,
            "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.15, "rgba(70,170,255,.55)", 0.35, "#43e0a6", 0.55, "#ffe14d", 0.75, "#ff9a3d", 1, "#ff3d6e"],
          },
        });
        map.addLayer({ id: "link-line", type: "line", source: "link", slot: "top", layout: { "line-cap": "round" }, paint: { "line-color": "#ff3d6e", "line-width": 4, "line-dasharray": [0.6, 1.6], "line-opacity": 0.9 } });
        map.addLayer({ id: "places-anchor", type: "circle", source: "places", slot: "top", paint: { "circle-radius": 0, "circle-opacity": 0 } });

        const loc = await locate();
        introSpin = false;
        if (cancelled) return;
        setUserLoc(loc);
        setLocated(true);
        if (!loc && mode === "explore") setToast("Location is off, so distances are from Santa Clara.");
        setReady(true);
        swoop(loc ?? DEFAULT_CENTER);
      });
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      markers.current.forEach((m) => m.remove());
      markers.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- live location tracking ----------
  useEffect(() => {
    if (!ready || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition((p) => setUserLoc([p.coords.longitude, p.coords.latitude]), () => {}, { enableHighAccuracy: true, maximumAge: 30000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [ready]);

  // ---------- data -> map sources ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("places") as GeoJSONSource | undefined)?.setData(
      fc(visible.map((p) => ({ type: "Feature", properties: { id: p.id, cuisine: p.cuisine }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } }))),
    );
    const maxRecent = Math.max(1, ...visible.map((p) => p.recentCount));
    (map.getSource("buzz") as GeoJSONSource | undefined)?.setData(
      fc(visible.map((p) => ({ type: "Feature", properties: { w: 0.15 + 0.85 * (p.recentCount / maxRecent) }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } }))),
    );
    markers.current.forEach((m) => m.remove());
    markers.current.clear();
  }, [ready, visible]);

  // ---------- "you are here" + link line ----------
  useEffect(() => {
    const map = mapRef.current, gl = glRef.current;
    if (!ready || !map || !gl) return;
    if (!meMarker.current) {
      const el = document.createElement("div");
      el.className = "meloc";
      el.innerHTML = `<div class="in"><span class="ring"></span><span class="ring r2"></span><div class="av">😋</div><div class="tag"></div></div>`;
      meMarker.current = new gl.Marker({ element: el, anchor: "center" }).setLngLat(origin()).addTo(map);
    }
    const el = meMarker.current.getElement();
    el.classList.toggle("approx", !userLoc);
    const tag = el.querySelector(".tag");
    if (tag) tag.textContent = userLoc ? "You" : "Santa Clara · location off";
    meMarker.current.setLngLat(origin());

    const sel = places.find((p) => p.id === selectedId);
    (map.getSource("link") as GeoJSONSource | undefined)?.setData(
      fc(sel ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [origin(), [sel.lon, sel.lat]] } }] : []),
    );
  }, [ready, userLoc, selectedId, places, origin]);

  // ---------- markers from clusters ----------
  const select = useCallback(
    (id: string, opts: { fly?: boolean; scroll?: boolean } = {}) => {
      setSelectedId(id);
      spinning.current = false;
      setSpin(false);
      const p = places.find((x) => x.id === id);
      const map = mapRef.current;
      if (!p || !map) return;
      if (opts.fly) map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 15.6), pitch: 58, offset: focusOffset(), duration: reduceMotion() ? 0 : 1400, essential: true });
      if (opts.scroll) {
        setSheetMin(false);
        const card = cardsEl.current?.querySelector<HTMLElement>(`[data-id="${id}"]`);
        if (card) {
          programmatic.current = true;
          card.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", inline: "start", block: "nearest" });
          setTimeout(() => { programmatic.current = false; }, 800);
        }
      }
    },
    [places, focusOffset],
  );
  const selectRef = useRef(select);
  selectRef.current = select;

  useEffect(() => {
    const map = mapRef.current, gl = glRef.current;
    if (!ready || !map || !gl) return;
    const byId = new Map(places.map((p) => [p.id, p]));

    const pinEl = (p: MapPlace) => {
      const c = CATEGORIES[p.cuisine];
      const el = document.createElement("div");
      el.className = "pin" + (p.recentCount >= 3 ? " hot" : "");
      el.dataset.pid = p.id;
      el.style.setProperty("--c", c.hex);
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.setAttribute("aria-label", `${p.name}, score ${scoreText(p)}`);
      el.innerHTML =
        `<div class="in"><div class="face">${c.emoji}</div><div class="badge${p.score === null ? " new" : ""}">${scoreText(p)}</div>` +
        (p.recentCount >= 3 ? `<span class="fire">🔥</span>` : "") +
        (visited.has(p.id) ? `<span class="done">✓</span>` : "") +
        `<div class="name">${esc(p.name)}</div></div>`;
      const go = (e: Event) => { e.stopPropagation(); selectRef.current(p.id, { fly: true, scroll: true }); };
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") go(e); });
      return el;
    };

    const clusterEl = (props: Record<string, number>, coords: LngLat, clusterId: number) => {
      const el = document.createElement("div");
      el.className = "clu";
      const top = CUISINES.filter((k) => props[k] > 0).sort((a, b) => props[b] - props[a]).slice(0, 3);
      el.innerHTML = `<div class="in"><span class="em">${top.map((k) => CATEGORIES[k].emoji).join("")}</span><b>${props.point_count}</b></div>`;
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.setAttribute("aria-label", `${props.point_count} places, zoom in`);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const src = map.getSource("places") as GeoJSONSource;
        src.getClusterExpansionZoom(clusterId, (err, z) => {
          map.easeTo({ center: coords, zoom: Math.min((err || z == null ? map.getZoom() + 2 : z) + 0.3, 16.5), duration: reduceMotion() ? 0 : 900 });
        });
      });
      return el;
    };

    const sync = () => {
      if (!map.getSource("places") || !map.isSourceLoaded("places")) return;
      const keep = new Set<string>();
      for (const f of map.querySourceFeatures("places")) {
        const pr = (f.properties ?? {}) as Record<string, number & string>;
        const coords = (f.geometry as GeoJSON.Point).coordinates as LngLat;
        const key = pr.cluster ? `c${pr.cluster_id}` : String(pr.id);
        if (keep.has(key)) continue;
        keep.add(key);
        if (markers.current.has(key)) continue;
        let el: HTMLElement;
        if (pr.cluster) el = clusterEl(pr as unknown as Record<string, number>, coords, Number(pr.cluster_id));
        else {
          const place = byId.get(String(pr.id));
          if (!place) continue;
          el = pinEl(place);
        }
        markers.current.set(key, new gl.Marker({ element: el, anchor: "bottom" }).setLngLat(coords).addTo(map));
      }
      for (const [k, m] of markers.current) if (!keep.has(k)) { m.remove(); markers.current.delete(k); }
    };
    map.on("render", sync);
    sync();
    return () => { map.off("render", sync); };
  }, [ready, places, visited]);

  // highlight the selected pin
  useEffect(() => {
    for (const [k, m] of markers.current) m.getElement().classList.toggle("sel", k === selectedId);
  });

  // pick the closest place once everything is ready
  useEffect(() => {
    if (ready && located && !selectedId && visible[0]) {
      const t = setTimeout(() => setSelectedId((cur) => cur ?? visible[0].id), 6200);
      return () => clearTimeout(t);
    }
  }, [ready, located, selectedId, visible]);

  // on phones, swiping the cards flies the map
  useEffect(() => {
    if (desktop || !cardsEl.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (programmatic.current) return;
        const best = entries.find((e) => e.isIntersecting && e.intersectionRatio > 0.9);
        const id = (best?.target as HTMLElement | undefined)?.dataset.id;
        if (id) selectRef.current(id, { fly: true });
      },
      { root: cardsEl.current, threshold: [0.9] },
    );
    cardsEl.current.querySelectorAll(".card").forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [desktop, visible]);

  // ---------- layers ----------
  useEffect(() => { try { mapRef.current?.setConfigProperty("basemap", "lightPreset", light); } catch { /* not ready */ } }, [light]);
  useEffect(() => { try { mapRef.current?.setConfigProperty("basemap", "show3dObjects", threeD); } catch { /* not ready */ } }, [threeD]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getLayer("buzz-heat")) return;
    map.setLayoutProperty("buzz-heat", "visibility", buzz ? "visible" : "none");
    if (buzz) map.easeTo({ zoom: Math.min(map.getZoom(), 11.8), pitch: 45, duration: reduceMotion() ? 0 : 1200 });
    if (!buzz || reduceMotion()) return;
    const t = setInterval(() => map.setPaintProperty("buzz-heat", "heatmap-intensity", 1.25 + Math.sin((performance.now() / 1000) * 1.8) * 0.35), 90);
    return () => clearInterval(t);
  }, [buzz, ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!spin || !map || reduceMotion()) { spinning.current = false; return; }
    spinning.current = true;
    const orbit = () => { if (!spinning.current) return; map.easeTo({ bearing: map.getBearing() + 12, duration: 2000, easing: (t) => t }); map.once("moveend", () => spinning.current && orbit()); };
    orbit();
    return () => { spinning.current = false; };
  }, [spin]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".menu, [data-layers]")) setMenuOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  async function nearMe() {
    const loc = await locate();
    if (loc) { setUserLoc(loc); setToast(""); }
    else setToast("Your browser blocked location. Allow it for this site in the address bar, then tap again.");
    swoop(loc ?? DEFAULT_CENTER);
  }

  function chooseFilter(k: Filter) {
    setFilter(k);
    setSelectedId(null);
    cardsEl.current?.scrollTo({ left: 0, top: 0 });
    const first = places.filter((p) => k === "all" || p.cuisine === k).map((p) => ({ p, d: km(origin(), [p.lon, p.lat]) })).sort((a, b) => a.d - b.d)[0];
    if (first) setTimeout(() => select(first.p.id, { fly: true }), 50);
  }

  const list = visible.slice(0, 40);
  const title = mode === "mine" ? (filter === "all" ? "Places you've been" : `${CATEGORIES[filter].label} you've tried`) : filter === "all" ? "Closest to you" : `${CATEGORIES[filter].label} near you`;

  return (
    <div className="mapapp">
      <div ref={mapEl} className="map" aria-label="Map of Indian food places" />

      <header className="top">
        <div className="row">
          <Link href="/" className="logo">bhukkad<b>.</b></Link>
          <div className="spacer" />
          <button className="round" onClick={nearMe} aria-label="Fly to my location" title="Fly to my location">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-8-8 18-2-8z" /></svg>
          </button>
          <button className="round" data-layers onClick={() => setMenuOpen((o) => !o)} aria-label="Map layers" aria-expanded={menuOpen} title="Layers">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></svg>
          </button>
          {signedIn ? (
            <Link className="round me" href="/me" aria-label="My Bhukkad map" title="My map">{initial || "😋"}</Link>
          ) : (
            <Link className="pillbtn" href="/login">Sign in</Link>
          )}
        </div>
        <nav className="chips" aria-label="Quick filters">
          {(Object.keys(CATEGORIES) as Filter[]).map((k) => (
            <button key={k} className="chip" style={{ "--c": CATEGORIES[k].hex } as CSSProperties} aria-pressed={k === filter} onClick={() => chooseFilter(k)}>
              <span className="e">{CATEGORIES[k].emoji}</span>
              {CATEGORIES[k].label}
              <span className="n">{counts[k] ?? 0}</span>
            </button>
          ))}
        </nav>
      </header>

      {menuOpen ? (
        <div className="menu">
          <h3>Time of day</h3>
          <div className="seg">
            {(["dawn", "day", "dusk", "night"] as Light[]).map((v) => (
              <button key={v} aria-pressed={light === v} onClick={() => setLight(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
            ))}
          </div>
          <button className="toggle" aria-pressed={buzz} onClick={() => setBuzz((b) => !b)}>Rating activity heatmap <i /></button>
          <button className="toggle" aria-pressed={threeD} onClick={() => setThreeD((b) => !b)}>3D buildings &amp; trees <i /></button>
          <button className="toggle" aria-pressed={spin} onClick={() => setSpin((b) => !b)}>Slow orbit <i /></button>
        </div>
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          {toast} <button onClick={() => setToast("")}>OK</button>
        </div>
      ) : null}

      <section className={"sheet" + (sheetMin ? " min" : "")} aria-label="Places">
        <button className="handle" onClick={() => setSheetMin((m) => !m)} aria-label="Collapse or expand list" />
        <div className="shead">
          <h2>{title}</h2>
          <span>{visible.length ? `${visible.length} places` : ""}</span>
        </div>
        <div className="cards" ref={cardsEl}>
          {list.length === 0 ? (
            <div className="empty">
              {mode === "mine" ? "No check-ins yet. Open a place and tap Been here to start your map." : "No places here yet."}
            </div>
          ) : (
            list.map((p) => {
              const c = CATEGORIES[p.cuisine];
              return (
                <article
                  key={p.id}
                  className={"card" + (p.id === selectedId ? " sel" : "")}
                  tabIndex={0}
                  data-id={p.id}
                  style={{ "--c": c.hex } as CSSProperties}
                  onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) select(p.id, { fly: true }); }}
                  onKeyDown={(e) => { if (e.key === "Enter") select(p.id, { fly: true }); }}
                >
                  <div className="em">{c.emoji}<b>{scoreText(p)}</b></div>
                  <h3 title={p.name}>{p.name}</h3>
                  <div className="meta"><b>{c.label}</b> · {fmtMi(p.d)} · {p.address || "address not listed"}</div>
                  <div className="known">
                    {p.topDish ? <><em>Order</em> {p.topDish}</> : <em>{p.ratingCount ? `${p.ratingCount} ratings` : "No ratings yet. Be the first."}</em>}
                    {p.recentCount >= 3 ? <> · <span className="hotline">🔥 Busy this month</span></> : null}
                    {visited.has(p.id) ? <> · <span className="ok">✓ Been here</span></> : null}
                  </div>
                  <div className="actions">
                    <Link href={`/p/${p.slug}`}>Rate &amp; details</Link>
                    <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`} target="_blank" rel="noopener">Directions</a>
                  </div>
                </article>
              );
            })
          )}
        </div>
        <p className="note">Scores come from Bhukkad ratings, weighted for recency. New places start from their cuisine&apos;s average.</p>
      </section>
    </div>
  );
}
