-- Per-game tournament format:
--   knockout: straight single elimination (random pairs unless seeded).
--   groups:   round-robin groups first; the top teams of each group (plus
--             optional wildcards, the best of the rest) go on to a knockout.
alter table public.tournament_games
  add column format text not null default 'knockout' check (format in ('knockout', 'groups')),
  add column group_count int not null default 2 check (group_count between 1 and 32),
  add column advance_per_group int not null default 2 check (advance_per_group between 1 and 16),
  add column wildcards int not null default 0 check (wildcards between 0 and 64);

alter table public.matches
  add column stage text not null default 'knockout' check (stage in ('group', 'knockout')),
  add column group_no int check (group_no >= 1),
  add constraint matches_group_stage check ((stage = 'group') = (group_no is not null));

alter table public.teams
  add column group_no int check (group_no >= 1);

-- Marks a match completed and moves the winner on. Only the knockout final
-- crowns a champion; group matches just count towards the tables.
create or replace function public.finish_match(p_match_id uuid, p_winner_id uuid, p_score_a int, p_score_b int)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  n public.matches;
begin
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
  return m;
end;
$$;

-- Undo a result while the next match has not started. A group result can be
-- undone until the knockout has started.
create or replace function public.reopen_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  n public.matches;
  s record;
begin
  perform public.assert_admin();
  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status <> 'completed' or m.is_bye then
    raise exception 'Only a played, completed match can be reopened';
  end if;
  select * into s from public.match_scoring(m.tournament_game_id);

  if m.stage = 'group' then
    if exists (
      select 1 from public.matches
      where tournament_game_id = m.tournament_game_id and stage = 'knockout'
        and (status = 'live' or (status = 'completed' and not is_bye))
    ) then
      raise exception 'The knockout has started, so group results are locked';
    end if;
  elsif m.next_match_id is not null then
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
  set status = 'live', winner_id = null, ended_at = null,
      score_a = case s.scoring
        when 'none' then null
        when 'rounds' then greatest(coalesce(score_a, 0) - case when winner_id = team_a_id then 1 else 0 end, 0)
        else score_a end,
      score_b = case s.scoring
        when 'none' then null
        when 'rounds' then greatest(coalesce(score_b, 0) - case when winner_id = team_b_id then 1 else 0 end, 0)
        else score_b end
  where id = p_match_id returning * into m;
  return m;
end;
$$;

-- Replace a game's fixtures with matches built by the client.
--   p_stage null:       replace everything (fresh fixtures); p_groups sets each
--                       team's group (null clears them for a straight knockout).
--   p_stage 'knockout': replace only the knockout, keeping the group stage;
--                       used to build the knockout from the group tables.
-- Refused once a match in the part being replaced has started.
drop function public.replace_bracket(uuid, jsonb);
create function public.replace_bracket(p_tournament_game_id uuid, p_matches jsonb, p_stage text default null, p_groups jsonb default null)
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
      and (status = 'live' or (status = 'completed' and not is_bye))
  ) then
    raise exception 'Fixtures cannot be regenerated after a match has started';
  end if;

  delete from public.matches
  where tournament_game_id = p_tournament_game_id and (p_stage is null or stage = p_stage);

  insert into public.matches (
    id, tournament_id, tournament_game_id, stage, group_no, round, position, team_a_id, team_b_id,
    next_match_id, next_slot, status, is_bye, winner_id, station,
    scheduled_start, scheduled_end, ended_at
  )
  select
    m.id, v_tournament_id, p_tournament_game_id, coalesce(m.stage, 'knockout'), m.group_no, m.round, m.position,
    m.team_a_id, m.team_b_id, m.next_match_id, m.next_slot, m.status, m.is_bye, m.winner_id, m.station,
    m.scheduled_start, m.scheduled_end, case when m.is_bye then now() end
  from jsonb_to_recordset(p_matches) as m(
    id uuid, stage text, group_no int, round int, position int, team_a_id uuid, team_b_id uuid,
    next_match_id uuid, next_slot text, status text, is_bye boolean, winner_id uuid,
    station int, scheduled_start timestamptz, scheduled_end timestamptz
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

revoke execute on function public.replace_bracket(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.replace_bracket(uuid, jsonb, text, jsonb) to authenticated;
