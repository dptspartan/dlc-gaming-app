-- Every stage of a game can be a best-of series, and a final can play each
-- leg on a different game with that game's own scoring. A match is a series
-- of legs (a single game is a series of one): score_a / score_b hold the leg
-- being played, legs keeps the finished ones, series_a / series_b count them.

alter table public.tournament_games
  add column plan jsonb not null default '{}'::jsonb;

alter table public.matches
  add column best_of int not null default 1 check (best_of between 1 and 9 and best_of % 2 = 1),
  add column leg_games uuid[],
  add column legs jsonb not null default '[]'::jsonb,
  add column series_a int not null default 0,
  add column series_b int not null default 0;

-- Completed single games become a series of one.
update public.matches m
set legs = jsonb_build_array(jsonb_build_object('game_id', g.game_id, 'winner_id', m.winner_id, 'score_a', m.score_a, 'score_b', m.score_b)),
    series_a = case when m.winner_id = m.team_a_id then 1 else 0 end,
    series_b = case when m.winner_id = m.team_b_id then 1 else 0 end
from public.tournament_games g
where g.id = m.tournament_game_id and m.status = 'completed' and not m.is_bye and m.winner_id is not null;

-- The game and scoring of the leg being played.
create or replace function public.leg_scoring(p_match public.matches, out game_id uuid, out scoring text, out best_of int)
language sql
stable
set search_path = ''
as $$
  select g.id, g.scoring, g.best_of
  from public.games g
  where g.id = coalesce(
    p_match.leg_games[jsonb_array_length(p_match.legs) + 1],
    (select tg.game_id from public.tournament_games tg where tg.id = p_match.tournament_game_id)
  );
$$;

-- Record a finished leg; the series ends once a side has won most legs.
create or replace function public.finish_leg(p_match_id uuid, p_winner_id uuid, p_score_a int, p_score_b int)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  s record;
  need int;
begin
  select * into m from public.matches where id = p_match_id for update;
  select * into s from public.leg_scoring(m);
  update public.matches
  set legs = legs || jsonb_build_object('game_id', s.game_id, 'winner_id', p_winner_id, 'score_a', p_score_a, 'score_b', p_score_b),
      series_a = series_a + case when p_winner_id = team_a_id then 1 else 0 end,
      series_b = series_b + case when p_winner_id = team_b_id then 1 else 0 end
  where id = p_match_id returning * into m;

  need := m.best_of / 2 + 1;
  if m.series_a >= need or m.series_b >= need then
    -- A single game keeps its own score; a series shows legs won.
    if m.best_of = 1 then
      return public.finish_match(p_match_id, p_winner_id, p_score_a, p_score_b);
    end if;
    return public.finish_match(p_match_id, p_winner_id, m.series_a, m.series_b);
  end if;

  -- Next leg, scored the way its game is.
  select * into s from public.leg_scoring(m);
  update public.matches
  set score_a = case when s.scoring = 'none' then null else 0 end,
      score_b = case when s.scoring = 'none' then null else 0 end
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
  select * into s from public.leg_scoring(m);
  select match_minutes into minutes from public.tournament_games where id = m.tournament_game_id;

  update public.matches
  set status = 'live', started_at = now(), ended_at = null, not_before = null,
      stations = coalesce(stations, case when station is not null then array[station] end),
      scheduled_start = now(), scheduled_end = now() + make_interval(mins => minutes * best_of),
      legs = '[]'::jsonb, series_a = 0, series_b = 0,
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

-- A point in the current leg. A rounds leg ends by itself on its deciding round.
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
  if m.status in ('ready', 'called') then
    m := public.start_match(p_match_id);
  elsif m.status <> 'live' then
    raise exception 'Only a live match can be scored (status: %)', m.status;
  end if;
  select * into s from public.leg_scoring(m);
  if s.scoring = 'none' then raise exception 'This game has live scoring turned off; pick the winner instead'; end if;

  a := coalesce(m.score_a, 0) + case when p_side = 'a' then p_delta else 0 end;
  b := coalesce(m.score_b, 0) + case when p_side = 'b' then p_delta else 0 end;
  if a < 0 or b < 0 then raise exception 'Score cannot go below zero'; end if;

  if s.scoring = 'rounds' then
    need := s.best_of / 2 + 1;
    if a >= need then return public.finish_leg(p_match_id, m.team_a_id, a, b); end if;
    if b >= need then return public.finish_leg(p_match_id, m.team_b_id, a, b); end if;
  end if;

  update public.matches set score_a = a, score_b = b where id = p_match_id returning * into m;
  return m;
end;
$$;

