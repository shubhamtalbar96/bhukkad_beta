-- Bhukkad Score, burst flagging, and the hourly schedule.
--
-- score = (C * m + sum(w_i * r_i)) / (C + sum(w_i))
--   r_i  each rating, 1-10
--   w_i  0.5 ^ (age_days / 180), times an account-age factor (0.3 under 1 day, 0.6 under 7 days)
--   m    the place's seed score, else the average for its cuisine, else 7.5
--   C    5 (how many ratings it takes to move off m)

create or replace function public.refresh_place_scores(target uuid default null)
returns void
language sql
security definer
set search_path = public
as $$
  with weighted as (
    select
      r.place_id,
      r.score,
      power(0.5, extract(epoch from (now() - r.updated_at)) / 86400.0 / 180.0)
        * case
            when now() - pr.created_at < interval '1 day' then 0.3
            when now() - pr.created_at < interval '7 days' then 0.6
            else 1.0
          end as w,
      r.updated_at
    from public.ratings r
    join public.profiles pr on pr.id = r.user_id
    where not r.flagged
      and (target is null or r.place_id = target)
  ),
  agg as (
    select
      place_id,
      sum(w * score) as ws,
      sum(w) as sw,
      count(*) as n,
      count(*) filter (where updated_at > now() - interval '30 days') as recent
    from weighted
    group by place_id
  ),
  cuisine_avg as (
    select p.cuisine, avg(r.score)::numeric as m
    from public.ratings r
    join public.places p on p.id = r.place_id
    where not r.flagged
    group by p.cuisine
    having count(*) >= 10
  ),
  top_dish as (
    select distinct on (d.place_id) d.place_id, d.name, count(v.dish_id) as votes
    from public.dishes d
    left join public.dish_votes v on v.dish_id = d.id
    where target is null or d.place_id = target
    group by d.place_id, d.id, d.name
    order by d.place_id, count(v.dish_id) desc, d.name
  )
  insert into public.place_scores (place_id, score, rating_count, recent_count, top_dish, top_dish_votes, computed_at)
  select
    p.id,
    round((5 * coalesce(p.seed_score, ca.m, 7.5) + coalesce(a.ws, 0)) / (5 + coalesce(a.sw, 0)), 1),
    coalesce(a.n, 0),
    coalesce(a.recent, 0),
    case when coalesce(t.votes, 0) > 0 then t.name end,
    coalesce(t.votes, 0),
    now()
  from public.places p
  left join agg a on a.place_id = p.id
  left join cuisine_avg ca on ca.cuisine = p.cuisine
  left join top_dish t on t.place_id = p.id
  where target is null or p.id = target
  on conflict (place_id) do update set
    score          = excluded.score,
    rating_count   = excluded.rating_count,
    recent_count   = excluded.recent_count,
    top_dish       = excluded.top_dish,
    top_dish_votes = excluded.top_dish_votes,
    computed_at    = excluded.computed_at;
$$;

-- Flag sudden bursts: 6+ ratings for one place in 24 hours from accounts younger than 7 days.
-- Flagged ratings stay visible but stop counting until an admin reviews them.
create or replace function public.flag_rating_bursts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with burst_places as (
    select r.place_id
    from public.ratings r
    join public.profiles pr on pr.id = r.user_id
    where r.created_at > now() - interval '24 hours'
      and pr.created_at > now() - interval '7 days'
    group by r.place_id
    having count(*) >= 6
  )
  update public.ratings r
  set flagged = true
  from public.profiles pr, burst_places b
  where pr.id = r.user_id
    and r.place_id = b.place_id
    and r.created_at > now() - interval '24 hours'
    and pr.created_at > now() - interval '7 days'
    and not r.flagged;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Signed-in users may refresh one place right after rating it, so the count updates immediately.
-- The full refresh and burst flagging run only on the schedule.
create or replace function public.refresh_one_place_score(target uuid)
returns void
language sql
security definer
set search_path = public
as $$
  select public.refresh_place_scores(target);
$$;

revoke all on function public.refresh_place_scores(uuid) from public, anon, authenticated;
revoke all on function public.flag_rating_bursts() from public, anon, authenticated;
revoke all on function public.refresh_one_place_score(uuid) from public, anon;
grant execute on function public.refresh_one_place_score(uuid) to authenticated;
grant execute on function public.refresh_place_scores(uuid) to service_role;
grant execute on function public.flag_rating_bursts() to service_role;

-- Hourly schedule. pg_cron is available on Supabase (Database -> Extensions).
create extension if not exists pg_cron;
select cron.schedule(
  'bhukkad-hourly-scores',
  '7 * * * *',
  $$ select public.flag_rating_bursts(); select public.refresh_place_scores(); $$
);
