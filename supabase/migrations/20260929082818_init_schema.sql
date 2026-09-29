-- DLC Gaming App: core schema, row-level security, match state functions,
-- realtime and storage.

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- The very first signed-in user can make themselves admin. After that only
-- existing admins can add more (by inserting into public.admins).
create or replace function public.claim_first_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  lock table public.admins in exclusive mode;
  if exists (select 1 from public.admins) then
    return public.is_admin();
  end if;
  insert into public.admins (user_id) values (auth.uid());
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Catalog and tournaments
-- ---------------------------------------------------------------------------
create table public.games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cover_url text,
  default_match_minutes int not null default 20 check (default_match_minutes > 0),
  created_at timestamptz not null default now()
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  start_date date not null,
  days int not null default 1 check (days between 1 and 60),
  daily_start time not null default '10:00',
  daily_end time not null default '20:00',
  timezone text not null default 'Asia/Karachi',
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'live', 'finished')),
  banner_url text,
  created_at timestamptz not null default now(),
  check (daily_end > daily_start)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name text not null,
  logo_url text,
  created_at timestamptz not null default now(),
  unique (tournament_id, name)
);
create index teams_tournament_idx on public.teams (tournament_id);

create table public.tournament_games (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete restrict,
  match_minutes int not null check (match_minutes > 0),
  buffer_minutes int not null default 5 check (buffer_minutes >= 0),
  stations int not null default 1 check (stations between 1 and 64),
  champion_team_id uuid references public.teams (id) on delete set null,
  status text not null default 'setup'
    check (status in ('setup', 'fixtures_ready', 'live', 'finished')),
  created_at timestamptz not null default now(),
  unique (tournament_id, game_id)
);
create index tournament_games_tournament_idx on public.tournament_games (tournament_id);

