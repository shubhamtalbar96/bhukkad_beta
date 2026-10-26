-- Bhukkad v2: core schema, row-level security, and the Bhukkad Score.
-- Ratings are 1-10. Every table has RLS on; permissions live here, not in app code.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles (one per signed-in user, created automatically on sign-up)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  avatar_url   text,
  home_area    text,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Places
-- ---------------------------------------------------------------------------
create table public.places (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  lat         double precision not null,
  lon         double precision not null,
  address     text,
  city        text,
  cuisine     text not null check (cuisine in ('snacks', 'south', 'north', 'pan', 'truck')),
  tags        text[] not null default '{}',
  source      text not null default 'manual',
  source_id   text,
  hours       jsonb,
  phone       text,
  website     text,
  seed_score  numeric(3, 1) check (seed_score between 1 and 10),
  status      text not null default 'active' check (status in ('active', 'closed', 'hidden')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (source, source_id)
);
create index places_cuisine_idx on public.places (cuisine);

-- ---------------------------------------------------------------------------
-- Diner activity
-- ---------------------------------------------------------------------------
create table public.visits (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  place_id    uuid not null references public.places (id) on delete cascade,
  visited_on  date not null default current_date,
  created_at  timestamptz not null default now()
);
create index visits_user_idx on public.visits (user_id, visited_on desc);
create index visits_place_idx on public.visits (place_id);

create table public.ratings (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  place_id    uuid not null references public.places (id) on delete cascade,
  score       smallint not null check (score between 1 and 10),
  note        text check (char_length(note) <= 1000),
  flagged     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, place_id)
);
create index ratings_place_idx on public.ratings (place_id, updated_at desc);

