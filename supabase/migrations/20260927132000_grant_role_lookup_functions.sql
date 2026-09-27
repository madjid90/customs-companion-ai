-- Allow authenticated clients to evaluate admin-role RLS policies that call these
-- SECURITY DEFINER helper functions. Without these grants, admin login succeeds
-- but role/profile reads fail with permission denied for function has_role.
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.get_user_role(uuid) to authenticated;
grant execute on function public.has_role(uuid, public.app_role) to service_role;
grant execute on function public.get_user_role(uuid) to service_role;
