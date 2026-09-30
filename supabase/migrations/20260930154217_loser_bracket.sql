-- Double elimination: a knockout can have a loser bracket. A first loss in
-- the upper bracket drops the team into the loser bracket (stage 'losers');
-- a loss there knocks it out. The loser bracket winner meets the upper
-- bracket winner in the final. Turned on per game in its plan (double_elim).

alter table public.matches drop constraint matches_stage_check;
alter table public.matches
  add constraint matches_stage_check check (stage in ('group', 'knockout', 'losers')),
  add column loser_next_match_id uuid references public.matches(id) on delete set null deferrable initially deferred,
  add column loser_next_slot text check (loser_next_slot in ('a', 'b'));

-- Put a team into a slot. A loser-bracket bye (a match only one team can
-- ever reach) passes that team straight through.
create or replace function public.place_team(p_match_id uuid, p_slot text, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.matches;
begin
  update public.matches
  set team_a_id = case when p_slot = 'a' then p_team_id else team_a_id end,
      team_b_id = case when p_slot = 'b' then p_team_id else team_b_id end
  where id = p_match_id returning * into n;
  if n.is_bye and n.status = 'pending' then
    perform public.finish_match(n.id, p_team_id, null, null);
  elsif n.status = 'pending' and n.team_a_id is not null and n.team_b_id is not null then
    update public.matches set status = 'ready' where id = n.id;
  end if;
end;
$$;

-- Take a team back out of a slot (a result was undone), and out of any
-- loser-bracket bye it had already passed through.
create or replace function public.unplace_team(p_match_id uuid, p_slot text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.matches;
begin
  select * into n from public.matches where id = p_match_id for update;
  if n.is_bye and n.status = 'completed' then
    if n.next_match_id is not null then
      perform public.unplace_team(n.next_match_id, n.next_slot);
    end if;
    update public.matches
    set status = 'pending', winner_id = null, started_at = null, ended_at = null,
        team_a_id = case when p_slot = 'a' then null else team_a_id end,
        team_b_id = case when p_slot = 'b' then null else team_b_id end
    where id = n.id;
    return;
  end if;
  if n.status in ('called', 'live', 'completed') then
    raise exception 'The next match has already started, reopen that one first';
  end if;
  update public.matches
  set status = 'pending',
      team_a_id = case when p_slot = 'a' then null else team_a_id end,
      team_b_id = case when p_slot = 'b' then null else team_b_id end
  where id = n.id;
end;
$$;

-- Marks a match completed, moves the winner on and, in an upper bracket,
-- drops the loser into the loser bracket. Only the final crowns a champion.
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
  elsif m.stage = 'knockout' then
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

-- Undo the last leg. When that leg had finished the match, the result is
-- undone too (while the matches its teams went on to have not started).
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
      else
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

-- Fixtures replacement carries the loser links; replacing the knockout
-- replaces its loser bracket too.
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
      and (p_stage is null or stage <> 'group')
      and (status in ('called', 'live') or (status = 'completed' and not is_bye))
  ) then
    raise exception 'Fixtures cannot be regenerated after a match has started';
  end if;

  delete from public.matches
  where tournament_game_id = p_tournament_game_id and (p_stage is null or stage <> 'group');

  insert into public.matches (
    id, tournament_id, tournament_game_id, stage, group_no, round, position, team_a_id, team_b_id,
    next_match_id, next_slot, loser_next_match_id, loser_next_slot, status, is_bye, winner_id, station, stations,
    scheduled_start, scheduled_end, ended_at, best_of, leg_games
  )
  select
    m.id, v_tournament_id, p_tournament_game_id, coalesce(m.stage, 'knockout'), m.group_no, m.round, m.position,
    m.team_a_id, m.team_b_id, m.next_match_id, m.next_slot, m.loser_next_match_id, m.loser_next_slot,
    m.status, m.is_bye, m.winner_id, m.station,
    coalesce(m.stations, case when m.station is not null then array[m.station] end),
    m.scheduled_start, m.scheduled_end, case when m.is_bye and m.status = 'completed' then now() end,
    coalesce(m.best_of, 1), m.leg_games
  from jsonb_to_recordset(p_matches) as m(
    id uuid, stage text, group_no int, round int, position int, team_a_id uuid, team_b_id uuid,
    next_match_id uuid, next_slot text, loser_next_match_id uuid, loser_next_slot text,
    status text, is_bye boolean, winner_id uuid,
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

revoke execute on function public.place_team(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.unplace_team(uuid, text) from public, anon, authenticated;
