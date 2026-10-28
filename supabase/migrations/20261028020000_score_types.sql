-- Score mode for any game, not only football. A game scored in 'goals' (shown
-- as "Score") now names its own unit (Goals, Kills, Points), can add more than
-- one point a tap (+5, +10), can end by itself at a target (first to 100
-- kills), can let the lower score win (times, strokes) and can turn penalties
-- off. Every new column defaults to how scoring worked before, so existing
-- games, live matches and results behave exactly as they did.

alter table public.games
  add column score_label text check (char_length(btrim(score_label)) between 1 and 24),
  add column score_steps int[] check (cardinality(score_steps) between 1 and 4 and 0 < all(score_steps) and 1000 > all(score_steps)),
  add column score_target int check (score_target between 1 and 100000),
  add column low_wins boolean not null default false,
  add column penalties boolean not null default true;
alter table public.games
  add constraint games_score_target_high check (score_target is null or (scoring = 'goals' and not low_wins));

-- The full scoring rules of the leg being played.
create or replace function public.leg_rules(
  p_match public.matches,
  out game_id uuid, out scoring text, out best_of int, out score_target int, out low_wins boolean, out penalties boolean
)
language sql
stable
set search_path = ''
as $$
  select g.id, g.scoring, g.best_of, g.score_target, g.low_wins, g.penalties
  from public.games g
  where g.id = coalesce(
    p_match.leg_games[jsonb_array_length(p_match.legs) + 1],
    (select tg.game_id from public.tournament_games tg where tg.id = p_match.tournament_game_id)
  );
$$;

-- Points in the current leg: any amount in a score game (+50 kills), one at a
-- time in a rounds game. A rounds leg ends on its deciding round, a score leg
-- with a target ends when a side reaches it.
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
  if p_delta is null or p_delta = 0 or abs(p_delta) > 9999 then
    raise exception 'Add between 1 and 9999 points at a time';
  end if;
  select * into m from public.matches where id = p_match_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status in ('ready', 'called') then
    m := public.start_match(p_match_id);
  elsif m.status <> 'live' then
    raise exception 'Only a live match can be scored (status: %)', m.status;
  end if;
  select * into s from public.leg_rules(m);
  if s.scoring = 'none' then raise exception 'This game has live scoring turned off; pick the winner instead'; end if;
  if s.scoring = 'rounds' and p_delta not in (-1, 1) then raise exception 'Rounds change one at a time'; end if;

  a := coalesce(m.score_a, 0) + case when p_side = 'a' then p_delta else 0 end;
  b := coalesce(m.score_b, 0) + case when p_side = 'b' then p_delta else 0 end;
  if a < 0 or b < 0 then raise exception 'Score cannot go below zero'; end if;

  if s.scoring = 'rounds' then
    need := s.best_of / 2 + 1;
    if a >= need then return public.finish_leg(p_match_id, m.team_a_id, a, b); end if;
    if b >= need then return public.finish_leg(p_match_id, m.team_b_id, a, b); end if;
  elsif s.score_target is not null and p_delta > 0 then
    if a >= s.score_target then return public.finish_leg(p_match_id, m.team_a_id, a, b); end if;
    if b >= s.score_target then return public.finish_leg(p_match_id, m.team_b_id, a, b); end if;
  end if;

  update public.matches set score_a = a, score_b = b where id = p_match_id returning * into m;
  return m;
end;
$$;

-- End the current leg (the whole match when it is a single game). Scored
-- legs pick the winner from the score, the lower one when the game says so;
-- winner-only legs need p_winner_id. p_walkover hands the whole series to
-- p_winner_id (a no-show).
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
  select * into s from public.leg_rules(m);

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
  return public.finish_leg(
    p_match_id,
    case when (a > b) <> coalesce(s.low_wins, false) then m.team_a_id else m.team_b_id end,
    a, b
  );
end;
$$;

-- Penalties settle a level score game unless the game turns them off.
create or replace function public.end_on_penalties(p_match_id uuid, p_pen_a int, p_pen_b int)
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
  v_winner uuid;
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
  if m.status <> 'live' then
    m := public.start_match(p_match_id);
  end if;

  select * into s from public.leg_rules(m);
  if s.scoring <> 'goals' or not coalesce(s.penalties, true) then
    raise exception 'Penalties are turned off for this game';
  end if;
  a := coalesce(m.score_a, 0);
  b := coalesce(m.score_b, 0);
  if a <> b then
    raise exception 'Penalties only decide a level match; it is %-%', a, b;
  end if;
  if p_pen_a is null or p_pen_b is null or p_pen_a < 0 or p_pen_b < 0 then
    raise exception 'Enter both sides'' penalties';
  end if;
  if p_pen_a = p_pen_b then
    raise exception 'A shoot-out needs a winner, so the penalties cannot be level';
  end if;

  v_winner := case when p_pen_a > p_pen_b then m.team_a_id else m.team_b_id end;
  m := public.finish_leg(p_match_id, v_winner, a, b);

  -- The shoot-out belongs to the leg just played, and to the match when that leg was the whole match.
  update public.matches
  set legs = jsonb_set(legs, array[(jsonb_array_length(legs) - 1)::text], (legs -> -1) || jsonb_build_object('pen_a', p_pen_a, 'pen_b', p_pen_b)),
      pen_a = case when status = 'completed' and best_of = 1 then p_pen_a end,
      pen_b = case when status = 'completed' and best_of = 1 then p_pen_b end
  where id = p_match_id
  returning * into m;
  return m;
end;
$$;

revoke execute on function public.leg_rules(public.matches) from public, anon;

-- FIFA keeps scoring goals, now named. Call of Duty moves from best-of rounds
-- to kills, but only while none of its matches is being played, so a match in
-- progress is never rescored under different rules.
update public.games set score_label = 'Goals'
where scoring = 'goals' and score_label is null and name ilike 'EA FC%';

update public.games g
set scoring = 'goals', best_of = null, score_label = 'Kills', score_steps = '{1,5,10}', penalties = false
where g.name ilike 'Call of Duty%' and g.scoring = 'rounds'
  and not exists (
    select 1
    from public.matches m join public.tournament_games tg on tg.id = m.tournament_game_id
    where m.status in ('called', 'live') and (tg.game_id = g.id or g.id = any(m.leg_games))
  );
