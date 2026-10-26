-- Uploaded sheets name later sides by the match they come from ("Winner of
-- FC-PI-03"). Keep each uploaded match's own code and where its sides come
-- from, and link them through next_match_id so finish_match moves winners on
-- exactly as it does in a generated bracket. Sheets can be uploaded in any
-- order: the links are rebuilt from the codes after every upload.

alter table public.matches
  add column match_code text,
  add column a_from text,
  add column b_from text;

create unique index matches_tg_code_key on public.matches (tournament_game_id, match_code)
  where match_code is not null;

create or replace function public.upload_day_fixtures(p_tournament_game_id uuid, p_matches jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament_id uuid;
  v_count int;
  v_code text;
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

  -- A generated bracket and uploaded sheets don't mix: the first upload replaces
  -- a generated bracket, as long as none of it has been played.
  if exists (
    select 1 from public.matches
    where tournament_game_id = p_tournament_game_id and round_code is null
      and (status in ('called', 'live') or (status = 'completed' and not is_bye))
  ) then
    raise exception 'This game''s generated bracket has started, so fixtures cannot be uploaded for it';
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
    raise exception 'Every fixture needs a round and a day';
  end if;

  -- The round and day pairs being uploaded: those fixtures are replaced.
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

  -- A match id may only be used once per game.
  select upper(e.j->>'match_code') into v_code
  from jsonb_array_elements(p_matches) e(j)
  where coalesce(e.j->>'match_code', '') <> ''
    and exists (select 1 from public.matches x where x.tournament_game_id = p_tournament_game_id and x.match_code = upper(e.j->>'match_code'))
  limit 1;
  if v_code is not null then
    raise exception 'Match % is already uploaded for another round or day', v_code;
  end if;

  insert into public.matches (
    tournament_id, tournament_game_id, stage, round, position, round_code, fixture_day, match_code, a_from, b_from,
    team_a_id, team_b_id, status, station, stations, station_locked, not_before, best_of, leg_games
  )
  select
    v_tournament_id, p_tournament_game_id, 'knockout',
    case f.round_code when 'PRE' then 1 when 'R32' then 2 when 'R16' then 3 when 'QF' then 4 when 'SF' then 5 else 6 end,
    coalesce((select max(x.position) + 1 from public.matches x
              where x.tournament_game_id = p_tournament_game_id and x.round_code = f.round_code), 0)
      + (row_number() over (partition by f.round_code order by f.ord)) - 1,
    f.round_code, f.fixture_day, f.match_code, f.a_from, f.b_from,
    f.team_a_id, f.team_b_id,
    case when f.team_a_id is not null and f.team_b_id is not null then 'ready' else 'pending' end,
    f.station, case when f.station is not null then array[f.station] end, f.station is not null,
    f.not_before, coalesce(f.best_of, 1), f.leg_games
  from (
    select
      e.ord,
      e.j->>'round_code' as round_code,
      (e.j->>'fixture_day')::date as fixture_day,
      nullif(upper(e.j->>'match_code'), '') as match_code,
      nullif(upper(e.j->>'a_from'), '') as a_from,
      nullif(upper(e.j->>'b_from'), '') as b_from,
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

  -- Each match's winner can only go to one place.
  select s.code into v_code
  from public.matches t
  cross join lateral (values (t.a_from), (t.b_from)) as s(code)
  where t.tournament_game_id = p_tournament_game_id and s.code is not null
  group by s.code having count(*) > 1
  limit 1;
  if v_code is not null then
    raise exception 'The winner of % is placed in two matches', v_code;
  end if;

  -- Every "Winner of …" must name a match of this game.
  select s.code into v_code
  from public.matches t
  cross join lateral (values (t.a_from), (t.b_from)) as s(code)
  where t.tournament_game_id = p_tournament_game_id and s.code is not null
    and not exists (select 1 from public.matches x where x.tournament_game_id = p_tournament_game_id and x.match_code = s.code)
  limit 1;
  if v_code is not null then
    raise exception 'There is no match % in this game yet. Upload it first, or in the same file', v_code;
  end if;

  -- Rebuild the links from the codes, then place winners of matches already played.
  update public.matches s set next_match_id = null, next_slot = null
  where s.tournament_game_id = p_tournament_game_id and s.round_code is not null;
  update public.matches s set next_match_id = t.id, next_slot = 'a'
  from public.matches t
  where t.tournament_game_id = p_tournament_game_id and s.tournament_game_id = p_tournament_game_id and t.a_from = s.match_code;
  update public.matches s set next_match_id = t.id, next_slot = 'b'
  from public.matches t
  where t.tournament_game_id = p_tournament_game_id and s.tournament_game_id = p_tournament_game_id and t.b_from = s.match_code;

  update public.matches t
  set team_a_id = coalesce(t.team_a_id, (select s.winner_id from public.matches s where s.tournament_game_id = p_tournament_game_id and s.match_code = t.a_from and s.status = 'completed')),
      team_b_id = coalesce(t.team_b_id, (select s.winner_id from public.matches s where s.tournament_game_id = p_tournament_game_id and s.match_code = t.b_from and s.status = 'completed'))
  where t.tournament_game_id = p_tournament_game_id and t.status = 'pending' and (t.a_from is not null or t.b_from is not null);
  update public.matches set status = 'ready'
  where tournament_game_id = p_tournament_game_id and status = 'pending'
    and team_a_id is not null and team_b_id is not null;

  update public.tournament_games set status = 'fixtures_ready'
  where id = p_tournament_game_id and status = 'setup';
  update public.tournaments set status = 'scheduled'
  where id = v_tournament_id and status = 'draft';

  return v_count;
end;
$$;
