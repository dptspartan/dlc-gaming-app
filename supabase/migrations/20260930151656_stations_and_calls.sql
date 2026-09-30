-- Stations are shared by the whole tournament. Each game says how many
-- stations one of its matches takes (and optionally which stations can host
-- it). Game masters (admins) look after stations. A match is called first:
-- it shows as "waiting for players" with a countdown, then starts.

alter table public.tournaments
  add column stations int not null default 4 check (stations between 1 and 64),
  add column call_minutes int not null default 5 check (call_minutes between 1 and 60);

-- Per-game station counts become a per-match requirement.
alter table public.tournament_games rename column stations to stations_required;
update public.tournament_games set stations_required = 1;
alter table public.tournament_games
  alter column stations_required set default 1,
  drop constraint if exists tournament_games_stations_check,
  add constraint tournament_games_stations_required_check check (stations_required between 1 and 16),
  add column allowed_stations int[];

alter table public.matches
  drop constraint matches_status_check,
  add constraint matches_status_check check (status in ('pending', 'ready', 'called', 'live', 'completed')),
  add column stations int[],
  add column called_at timestamptz,
  add column not_before timestamptz;
update public.matches set stations = array[station] where station is not null;

-- Which admin runs which station during a tournament.
create table public.station_masters (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  station int not null check (station between 1 and 64),
  user_id uuid not null references public.admins (user_id) on delete cascade,
  primary key (tournament_id, station)
);
create index station_masters_user_idx on public.station_masters (user_id);
alter table public.station_masters enable row level security;
create policy "admins read" on public.station_masters for select to authenticated using ((select public.is_admin()));
create policy "admins insert" on public.station_masters for insert to authenticated with check ((select public.is_admin()));
create policy "admins update" on public.station_masters for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete" on public.station_masters for delete to authenticated using ((select public.is_admin()));
alter publication supabase_realtime add table public.station_masters;

