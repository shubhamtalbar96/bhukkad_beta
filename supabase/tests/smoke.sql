-- Smoke test for permissions and scoring. Runs in CI after the migrations; any failed assertion stops the job.
\set ON_ERROR_STOP on

-- Two diners and one owner sign up (the trigger creates their profiles).
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'asha@example.com', '{"full_name":"Asha Rao"}'),
  ('22222222-2222-2222-2222-222222222222', 'ben@example.com', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'owner@example.com', '{"full_name":"Owner"}');

do $$ begin
  assert (select count(*) from public.profiles) = 3, 'profiles were not created by the sign-up trigger';
  assert (select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222') = 'ben', 'display name should fall back to the email name';
end $$;

insert into public.places (slug, name, lat, lon, cuisine) values
  ('test-dosa-sunnyvale', 'Test Dosa', 37.37, -122.03, 'south'),
  ('test-chaat-fremont', 'Test Chaat', 37.53, -121.97, 'snacks');

-- The owner's business is verified for Test Dosa.
insert into public.businesses (place_id, verified_at, verification_method)
  select id, now(), 'manual' from public.places where slug = 'test-dosa-sunnyvale';
insert into public.business_members (business_id, user_id)
  select b.id, '33333333-3333-3333-3333-333333333333' from public.businesses b;

-- ---- As Asha ----
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

insert into public.ratings (user_id, place_id, score, note)
  select '11111111-1111-1111-1111-111111111111', id, 9, 'Crisp dosa' from public.places where slug = 'test-dosa-sunnyvale';
update public.ratings set score = 8 where user_id = '11111111-1111-1111-1111-111111111111';
insert into public.visits (user_id, place_id) select '11111111-1111-1111-1111-111111111111', id from public.places where slug = 'test-dosa-sunnyvale';
insert into public.dishes (place_id, name, created_by) select id, 'Masala dosa', '11111111-1111-1111-1111-111111111111' from public.places where slug = 'test-dosa-sunnyvale';
insert into public.dish_votes (user_id, dish_id) select '11111111-1111-1111-1111-111111111111', id from public.dishes;
select public.refresh_one_place_score(id) from public.places where slug = 'test-dosa-sunnyvale';

do $$ begin
  -- Can't touch moderation fields.
  begin
    update public.ratings set flagged = true where user_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'diner was able to set flagged';
  exception when insufficient_privilege then null;
  end;
  -- Can't rate as someone else.
  begin
    insert into public.ratings (user_id, place_id, score) select '22222222-2222-2222-2222-222222222222', id, 1 from public.places where slug = 'test-chaat-fremont';
    raise exception 'diner rated as another user';
  exception when insufficient_privilege then null;
  end;
  -- Can't make themselves an admin.
  begin
    update public.profiles set is_admin = true where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'diner made themselves admin';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---- As Ben: can't see Asha's visits ----
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  assert (select count(*) from public.visits) = 0, 'visits leaked to another user';
  assert (select count(*) from public.ratings) = 1, 'ratings should be public';
end $$;

-- ---- As the owner: can't rate own place, can't delete Asha's rating ----
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$ begin
  begin
    insert into public.ratings (user_id, place_id, score) select '33333333-3333-3333-3333-333333333333', id, 10 from public.places where slug = 'test-dosa-sunnyvale';
    raise exception 'owner rated their own place';
  exception when insufficient_privilege then null;
  end;
end $$;
delete from public.ratings where user_id = '11111111-1111-1111-1111-111111111111';
do $$ begin
  assert (select count(*) from public.ratings) = 1, 'owner deleted a rating';
end $$;
insert into public.business_replies (business_id, rating_user_id, place_id, body)
  select b.id, '11111111-1111-1111-1111-111111111111', b.place_id, 'Thanks for coming!' from public.businesses b;

-- ---- Scores ----
reset role;
select public.refresh_place_scores();
do $$
declare s record;
begin
  select * into s from public.place_scores ps join public.places p on p.id = ps.place_id where p.slug = 'test-dosa-sunnyvale';
  assert s.rating_count = 1, format('expected 1 rating, got %s', s.rating_count);
  -- New account weight 0.3: (5 * 7.5 + 0.3 * 8) / 5.3 = 7.53 -> 7.5
  assert s.score = 7.5, format('expected score 7.5, got %s', s.score);
  assert s.top_dish = 'Masala dosa', format('expected top dish, got %s', s.top_dish);
  select * into s from public.place_scores ps join public.places p on p.id = ps.place_id where p.slug = 'test-chaat-fremont';
  assert s.rating_count = 0 and s.score = 7.5, 'unrated place should start at 7.5';
end $$;

-- Burst flagging: six new accounts rate the chaat place within a day.
insert into auth.users (id, email) select gen_random_uuid(), 'burst' || g || '@example.com' from generate_series(1, 6) g;
insert into public.ratings (user_id, place_id, score)
  select u.id, p.id, 10 from auth.users u, public.places p where u.email like 'burst%' and p.slug = 'test-chaat-fremont';
do $$ begin
  assert public.flag_rating_bursts() = 6, 'burst ratings were not flagged';
end $$;
select public.refresh_place_scores();
do $$ begin
  assert (select rating_count from public.place_scores ps join public.places p on p.id = ps.place_id where p.slug = 'test-chaat-fremont') = 0, 'flagged ratings still counted';
end $$;

\echo 'Smoke test passed'
