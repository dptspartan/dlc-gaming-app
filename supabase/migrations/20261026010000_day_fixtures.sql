-- Fixtures uploaded one day and one stage at a time (Preliminary, R32, R16,
-- QF, SF, Final) instead of a generated bracket. Uploaded matches have no
-- next match: the organiser uploads the following day's pairings themselves.

alter table public.matches
  add column round_code text check (round_code in ('PRE', 'R32', 'R16', 'QF', 'SF', 'F')),
  add column fixture_day date,
  add column station_locked boolean not null default false;

-- Only a real final crowns a champion. Before, any knockout match without a
-- next match did, which every uploaded fixture would be.
create or replace function public.finish_match(p_match_id uuid, p_winner_id uuid, p_score_a int, p_score_b int)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  v_loser uuid;
begin
  update public.matches
  set status = 'completed', winner_id = p_winner_id, score_a = p_score_a, score_b = p_score_b,
      started_at = coalesce(started_at, now()), ended_at = now()
  where id = p_match_id returning * into m;

  v_loser := case when p_winner_id = m.team_a_id then m.team_b_id when p_winner_id = m.team_b_id then m.team_a_id end;
  if m.loser_next_match_id is not null and v_loser is not null then
    perform public.place_team(m.loser_next_match_id, m.loser_next_slot, v_loser);
  end if;

  if m.next_match_id is not null then
    perform public.place_team(m.next_match_id, m.next_slot, p_winner_id);
  elsif m.stage = 'knockout' and (m.round_code is null or m.round_code = 'F') then
    update public.tournament_games set champion_team_id = p_winner_id, status = 'finished'
    where id = m.tournament_game_id;
    if not exists (
      select 1 from public.tournament_games
      where tournament_id = m.tournament_id and status <> 'finished'
    ) then
      update public.tournaments set status = 'finished' where id = m.tournament_id;
    end if;
  end if;
  select * into m from public.matches where id = p_match_id;
  return m;
end;
$$;

create or replace function public.reopen_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
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
        where tournament_game_id = m.tournament_game_id and stage <> 'group'
          and (status in ('called', 'live') or (status = 'completed' and not is_bye))
      ) then
        raise exception 'The knockout has started, so group results are locked';
      end if;
    else
      if m.next_match_id is not null then
        perform public.unplace_team(m.next_match_id, m.next_slot);
      elsif m.round_code is null or m.round_code = 'F' then
        update public.tournament_games set champion_team_id = null, status = 'live'
        where id = m.tournament_game_id;
        update public.tournaments set status = 'live'
        where id = m.tournament_id and status = 'finished';
      end if;
      if m.loser_next_match_id is not null then
        perform public.unplace_team(m.loser_next_match_id, m.loser_next_slot);
      end if;
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

-- Upload one day's fixtures for a game. Re-uploading a stage for the same day
-- replaces those fixtures while none of them has started, so a day can be
-- uploaded with TBD sides and again once the pairings are known.
create or replace function public.upload_day_fixtures(p_tournament_game_id uuid, p_matches jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament_id uuid;
  v_count int;
begin
  perform public.assert_admin();

  select tournament_id into v_tournament_id
  from public.tournament_games where id = p_tournament_game_id for update;
  if v_tournament_id is null then
    raise exception 'Tournament game not found';
  end if;
  if jsonb_typeof(p_matches) <> 'array' or jsonb_array_length(p_matches) = 0 then
    raise exception 'No fixtures to upload';
  end if;

  -- A generated bracket and uploaded days don't mix: the first upload replaces
  -- a generated bracket, as long as none of it has been played.
  if exists (
    select 1 from public.matches
    where tournament_game_id = p_tournament_game_id and round_code is null
      and (status in ('called', 'live') or (status = 'completed' and not is_bye))
  ) then
    raise exception 'This game''s generated bracket has started, so days cannot be uploaded for it';
  end if;
  delete from public.matches where tournament_game_id = p_tournament_game_id and round_code is null;

  if exists (
    select 1
    from jsonb_array_elements(p_matches) e(j)
    cross join lateral (values ((e.j->>'team_a_id')::uuid), ((e.j->>'team_b_id')::uuid)) as s(team_id)
    where s.team_id is not null
      and not exists (select 1 from public.teams t where t.id = s.team_id and t.tournament_game_id = p_tournament_game_id)
  ) then
    raise exception 'Every player or team must be entered in this game';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_matches) e(j)
    where coalesce(e.j->>'round_code', '') = '' or coalesce(e.j->>'fixture_day', '') = ''
  ) then
    raise exception 'Every fixture needs a stage and a day';
  end if;

  -- The stage and day pairs being uploaded: those fixtures are replaced.
  if exists (
    select 1 from public.matches x
    where x.tournament_game_id = p_tournament_game_id
      and x.status in ('called', 'live', 'completed')
      and (x.round_code, x.fixture_day) in (
        select e.j->>'round_code', (e.j->>'fixture_day')::date from jsonb_array_elements(p_matches) e(j)
      )
  ) then
    raise exception 'Some of these fixtures have already started, so that day cannot be replaced';
  end if;

  delete from public.matches x
  where x.tournament_game_id = p_tournament_game_id
    and (x.round_code, x.fixture_day) in (
      select e.j->>'round_code', (e.j->>'fixture_day')::date from jsonb_array_elements(p_matches) e(j)
    );

  insert into public.matches (
    tournament_id, tournament_game_id, stage, round, position, round_code, fixture_day,
    team_a_id, team_b_id, status, station, stations, station_locked, not_before, best_of, leg_games
  )
  select
    v_tournament_id, p_tournament_game_id, 'knockout',
    case f.round_code when 'PRE' then 1 when 'R32' then 2 when 'R16' then 3 when 'QF' then 4 when 'SF' then 5 else 6 end,
    coalesce((select max(x.position) + 1 from public.matches x
              where x.tournament_game_id = p_tournament_game_id and x.round_code = f.round_code), 0)
      + (row_number() over (partition by f.round_code order by f.ord)) - 1,
    f.round_code, f.fixture_day, f.team_a_id, f.team_b_id,
    case when f.team_a_id is not null and f.team_b_id is not null then 'ready' else 'pending' end,
    f.station, case when f.station is not null then array[f.station] end, f.station is not null,
    f.not_before, coalesce(f.best_of, 1), f.leg_games
  from (
    select
      e.ord,
      e.j->>'round_code' as round_code,
      (e.j->>'fixture_day')::date as fixture_day,
      (e.j->>'team_a_id')::uuid as team_a_id,
      (e.j->>'team_b_id')::uuid as team_b_id,
      (e.j->>'station')::int as station,
      (e.j->>'not_before')::timestamptz as not_before,
      (e.j->>'best_of')::int as best_of,
      case when jsonb_typeof(e.j->'leg_games') = 'array'
        then array(select jsonb_array_elements_text(e.j->'leg_games'))::uuid[] end as leg_games
    from jsonb_array_elements(p_matches) with ordinality as e(j, ord)
  ) f;
  get diagnostics v_count = row_count;

  update public.tournament_games set status = 'fixtures_ready'
  where id = p_tournament_game_id and status = 'setup';
  update public.tournaments set status = 'scheduled'
  where id = v_tournament_id and status = 'draft';

  return v_count;
end;
$$;

revoke execute on function public.upload_day_fixtures(uuid, jsonb) from public, anon;
grant execute on function public.upload_day_fixtures(uuid, jsonb) to authenticated;