create table public.dishes (
  id          bigint generated always as identity primary key,
  place_id    uuid not null references public.places (id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 60),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index dishes_place_name_idx on public.dishes (place_id, lower(name));

create table public.dish_votes (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  dish_id     bigint not null references public.dishes (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, dish_id)
);

-- "Want to try" saves. Public shareable lists come after launch.
create table public.saves (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  place_id    uuid not null references public.places (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, place_id)
);

-- ---------------------------------------------------------------------------
-- Restaurant side (screens come later; tables exist now so nothing is retrofitted)
-- ---------------------------------------------------------------------------
create table public.businesses (
  id                   uuid primary key default gen_random_uuid(),
  place_id             uuid not null unique references public.places (id) on delete cascade,
  verified_at          timestamptz,
  verification_method  text check (verification_method in ('phone', 'domain_email', 'manual')),
  created_at           timestamptz not null default now()
);

create table public.business_members (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null default 'owner' check (role in ('owner', 'staff')),
  created_at   timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table public.business_replies (
  id               bigint generated always as identity primary key,
  business_id      uuid not null references public.businesses (id) on delete cascade,
  rating_user_id   uuid not null,
  place_id         uuid not null,
  body             text not null check (char_length(body) between 1 and 1000),
  created_at       timestamptz not null default now(),
  foreign key (rating_user_id, place_id) references public.ratings (user_id, place_id) on delete cascade,
  unique (rating_user_id, place_id)
);

create table public.truck_checkins (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  lat          double precision not null,
  lon          double precision not null,
  until        timestamptz not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Scores, buzz, moderation
-- ---------------------------------------------------------------------------
create table public.place_scores (
  place_id        uuid primary key references public.places (id) on delete cascade,
  score           numeric(3, 1) not null,
  rating_count    integer not null default 0,
  recent_count    integer not null default 0,
  top_dish        text,
  top_dish_votes  integer not null default 0,
  computed_at     timestamptz not null default now()
);

create table public.mentions (
  id          bigint generated always as identity primary key,
  source      text not null,
  url         text not null,
  place_id    uuid not null references public.places (id) on delete cascade,
  dish        text,
  sentiment   numeric(3, 2) check (sentiment between -1 and 1),
  posted_at   timestamptz,
  created_at  timestamptz not null default now(),
  unique (source, url, place_id)
);

create table public.reports (
  id           bigint generated always as identity primary key,
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  item_type    text not null check (item_type in ('rating', 'reply', 'dish', 'place')),
  item_id      text not null,
  reason       text not null check (char_length(reason) between 3 and 500),
  status       text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- True when the signed-in user is an owner or staff member of the business that claimed this place.
create or replace function public.is_place_member(target_place uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.businesses b
    join public.business_members m on m.business_id = b.id
    where b.place_id = target_place
      and b.verified_at is not null
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_business_member(target_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = target_business and m.user_id = auth.uid()
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger ratings_touch before update on public.ratings
  for each row execute function public.touch_updated_at();
create trigger places_touch before update on public.places
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.places            enable row level security;
alter table public.visits            enable row level security;
alter table public.ratings           enable row level security;
alter table public.dishes            enable row level security;
alter table public.dish_votes        enable row level security;
alter table public.saves             enable row level security;
alter table public.businesses        enable row level security;
alter table public.business_members  enable row level security;
alter table public.business_replies  enable row level security;
alter table public.truck_checkins    enable row level security;
alter table public.place_scores      enable row level security;
alter table public.mentions          enable row level security;
alter table public.reports           enable row level security;

-- Profiles: public names, you edit only yours. is_admin can't be self-granted.
create policy "profiles are public" on public.profiles for select using (true);
create policy "edit own profile" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Places: everyone reads active places; verified owners edit their own listing.
create policy "active places are public" on public.places for select using (status = 'active' or public.is_place_member(id));
create policy "owners edit their place" on public.places for update
  using (public.is_place_member(id)) with check (public.is_place_member(id));

-- Visits and saves are private to their owner.
create policy "read own visits" on public.visits for select using (user_id = auth.uid());
create policy "add own visits" on public.visits for insert with check (user_id = auth.uid());
create policy "remove own visits" on public.visits for delete using (user_id = auth.uid());

create policy "read own saves" on public.saves for select using (user_id = auth.uid());
create policy "add own saves" on public.saves for insert with check (user_id = auth.uid());
create policy "remove own saves" on public.saves for delete using (user_id = auth.uid());

-- Ratings: public; one per person per place; owners can't rate their own place; never deletable by owners.
create policy "ratings are public" on public.ratings for select using (true);
create policy "rate as yourself" on public.ratings for insert
  with check (user_id = auth.uid() and not public.is_place_member(place_id) and flagged = false);
create policy "edit own rating" on public.ratings for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own rating" on public.ratings for delete using (user_id = auth.uid());

-- Dishes and dish votes.
create policy "dishes are public" on public.dishes for select using (true);
create policy "signed-in users add dishes" on public.dishes for insert with check (created_by = auth.uid());
create policy "dish votes are public" on public.dish_votes for select using (true);
create policy "vote as yourself" on public.dish_votes for insert with check (user_id = auth.uid());
create policy "unvote as yourself" on public.dish_votes for delete using (user_id = auth.uid());

-- Restaurant side: readable by all; claims are created by admins (service role) after verification.
create policy "businesses are public" on public.businesses for select using (true);
create policy "members are public" on public.business_members for select using (true);
create policy "replies are public" on public.business_replies for select using (true);
create policy "members reply" on public.business_replies for insert with check (public.is_business_member(business_id));
create policy "members edit replies" on public.business_replies for update
  using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "live checkins are public" on public.truck_checkins for select using (until > now());
create policy "members check in" on public.truck_checkins for insert
  with check (public.is_business_member(business_id) and until <= now() + interval '16 hours');

-- Scores and mentions are written by the service role / scoring job only.
create policy "scores are public" on public.place_scores for select using (true);
create policy "mentions are public" on public.mentions for select using (true);

-- Reports: anyone signed in can file; you see only your own.
create policy "file reports" on public.reports for insert with check (reporter_id = auth.uid());
create policy "read own reports" on public.reports for select using (reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Column-level limits: users can never set moderation or admin fields themselves.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from authenticated, anon;
grant update (display_name, avatar_url, home_area) on public.profiles to authenticated;

revoke update on public.ratings from authenticated, anon;
grant update (score, note) on public.ratings to authenticated;

revoke update on public.places from authenticated, anon;
grant update (address, hours, phone, website) on public.places to authenticated;
