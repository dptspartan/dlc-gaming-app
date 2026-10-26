-- Organizers can move a queued match earlier or later in the timetable
-- before the day. The timetable puts it at the new place on every rebuild:
-- among matches that could start at the same time, the smaller key goes first.
-- Null keeps the usual order (group stage, round, game, position).

alter table public.matches
  add column queue_key double precision;
