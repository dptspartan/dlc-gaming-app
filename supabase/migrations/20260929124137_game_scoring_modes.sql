-- How a game is scored:
--   none:   no live score, the admin just picks the winner.
--   goals:  both sides tally points live (FIFA goals); ending the match picks
--           the side with more points.
--   rounds: best-of-N rounds (Tekken, Call of Duty); the match ends by itself
--           as soon as one side has won a majority of best_of rounds.
alter table public.games
  add column scoring text not null default 'none' check (scoring in ('none', 'goals', 'rounds')),
  add column best_of int check (best_of between 1 and 99 and best_of % 2 = 1);
alter table public.games
  add constraint games_best_of_rounds check ((scoring = 'rounds') = (best_of is not null));

create or replace function public.match_scoring(p_tournament_game_id uuid, out scoring text, out best_of int)
language sql
stable
set search_path = ''
as $$
  select g.scoring, g.best_of
  from public.tournament_games tg join public.games g on g.id = tg.game_id
  where tg.id = p_tournament_game_id;
$$;

-- Marks a match completed and moves the winner on. Callers check permissions.
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

create or replace function public.start_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  s record;
begin
  perform public.assert_admin();
  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status <> 'ready' then
    raise exception 'Match can only start when both teams are set and it has not started (status: %)', m.status;
  end if;
  select * into s from public.match_scoring(m.tournament_game_id);

  update public.matches
  set status = 'live', started_at = now(), ended_at = null,
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

-- Add (or with a negative delta, take back) a goal or round for one side of a
-- live match. In a best-of game the match ends as soon as a side has a majority.
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
  if m.status = 'ready' then
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

-- End a match. Scored games pick the winner from the score (p_winner_id is
-- ignored); games without live scoring need p_winner_id.
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
  if m.status not in ('live', 'ready') then
    raise exception 'Only a live or ready match can be ended (status: %)', m.status;
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

-- Undo a result while the next match has not started. A best-of match goes
-- back to live with the deciding round taken off; a goals match keeps its score.
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

revoke execute on function public.finish_match(uuid, uuid, int, int) from public, anon, authenticated;
revoke execute on function public.match_scoring(uuid) from public, anon;
revoke execute on function public.score_point(uuid, text, int) from public, anon;
revoke execute on function public.end_match(uuid, uuid, int, int) from public, anon;
grant execute on function public.score_point(uuid, text, int) to authenticated;

-- The games this event runs, ready to pick when creating a tournament.
insert into public.games (name, team_size, default_match_minutes, scoring, best_of)
select v.name, v.team_size, v.minutes, v.scoring, v.best_of
from (values
  ('EA FC 26', 1, 15, 'goals', null::int),
  ('Tekken 8', 1, 15, 'rounds', 5),
  ('Call of Duty', 4, 30, 'rounds', 5)
) as v(name, team_size, minutes, scoring, best_of)
where not exists (select 1 from public.games g where lower(g.name) = lower(v.name));

update public.games set scoring = 'goals' where name = 'EA FC 26' and scoring = 'none';
update public.games set scoring = 'rounds', best_of = 5 where name = 'Tekken 8' and scoring = 'none';
update public.games set scoring = 'rounds', best_of = 5 where name = 'Call of Duty' and scoring = 'none';
