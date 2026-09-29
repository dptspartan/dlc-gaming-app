-- assert_admin is only called from inside other security definer functions,
-- and anonymous visitors never need is_admin.
revoke execute on function public.assert_admin() from authenticated;
revoke execute on function public.is_admin() from public, anon;
