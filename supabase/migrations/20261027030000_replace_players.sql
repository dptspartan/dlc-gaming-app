-- Line-up changes after the fixtures are out: put another player into a
-- match that has not started, and take a player out of a game without
-- leaving a match with a missing side behind.

-- Ready when both sides are known, pending while one is still to come.
create or replace function public.refresh_ready(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.matches
  set status = case when team_a_id is not null and team_b_id is not null then 'ready' else 'pending' end
  where id = any (p_ids) and status in ('pending', 'ready') and not is_bye;
$$;

-- Put a player into one side of a match that has not started. Someone not in
-- the fixtures yet (a late sign-up) just takes the place; someone waiting for
-- their own first match swaps places with the player who was there.
create or replace function public.replace_player(p_match_id uuid, p_slot text, p_team_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  t public.teams;
  feeder public.matches;
  other public.matches;
  placed int;
  v_current uuid;
begin
  perform public.assert_admin();
  if p_slot not in ('a', 'b') then raise exception 'Slot must be a or b'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.is_bye then raise exception 'A bye has no opponent to replace'; end if;
  if m.status not in ('pending', 'ready', 'called') then
    raise exception 'Only a match that has not started can change players (status: %)', m.status;
  end if;
  select * into t from public.teams where id = p_team_id;
  if t.id is null then raise exception 'Player not found'; end if;
  if t.tournament_game_id <> m.tournament_game_id then raise exception '% plays a different game', t.name; end if;

  v_current := case when p_slot = 'a' then m.team_a_id else m.team_b_id end;
  if v_current = p_team_id then return m; end if;
  if p_team_id = (case when p_slot = 'a' then m.team_b_id else m.team_a_id end) then
    raise exception '% is already in this match', t.name;
  end if;

  -- A place an earlier match fills belongs to that match's result.
  select * into feeder from public.matches f
  where (f.next_match_id = m.id and f.next_slot = p_slot) or (f.loser_next_match_id = m.id and f.loser_next_slot = p_slot)
  limit 1;
  if feeder.id is not null then
    raise exception 'This place goes to a player from %. Change the players in that match instead', coalesce(feeder.match_code, 'an earlier match');
  end if;

  select count(*) into placed from public.matches
  where tournament_game_id = m.tournament_game_id and id <> m.id and p_team_id in (team_a_id, team_b_id);
  if placed > 0 then
    select * into other from public.matches
    where tournament_game_id = m.tournament_game_id and id <> m.id and p_team_id in (team_a_id, team_b_id)
    order by round, position limit 1 for update;
    if placed > 1 or other.is_bye or other.status not in ('pending', 'ready') then
      raise exception '% is already playing in %. Pick someone who is not in a match yet, or still waiting for their first one', t.name, coalesce(other.match_code, 'another match');
    end if;
    -- The player swapped out takes the other place, so it must be their only match too.
    if v_current is not null and exists (
      select 1 from public.matches where tournament_game_id = m.tournament_game_id and id <> m.id and v_current in (team_a_id, team_b_id, winner_id)
    ) then
      raise exception 'Both players play more than one match, so they cannot swap places here';
    end if;
    update public.matches
    set team_a_id = case when team_a_id = p_team_id then v_current else team_a_id end,
        team_b_id = case when team_b_id = p_team_id then v_current else team_b_id end,
        updated_at = now()
    where id = other.id;
  end if;

  if p_slot = 'a' then
    update public.matches set team_a_id = p_team_id, updated_at = now() where id = m.id;
  else
    update public.matches set team_b_id = p_team_id, updated_at = now() where id = m.id;
  end if;
  perform public.refresh_ready(array_remove(array[m.id, other.id], null));
  select * into m from public.matches where id = p_match_id;
  return m;
end;
$$;

-- Take a player out of a game. Their matches that have not started go to the
-- replacement, when there is one, or wait with an empty side. A player who has
-- played (or is being called or playing now) stays: that match needs a result.
create or replace function public.withdraw_player(p_team_id uuid, p_replacement_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.teams;
  r public.teams;
  busy public.matches;
  touched uuid[];
begin
  perform public.assert_admin();
  select * into t from public.teams where id = p_team_id for update;
  if t.id is null then raise exception 'Player not found'; end if;

  select * into busy from public.matches
  where tournament_game_id = t.tournament_game_id and not is_bye and status in ('called', 'live', 'completed')
    and p_team_id in (team_a_id, team_b_id)
  order by status = 'completed', round limit 1;
  if busy.id is not null then
    if busy.status = 'completed' then
      raise exception '% has already played %, so the result needs them. To drop them from here on, end their next match as a walkover', t.name, coalesce(busy.match_code, 'a match');
    end if;
    raise exception '% is % in % right now. Cancel the call or finish that match first', t.name, busy.status, coalesce(busy.match_code, 'a match');
  end if;

  if p_replacement_id is not null then
    select * into r from public.teams where id = p_replacement_id;
    if r.id is null then raise exception 'Replacement not found'; end if;
    if r.id = t.id then raise exception 'Pick someone else to take their place'; end if;
    if r.tournament_game_id <> t.tournament_game_id then raise exception '% plays a different game', r.name; end if;
    if exists (
      select 1 from public.matches
      where tournament_game_id = t.tournament_game_id and r.id in (team_a_id, team_b_id, winner_id)
    ) then
      raise exception '% is already in the fixtures. Pick someone who is not in a match yet', r.name;
    end if;
    update public.teams set group_no = t.group_no where id = r.id;
  elsif exists (
    select 1 from public.matches
    where tournament_game_id = t.tournament_game_id and is_bye and p_team_id in (team_a_id, team_b_id, winner_id)
  ) then
    raise exception '% has a bye into the next round. Pick someone to take their place', t.name;
  end if;

  -- Byes carry the player as the winner too; the replacement takes every place.
  with moved as (
    update public.matches
    set team_a_id = case when team_a_id = p_team_id then p_replacement_id else team_a_id end,
        team_b_id = case when team_b_id = p_team_id then p_replacement_id else team_b_id end,
        winner_id = case when winner_id = p_team_id then p_replacement_id else winner_id end,
        updated_at = now()
    where tournament_game_id = t.tournament_game_id and p_team_id in (team_a_id, team_b_id, winner_id)
    returning id
  )
  select coalesce(array_agg(id), '{}') into touched from moved;
  perform public.refresh_ready(touched);
  delete from public.teams where id = p_team_id;
end;
$$;

revoke execute on function public.refresh_ready(uuid[]) from public, anon, authenticated;
revoke execute on function public.replace_player(uuid, text, uuid) from public, anon;
grant execute on function public.replace_player(uuid, text, uuid) to authenticated;
revoke execute on function public.withdraw_player(uuid, uuid) from public, anon;
grant execute on function public.withdraw_player(uuid, uuid) to authenticated;