create table public.entries (
  tournament_game_id uuid not null references public.tournament_games (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  seed int check (seed > 0),
  primary key (tournament_game_id, team_id)
);
create index entries_team_idx on public.entries (team_id);

-- ---------------------------------------------------------------------------
-- Matches
-- ---------------------------------------------------------------------------
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  tournament_game_id uuid not null references public.tournament_games (id) on delete cascade,
  round int not null check (round >= 1),
  position int not null check (position >= 0),
  team_a_id uuid references public.teams (id) on delete set null,
  team_b_id uuid references public.teams (id) on delete set null,
  next_match_id uuid references public.matches (id) on delete set null
    deferrable initially deferred,
  next_slot text check (next_slot in ('a', 'b')),
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'live', 'completed')),
  is_bye boolean not null default false,
  winner_id uuid references public.teams (id) on delete set null,
  score_a int,
  score_b int,
  station int,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  image_url text,
  updated_at timestamptz not null default now(),
  unique (tournament_game_id, round, position)
);
create index matches_tournament_idx on public.matches (tournament_id);
create index matches_tg_idx on public.matches (tournament_game_id);
create index matches_next_idx on public.matches (next_match_id);
create index matches_status_idx on public.matches (status);
create index matches_team_a_idx on public.matches (team_a_id);
create index matches_team_b_idx on public.matches (team_b_id);
create index matches_winner_idx on public.matches (winner_id);
create index tournament_games_game_idx on public.tournament_games (game_id);
create index tournament_games_champion_idx on public.tournament_games (champion_team_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger matches_touch before update on public.matches
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: everyone reads, only admins write.
-- ---------------------------------------------------------------------------
alter table public.admins enable row level security;
alter table public.games enable row level security;
alter table public.tournaments enable row level security;
alter table public.teams enable row level security;
alter table public.tournament_games enable row level security;
alter table public.entries enable row level security;
alter table public.matches enable row level security;

create policy "admins read own row" on public.admins
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "admins add admins" on public.admins
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins remove admins" on public.admins
  for delete to authenticated using ((select public.is_admin()));

do $$
declare t text;
begin
  foreach t in array array['games', 'tournaments', 'teams', 'tournament_games', 'entries', 'matches'] loop
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy "admin insert" on public.%I for insert to authenticated with check ((select public.is_admin()))', t);
    execute format('create policy "admin update" on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('create policy "admin delete" on public.%I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Match state functions. All bracket movement happens here so web and mobile
-- behave the same and every step is one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can do this' using errcode = '42501';
  end if;
end;
$$;

-- Replace a game's whole bracket with the given matches (built by the client
-- bracket generator). Refused once any real match has started.
create or replace function public.replace_bracket(p_tournament_game_id uuid, p_matches jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament_id uuid;
begin
  perform public.assert_admin();

  select tournament_id into v_tournament_id
  from public.tournament_games where id = p_tournament_game_id for update;
  if v_tournament_id is null then
    raise exception 'Tournament game not found';
  end if;

  if exists (
    select 1 from public.matches
    where tournament_game_id = p_tournament_game_id
      and (status = 'live' or (status = 'completed' and not is_bye))
  ) then
    raise exception 'Fixtures cannot be regenerated after a match has started';
  end if;

  delete from public.matches where tournament_game_id = p_tournament_game_id;

  insert into public.matches (
    id, tournament_id, tournament_game_id, round, position, team_a_id, team_b_id,
    next_match_id, next_slot, status, is_bye, winner_id, station,
    scheduled_start, scheduled_end, ended_at
  )
  select
    m.id, v_tournament_id, p_tournament_game_id, m.round, m.position, m.team_a_id, m.team_b_id,
    m.next_match_id, m.next_slot, m.status, m.is_bye, m.winner_id, m.station,
    m.scheduled_start, m.scheduled_end, case when m.is_bye then now() end
  from jsonb_to_recordset(p_matches) as m(
    id uuid, round int, position int, team_a_id uuid, team_b_id uuid,
    next_match_id uuid, next_slot text, status text, is_bye boolean, winner_id uuid,
    station int, scheduled_start timestamptz, scheduled_end timestamptz
  );

  update public.tournament_games
  set status = 'fixtures_ready', champion_team_id = null
  where id = p_tournament_game_id;

  update public.tournaments set status = 'scheduled'
  where id = v_tournament_id and status = 'draft';
end;
$$;

-- Save new times/stations for many matches at once (schedule reflow).
create or replace function public.update_schedule(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  update public.matches m
  set scheduled_start = i.scheduled_start,
      scheduled_end = i.scheduled_end,
      station = i.station
  from jsonb_to_recordset(p_items) as i(id uuid, scheduled_start timestamptz, scheduled_end timestamptz, station int)
  where m.id = i.id and m.status in ('pending', 'ready');
end;
$$;

create or replace function public.start_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
begin
  perform public.assert_admin();
  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status <> 'ready' then
    raise exception 'Match can only start when both teams are set and it has not started (status: %)', m.status;
  end if;

  update public.matches set status = 'live', started_at = now(), ended_at = null
  where id = p_match_id returning * into m;

  update public.tournament_games set status = 'live'
  where id = m.tournament_game_id and status in ('setup', 'fixtures_ready');
  update public.tournaments set status = 'live'
  where id = m.tournament_id and status in ('draft', 'scheduled');
  return m;
end;
$$;

create or replace function public.end_match(
  p_match_id uuid, p_winner_id uuid, p_score_a int default null, p_score_b int default null
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  n public.matches;
begin
  perform public.assert_admin();
  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status not in ('live', 'ready') then
    raise exception 'Only a live or ready match can be ended (status: %)', m.status;
  end if;
  if m.team_a_id is null or m.team_b_id is null
     or p_winner_id is null or p_winner_id not in (m.team_a_id, m.team_b_id) then
    raise exception 'Winner must be one of the two teams in the match';
  end if;

  update public.matches
  set status = 'completed', winner_id = p_winner_id, score_a = p_score_a, score_b = p_score_b,
      started_at = coalesce(started_at, now()), ended_at = now()
  where id = p_match_id returning * into m;

  if m.next_match_id is not null then
    select * into n from public.matches where id = m.next_match_id for update;
    if m.next_slot = 'a' then
      update public.matches set team_a_id = p_winner_id where id = n.id returning * into n;
    else
      update public.matches set team_b_id = p_winner_id where id = n.id returning * into n;
    end if;
    if n.status = 'pending' and n.team_a_id is not null and n.team_b_id is not null then
      update public.matches set status = 'ready' where id = n.id;
    end if;
  else
    -- The final: crown the champion.
    update public.tournament_games set champion_team_id = p_winner_id, status = 'finished'
    where id = m.tournament_game_id;
    if not exists (
      select 1 from public.tournament_games
      where tournament_id = m.tournament_id and status <> 'finished'
    ) then
      update public.tournaments set status = 'finished' where id = m.tournament_id;
    end if;
  end if;
  return m;
end;
$$;

-- Undo a result while the next match has not started.
create or replace function public.reopen_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  n public.matches;
begin
  perform public.assert_admin();
  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status <> 'completed' or m.is_bye then
    raise exception 'Only a played, completed match can be reopened';
  end if;

  if m.next_match_id is not null then
    select * into n from public.matches where id = m.next_match_id for update;
    if n.status in ('live', 'completed') then
      raise exception 'The next match has already started, reopen that one first';
    end if;
    if m.next_slot = 'a' then
      update public.matches set team_a_id = null, status = 'pending' where id = n.id;
    else
      update public.matches set team_b_id = null, status = 'pending' where id = n.id;
    end if;
  else
    update public.tournament_games set champion_team_id = null, status = 'live'
    where id = m.tournament_game_id;
    update public.tournaments set status = 'live'
    where id = m.tournament_id and status = 'finished';
  end if;

  update public.matches
  set status = 'live', winner_id = null, score_a = null, score_b = null, ended_at = null
  where id = p_match_id returning * into m;
  return m;
end;
$$;

-- Swap two team slots between matches that have not started (fixture editing).
create or replace function public.swap_slots(
  p_match_a uuid, p_slot_a text, p_match_b uuid, p_slot_b text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.matches;
  b public.matches;
  team_from_a uuid;
  team_from_b uuid;
begin
  perform public.assert_admin();
  if p_slot_a not in ('a', 'b') or p_slot_b not in ('a', 'b') then
    raise exception 'Slot must be a or b';
  end if;
  select * into a from public.matches where id = p_match_a for update;
  select * into b from public.matches where id = p_match_b for update;
  if a.id is null or b.id is null then raise exception 'Match not found'; end if;
  if a.tournament_game_id <> b.tournament_game_id then
    raise exception 'Both matches must be in the same game';
  end if;
  if a.status not in ('pending', 'ready') or b.status not in ('pending', 'ready') or a.is_bye or b.is_bye then
    raise exception 'Only matches that have not started can be edited';
  end if;

  team_from_a := case when p_slot_a = 'a' then a.team_a_id else a.team_b_id end;
  team_from_b := case when p_slot_b = 'a' then b.team_a_id else b.team_b_id end;

  if p_match_a = p_match_b then
    if p_slot_a = p_slot_b then return; end if;
    update public.matches set team_a_id = team_b_id, team_b_id = team_a_id where id = p_match_a;
    return;
  end if;

  if p_slot_a = 'a' then
    update public.matches set team_a_id = team_from_b where id = p_match_a;
  else
    update public.matches set team_b_id = team_from_b where id = p_match_a;
  end if;
  if p_slot_b = 'a' then
    update public.matches set team_a_id = team_from_a where id = p_match_b;
  else
    update public.matches set team_b_id = team_from_a where id = p_match_b;
  end if;

  update public.matches
  set status = case when team_a_id is not null and team_b_id is not null then 'ready' else 'pending' end
  where id in (p_match_a, p_match_b);
end;
$$;

revoke execute on function public.assert_admin() from public, anon;
revoke execute on function public.claim_first_admin() from public, anon;
revoke execute on function public.replace_bracket(uuid, jsonb) from public, anon;
revoke execute on function public.update_schedule(jsonb) from public, anon;
revoke execute on function public.start_match(uuid) from public, anon;
revoke execute on function public.end_match(uuid, uuid, int, int) from public, anon;
revoke execute on function public.reopen_match(uuid) from public, anon;
revoke execute on function public.swap_slots(uuid, text, uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.matches, public.tournaments, public.tournament_games, public.teams;

-- ---------------------------------------------------------------------------
-- Storage: public bucket for covers, logos and match photos. Admins write.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "admins upload media" on storage.objects
  for insert to authenticated with check (bucket_id = 'media' and (select public.is_admin()));
create policy "admins update media" on storage.objects
  for update to authenticated using (bucket_id = 'media' and (select public.is_admin()));
create policy "admins delete media" on storage.objects
  for delete to authenticated using (bucket_id = 'media' and (select public.is_admin()));