-- Admins with their sign-in emails, for assigning game masters.
create or replace function public.list_admins()
returns table (user_id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return query select a.user_id, u.email::text from public.admins a join auth.users u on u.id = a.user_id order by u.email;
end;
$$;

-- Call a ready match to a station: it takes that station plus, for games
-- that need more than one, the lowest-numbered other free stations it may
-- use. Refused while the stations it needs are busy.
create or replace function public.call_match(p_match_id uuid, p_station int)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  t public.tournaments;
  tg public.tournament_games;
  busy int[];
  taken int[];
  s int;
begin
  perform public.assert_admin();
  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status <> 'ready' then
    raise exception 'Only a match with both sides set that has not been called can be called (status: %)', m.status;
  end if;
  select * into tg from public.tournament_games where id = m.tournament_game_id;
  select * into t from public.tournaments where id = m.tournament_id for update;
  if p_station is null or p_station < 1 or p_station > t.stations then
    raise exception 'Station % does not exist (this tournament has % stations)', p_station, t.stations;
  end if;
  if tg.allowed_stations is not null and not (p_station = any (tg.allowed_stations)) then
    raise exception 'This game is not played on station %', p_station;
  end if;

  select coalesce(array_agg(distinct x), '{}') into busy
  from public.matches bm, unnest(coalesce(bm.stations, array[bm.station])) x
  where bm.tournament_id = m.tournament_id and bm.status in ('called', 'live') and bm.id <> m.id;
  if p_station = any (busy) then
    raise exception 'Station % is busy', p_station;
  end if;

  taken := array[p_station];
  for s in select g from generate_series(1, t.stations) g order by abs(g - p_station), g loop
    exit when cardinality(taken) >= tg.stations_required;
    if s = p_station or s = any (busy) then continue; end if;
    if tg.allowed_stations is not null and not (s = any (tg.allowed_stations)) then continue; end if;
    taken := taken || s;
  end loop;
  if cardinality(taken) < tg.stations_required then
    raise exception 'This game needs % stations together; only % are free right now', tg.stations_required, cardinality(taken);
  end if;

  update public.matches
  set status = 'called', called_at = now(), station = p_station, stations = taken, not_before = null,
      scheduled_start = now() + make_interval(mins => t.call_minutes),
      scheduled_end = now() + make_interval(mins => t.call_minutes + tg.match_minutes)
  where id = p_match_id returning * into m;
  return m;
end;
$$;

-- Send a called match back to the queue (players did not show, or the
-- station is needed for something else). p_delay_minutes keeps it out of the
-- timetable for a while so the next match goes first.
create or replace function public.uncall_match(p_match_id uuid, p_delay_minutes int default 0)
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
  if m.status not in ('called', 'ready') then
    raise exception 'Only a called or waiting match can go back to the queue (status: %)', m.status;
  end if;
  update public.matches
  set status = 'ready', called_at = null, stations = null,
      not_before = case when coalesce(p_delay_minutes, 0) > 0 then now() + make_interval(mins => p_delay_minutes) end
  where id = p_match_id returning * into m;
  return m;
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
  s record;
  minutes int;
begin
  perform public.assert_admin();
  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status not in ('ready', 'called') then
    raise exception 'Match can only start when both teams are set and it has not started (status: %)', m.status;
  end if;
  select * into s from public.match_scoring(m.tournament_game_id);
  select match_minutes into minutes from public.tournament_games where id = m.tournament_game_id;

  update public.matches
  set status = 'live', started_at = now(), ended_at = null, not_before = null,
      stations = coalesce(stations, case when station is not null then array[station] end),
      scheduled_start = now(), scheduled_end = now() + make_interval(mins => minutes),
      score_a = case when s.scoring = 'none' then null else 0 end,
      score_b = case when s.scoring = 'none' then null else 0 end
  where id = p_match_id returning * into m;

  update public.tournament_games set status = 'live'
  where id = m.tournament_game_id and status in ('setup', 'fixtures_ready');
  update public.tournaments set status = 'live'
  where id = m.tournament_id and status in ('draft', 'scheduled');
  return m;
end;
$$;

-- Scoring a called match starts it, like scoring a ready one did.
create or replace function public.score_point(p_match_id uuid, p_side text, p_delta int default 1)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  s record;
  a int;
  b int;
  need int;
begin
  perform public.assert_admin();
  if p_side not in ('a', 'b') then raise exception 'Side must be a or b'; end if;
  if p_delta not in (-1, 1) then raise exception 'Scores change one point at a time'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  select * into s from public.match_scoring(m.tournament_game_id);
  if s.scoring = 'none' then raise exception 'This game has live scoring turned off'; end if;
  if m.status in ('ready', 'called') then
    m := public.start_match(p_match_id);
  elsif m.status <> 'live' then
    raise exception 'Only a live match can be scored (status: %)', m.status;
  end if;

  a := coalesce(m.score_a, 0) + case when p_side = 'a' then p_delta else 0 end;
  b := coalesce(m.score_b, 0) + case when p_side = 'b' then p_delta else 0 end;
  if a < 0 or b < 0 then raise exception 'Score cannot go below zero'; end if;

  if s.scoring = 'rounds' then
    need := s.best_of / 2 + 1;
    if a >= need then return public.finish_match(p_match_id, m.team_a_id, a, b); end if;
    if b >= need then return public.finish_match(p_match_id, m.team_b_id, a, b); end if;
  end if;

  update public.matches set score_a = a, score_b = b where id = p_match_id returning * into m;
  return m;
end;
$$;

-- End a match (also a called one, e.g. a walkover). Scored games pick the
-- winner from the score; games without live scoring need p_winner_id.
create or replace function public.end_match(
  p_match_id uuid, p_winner_id uuid default null, p_score_a int default null, p_score_b int default null
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  s record;
  a int;
  b int;
  w uuid;
begin
  perform public.assert_admin();
  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status not in ('live', 'ready', 'called') then
    raise exception 'Only a live, called or ready match can be ended (status: %)', m.status;
  end if;
  if m.team_a_id is null or m.team_b_id is null then
    raise exception 'Both teams must be set before the match can end';
  end if;
  select * into s from public.match_scoring(m.tournament_game_id);

  if s.scoring = 'none' then
    if p_winner_id is null or p_winner_id not in (m.team_a_id, m.team_b_id) then
      raise exception 'Winner must be one of the two teams in the match';
    end if;
    return public.finish_match(p_match_id, p_winner_id, null, null);
  end if;

  a := coalesce(p_score_a, m.score_a, 0);
  b := coalesce(p_score_b, m.score_b, 0);
  if a = b then
    raise exception 'The score is level at %-%. Add the deciding point before ending the match', a, b;
  end if;
  w := case when a > b then m.team_a_id else m.team_b_id end;
  return public.finish_match(p_match_id, w, a, b);
end;
$$;

-- Save the timetable: time and stations for matches still in the queue.
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
      station = i.station,
      stations = coalesce(i.stations, case when i.station is not null then array[i.station] end)
  from jsonb_to_recordset(p_items) as i(id uuid, scheduled_start timestamptz, scheduled_end timestamptz, station int, stations int[])
  where m.id = i.id and m.status in ('pending', 'ready');
end;
$$;

-- Hold a queued match back until a time (or clear the hold with null).
create or replace function public.hold_match(p_match_id uuid, p_not_before timestamptz)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
begin
  perform public.assert_admin();
  update public.matches set not_before = p_not_before
  where id = p_match_id and status in ('pending', 'ready') returning * into m;
  if m.id is null then raise exception 'Only a match still in the queue can be moved'; end if;
  return m;
end;
$$;

-- Fixtures replacement also carries each match's stations.
create or replace function public.replace_bracket(p_tournament_game_id uuid, p_matches jsonb, p_stage text default null, p_groups jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament_id uuid;
begin
  perform public.assert_admin();
  if p_stage is not null and p_stage <> 'knockout' then
    raise exception 'Only the knockout stage can be replaced on its own';
  end if;

  select tournament_id into v_tournament_id
  from public.tournament_games where id = p_tournament_game_id for update;
  if v_tournament_id is null then
    raise exception 'Tournament game not found';
  end if;

  if exists (
    select 1 from public.matches
    where tournament_game_id = p_tournament_game_id
      and (p_stage is null or stage = p_stage)
      and (status in ('called', 'live') or (status = 'completed' and not is_bye))
  ) then
    raise exception 'Fixtures cannot be regenerated after a match has started';
  end if;

  delete from public.matches
  where tournament_game_id = p_tournament_game_id and (p_stage is null or stage = p_stage);

  insert into public.matches (
    id, tournament_id, tournament_game_id, stage, group_no, round, position, team_a_id, team_b_id,
    next_match_id, next_slot, status, is_bye, winner_id, station, stations,
    scheduled_start, scheduled_end, ended_at
  )
  select
    m.id, v_tournament_id, p_tournament_game_id, coalesce(m.stage, 'knockout'), m.group_no, m.round, m.position,
    m.team_a_id, m.team_b_id, m.next_match_id, m.next_slot, m.status, m.is_bye, m.winner_id, m.station,
    coalesce(m.stations, case when m.station is not null then array[m.station] end),
    m.scheduled_start, m.scheduled_end, case when m.is_bye then now() end
  from jsonb_to_recordset(p_matches) as m(
    id uuid, stage text, group_no int, round int, position int, team_a_id uuid, team_b_id uuid,
    next_match_id uuid, next_slot text, status text, is_bye boolean, winner_id uuid,
    station int, stations int[], scheduled_start timestamptz, scheduled_end timestamptz
  );

  if p_stage is null then
    update public.teams t
    set group_no = (select (g->>'group_no')::int from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) g where (g->>'team_id')::uuid = t.id)
    where t.tournament_game_id = p_tournament_game_id;

    update public.tournament_games
    set status = 'fixtures_ready', champion_team_id = null
    where id = p_tournament_game_id;

    update public.tournaments set status = 'scheduled'
    where id = v_tournament_id and status = 'draft';
  end if;
end;
$$;

revoke execute on function public.list_admins() from public, anon;
revoke execute on function public.call_match(uuid, int) from public, anon;
revoke execute on function public.uncall_match(uuid, int) from public, anon;
revoke execute on function public.hold_match(uuid, timestamptz) from public, anon;
grant execute on function public.list_admins() to authenticated;
grant execute on function public.call_match(uuid, int) to authenticated;
grant execute on function public.uncall_match(uuid, int) to authenticated;
grant execute on function public.hold_match(uuid, timestamptz) to authenticated;