-- End the current leg (the whole match when it is a single game). Scored
-- legs pick the winner from the score; winner-only legs need p_winner_id.
-- p_walkover hands the whole series to p_winner_id (a no-show).
drop function if exists public.end_match(uuid, uuid, int, int);
create or replace function public.end_match(
  p_match_id uuid, p_winner_id uuid default null, p_score_a int default null, p_score_b int default null, p_walkover boolean default false
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
  need int;
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

  if p_walkover then
    if p_winner_id is null or p_winner_id not in (m.team_a_id, m.team_b_id) then
      raise exception 'Winner must be one of the two teams in the match';
    end if;
    need := m.best_of / 2 + 1;
    return public.finish_match(
      p_match_id, p_winner_id,
      case when p_winner_id = m.team_a_id then need else m.series_a end,
      case when p_winner_id = m.team_b_id then need else m.series_b end
    );
  end if;

  if m.status <> 'live' then
    m := public.start_match(p_match_id);
  end if;
  select * into s from public.leg_scoring(m);

  if s.scoring = 'none' then
    if p_winner_id is null or p_winner_id not in (m.team_a_id, m.team_b_id) then
      raise exception 'Winner must be one of the two teams in the match';
    end if;
    return public.finish_leg(p_match_id, p_winner_id, null, null);
  end if;

  a := coalesce(p_score_a, m.score_a, 0);
  b := coalesce(p_score_b, m.score_b, 0);
  if a = b then
    raise exception 'The score is level at %-%. Add the deciding point before ending', a, b;
  end if;
  return public.finish_leg(p_match_id, case when a > b then m.team_a_id else m.team_b_id end, a, b);
end;
$$;

-- Undo the last leg. When that leg had finished the match, the result is
-- undone too (while the next match has not started).
create or replace function public.reopen_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  n public.matches;
  v_last jsonb;
  s record;
begin
  perform public.assert_admin();
  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.is_bye or m.status not in ('completed', 'live') or (m.status = 'live' and jsonb_array_length(m.legs) = 0) then
    raise exception 'Nothing to undo in this match';
  end if;

  if m.status = 'completed' then
    if m.stage = 'group' then
      if exists (
        select 1 from public.matches
        where tournament_game_id = m.tournament_game_id and stage = 'knockout'
          and (status in ('called', 'live') or (status = 'completed' and not is_bye))
      ) then
        raise exception 'The knockout has started, so group results are locked';
      end if;
    elsif m.next_match_id is not null then
      select * into n from public.matches where id = m.next_match_id for update;
      if n.status in ('called', 'live', 'completed') then
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
  end if;

  if m.status = 'completed' and greatest(m.series_a, m.series_b) < m.best_of / 2 + 1 then
    -- A walkover: back to a live series as it stood, in a fresh leg.
    select * into s from public.leg_scoring(m);
    update public.matches
    set status = 'live', winner_id = null, ended_at = null,
        score_a = case when s.scoring = 'none' then null else 0 end,
        score_b = case when s.scoring = 'none' then null else 0 end
    where id = p_match_id returning * into m;
    return m;
  end if;

  v_last := m.legs -> -1;
  update public.matches
  set status = 'live', winner_id = null, ended_at = null,
      legs = legs - (jsonb_array_length(legs) - 1),
      series_a = greatest(series_a - case when (v_last ->> 'winner_id')::uuid = team_a_id then 1 else 0 end, 0),
      series_b = greatest(series_b - case when (v_last ->> 'winner_id')::uuid = team_b_id then 1 else 0 end, 0)
  where id = p_match_id returning * into m;

  -- Back into the leg: a rounds leg loses its deciding round, a goals leg keeps its score.
  select * into s from public.leg_scoring(m);
  update public.matches
  set score_a = case s.scoring
        when 'none' then null
        when 'rounds' then greatest(coalesce((v_last ->> 'score_a')::int, 0) - case when (v_last ->> 'winner_id')::uuid = team_a_id then 1 else 0 end, 0)
        else (v_last ->> 'score_a')::int end,
      score_b = case s.scoring
        when 'none' then null
        when 'rounds' then greatest(coalesce((v_last ->> 'score_b')::int, 0) - case when (v_last ->> 'winner_id')::uuid = team_b_id then 1 else 0 end, 0)
        else (v_last ->> 'score_b')::int end
  where id = p_match_id returning * into m;
  return m;
end;
$$;

-- Apply a game's plan to matches that have not started.
create or replace function public.set_series(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  update public.matches m
  set best_of = i.best_of, leg_games = i.leg_games
  from jsonb_to_recordset(p_items) as i(id uuid, best_of int, leg_games uuid[])
  where m.id = i.id and m.status in ('pending', 'ready', 'called');
end;
$$;

-- Fixtures replacement also carries each match's series.
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
    scheduled_start, scheduled_end, ended_at, best_of, leg_games
  )
  select
    m.id, v_tournament_id, p_tournament_game_id, coalesce(m.stage, 'knockout'), m.group_no, m.round, m.position,
    m.team_a_id, m.team_b_id, m.next_match_id, m.next_slot, m.status, m.is_bye, m.winner_id, m.station,
    coalesce(m.stations, case when m.station is not null then array[m.station] end),
    m.scheduled_start, m.scheduled_end, case when m.is_bye then now() end,
    coalesce(m.best_of, 1), m.leg_games
  from jsonb_to_recordset(p_matches) as m(
    id uuid, stage text, group_no int, round int, position int, team_a_id uuid, team_b_id uuid,
    next_match_id uuid, next_slot text, status text, is_bye boolean, winner_id uuid,
    station int, stations int[], scheduled_start timestamptz, scheduled_end timestamptz,
    best_of int, leg_games uuid[]
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

revoke execute on function public.leg_scoring(public.matches) from public, anon;
revoke execute on function public.finish_leg(uuid, uuid, int, int) from public, anon, authenticated;
revoke execute on function public.end_match(uuid, uuid, int, int, boolean) from public, anon;
revoke execute on function public.set_series(jsonb) from public, anon;
grant execute on function public.end_match(uuid, uuid, int, int, boolean) to authenticated;
grant execute on function public.set_series(jsonb) to authenticated;
