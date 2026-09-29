-- Admins are created by existing admins only; nobody can self-promote.
drop function if exists public.claim_first_admin();
