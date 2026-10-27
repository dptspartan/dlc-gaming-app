-- Reschedule: an organizer gives a queued match a start time (same day or
-- another), and the timetable keeps it there and moves the other matches out
-- of its way. Days can also end early or run late (day_hours), so the
-- matches left at the end of a day play on tonight or move to tomorrow.

alter table public.matches
  add column time_locked boolean not null default false;

-- { "YYYY-MM-DD": { "start": "HH:MM", "end": "HH:MM" } }, either key optional.
alter table public.tournaments
  add column day_hours jsonb not null default '{}'::jsonb;

-- Give a queued match a set start time, or (null) put it back in the usual order.
create or replace function public.reschedule_match(p_match_id uuid, p_at timestamptz)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
begin
  perform public.assert_admin();
  update public.matches set not_before = p_at, time_locked = p_at is not null
  where id = p_match_id and status in ('pending', 'ready') and not is_bye returning * into m;
  if m.id is null then raise exception 'Only a match still in the queue can be rescheduled'; end if;
  return m;
end;
$$;

-- Holding a match back ("later +10 min") is a wait, not a set time.
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
  update public.matches set not_before = p_not_before, time_locked = false
  where id = p_match_id and status in ('pending', 'ready') returning * into m;
  if m.id is null then raise exception 'Only a match still in the queue can be moved'; end if;
  return m;
end;
$$;

-- A set time is done with once the match is called (a skip sends it back as a plain wait).
create or replace function public.clear_time_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status not in ('pending', 'ready') then new.time_locked := false; end if;
  return new;
end;
$$;

create trigger matches_clear_time_lock
  before update of status on public.matches
  for each row when (new.time_locked)
  execute function public.clear_time_lock();

revoke execute on function public.reschedule_match(uuid, timestamptz) from public, anon;
grant execute on function public.reschedule_match(uuid, timestamptz) to authenticated;
revoke execute on function public.clear_time_lock() from public, anon, authenticated;
