# Bhukkad v2 setup

The new app lives in `web/` (Next.js + TypeScript) with its database in `supabase/`. The current beta (`index.html` at the repo root) keeps serving bhukkad.io from GitHub Pages until you switch DNS in step 6.

About 30 minutes, all on free plans.

## 1. Supabase project

1. Create a project at supabase.com (pick the US West region).
2. **SQL Editor:** paste and run `supabase/migrations/20261026000000_init.sql`, then `supabase/migrations/20261026000100_scores.sql`.
   - If the second file errors on `pg_cron`, enable it under **Database → Extensions**, then run it again.
3. **Project Settings → API:** copy the Project URL, the `anon` key and the `service_role` key. The service-role key bypasses all permissions: never put it in chat, the repo or any `NEXT_PUBLIC_` variable.

## 2. Sign-in

1. **Authentication → URL Configuration:** set Site URL to `https://bhukkad.io` and add these redirect URLs:
   `https://bhukkad.io/auth/callback`, `https://*.vercel.app/auth/callback`, `http://localhost:3000/auth/callback`.
2. **Email links** work out of the box. Supabase's built-in email has a low hourly limit; add your own SMTP (Resend has a free tier) before launch.
3. **Google:** in Google Cloud Console create an OAuth client (Web application) with the redirect URI Supabase shows under **Authentication → Providers → Google**. Paste the client ID and secret there and enable it.
4. **Optional, Turnstile:** create a Turnstile widget in Cloudflare for `bhukkad.io`. Put the secret key in **Authentication → Attack Protection → Captcha** and the site key in `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

## 3. Mapbox tokens

- **Map token** (`NEXT_PUBLIC_MAPBOX_TOKEN`): your existing URL-restricted public token. Add `https://bhukkad.io` and your Vercel preview domain to its URL restrictions.
- **Search token** (`MAPBOX_SEARCH_TOKEN`): a second public token with **no** URL restriction. It is used only by the import script on a server, never in the page.

## 4. Load places

Add repository secrets under **GitHub → Settings → Secrets and variables → Actions**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MAPBOX_SEARCH_TOKEN`.

Then open **Actions → Import places → Run workflow**. Run it once with "dry run" ticked to check the list, then again with it unticked to write to the database. Re-running is safe: places are matched by their Mapbox ID and keep their links.

## 5. Vercel

1. Import the `bhukkad_beta` repo at vercel.com and set **Root Directory** to `web`.
2. Add environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_SITE_URL=https://bhukkad.io`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, used for account deletion), and optionally `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `NEXT_PUBLIC_CONTACT_EMAIL`.
3. Deploy and test on the `*.vercel.app` preview URL first.

## 6. Switch bhukkad.io to the new app

1. In Vercel → Project → Domains, add `bhukkad.io` and `www.bhukkad.io`. Vercel shows the DNS records it wants.
2. In Cloudflare DNS, replace the four GitHub A records and the `www` CNAME with Vercel's records. Keep them **DNS only** (grey cloud).
3. In the GitHub repo's Pages settings, remove the custom domain so GitHub stops claiming it.

## Local development (optional)

```bash
cd web
cp .env.example .env.local   # fill in the values
npm install
npm run dev                  # http://localhost:3000
```

## How the pieces fit

| Path | What it is |
| --- | --- |
| `web/app/page.tsx` | The map home page |
| `web/app/p/[slug]/page.tsx` | A place: score, Been here, rating, dishes, reviews, link previews |
| `web/app/me` | Your stats, check-ins, saves, ratings, account deletion; `/me/map` is your personal food map |
| `web/app/actions.ts` | Every write (rate, check in, save, dish votes, reports) |
| `web/components/MapApp.tsx` | The animated Mapbox map, shared by the home page and your personal map |
| `supabase/migrations` | Tables, permissions (row-level security) and the Bhukkad Score |
| `supabase/tests/smoke.sql` | Permission and scoring tests that run in CI |
| `web/scripts/import-places.ts` | Loads places from Mapbox into Supabase |
