-- Organisers can stop the timetable moving queued matches later on its own
-- when matches run late. Off, every match keeps its planned time and station.

alter table public.tournaments
  add column auto_times boolean not null default true;
