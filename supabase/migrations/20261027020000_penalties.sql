-- A goals match that ends level is decided on penalties. The shoot-out score
-- is kept on the leg it decided and, for a single game, on the match, so the
-- result reads "1–1 (4–3 pens)". The winner moves on through finish_leg as
-- for any other result.

alter table public.matches
  add column pen_a int check (pen_a >= 0),
  add column pen_b int check (pen_b >= 0);

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

  select * into s from public.leg_scoring(m);
  if s.scoring <> 'goals' then
    raise exception 'Penalties only decide games scored in goals';
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

revoke execute on function public.end_on_penalties(uuid, int, int) from public, anon;
grant execute on function public.end_on_penalties(uuid, int, int) to authenticated;

-- Reopening a result takes its shoot-out back with it.
create or replace function public.clear_penalties()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'completed' and new.status <> 'completed' then
    new.pen_a := null;
    new.pen_b := null;
  end if;
  return new;
end;
$$;

create trigger matches_clear_penalties
  before update of status on public.matches
  for each row execute function public.clear_penalties();
