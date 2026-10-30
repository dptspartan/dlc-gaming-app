-- A short line an organiser can show on a match card (why a team is in it).
alter table public.matches
  add column note text check (note is null or char_length(note) <= 120);
