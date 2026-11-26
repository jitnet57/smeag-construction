-- Server-side crew scope: a team leader can only read (and write) the
-- employees of their own crew, and employee data needs a login.
-- Requires 20261126_attendance_checkin_guard.sql (_app_request_account).
--
-- Rules, for requests through the API (anon / authenticated roles):
--   * employee data (employees, attendance, skills, task assignments) needs a
--     valid x-app-token login; without one nothing is returned
--   * team leaders only see / write rows of employees in their own crew
--   * only admins / managers may create, edit or delete employees
--   * deductions and payroll overrides are admin / manager only
-- Direct database sessions (SQL editor, service role) are not restricted.

-- True when the current request's account may see this employee.
create or replace function public._app_sees_employee(p_employee_id text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare me app_accounts;
begin
  me := _app_request_account();
  if me.username is null then return false; end if;
  if me.role <> 'team_leader' then return true; end if;
  return exists (
    select 1 from employees e
    where e.id = p_employee_id
      and upper(e.crew_id) = upper(coalesce(me.crew_id, '')));
end $$;
revoke all on function public._app_sees_employee(text) from public;
grant execute on function public._app_sees_employee(text) to anon, authenticated;

-- Crew the current request is limited to ('' = no limit, null = no login).
create or replace function public._app_request_crew_scope()
returns text language sql stable security definer set search_path = public
as $$
  select case
    when a.username is null then null
    when a.role = 'team_leader' then upper(coalesce(a.crew_id, ''))
    else '' end
  from (select (public._app_request_account()).*) a
$$;
grant execute on function public._app_request_crew_scope() to anon, authenticated;

-- employees ------------------------------------------------------------------
drop policy if exists anon_all on public.employees;
drop policy if exists employees_read on public.employees;
drop policy if exists employees_write on public.employees;
create policy employees_read on public.employees
  for select to anon, authenticated
  using (public._app_request_crew_scope() = ''
         or upper(crew_id) = public._app_request_crew_scope());
create policy employees_write on public.employees
  for all to anon, authenticated
  using (public._app_request_role() in ('admin', 'manager'))
  with check (public._app_request_role() in ('admin', 'manager'));

-- attendance (write rules stay in the check-in guard trigger) ---------------
drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance
  for select to anon, authenticated using (public._app_sees_employee(employee_id));

-- employee_skills / task_assignments -----------------------------------------
drop policy if exists anon_all on public.employee_skills;
drop policy if exists employee_skills_crew on public.employee_skills;
create policy employee_skills_crew on public.employee_skills
  for all to anon, authenticated
  using (public._app_sees_employee(employee_id))
  with check (public._app_sees_employee(employee_id));

drop policy if exists anon_all on public.task_assignments;
drop policy if exists task_assignments_crew on public.task_assignments;
create policy task_assignments_crew on public.task_assignments
  for all to anon, authenticated
  using (public._app_sees_employee(employee_id))
  with check (public._app_sees_employee(employee_id));

-- payroll data: admin / manager only -----------------------------------------
drop policy if exists anon_all on public.employee_deductions;
drop policy if exists employee_deductions_office on public.employee_deductions;
create policy employee_deductions_office on public.employee_deductions
  for all to anon, authenticated
  using (public._app_request_role() in ('admin', 'manager'))
  with check (public._app_request_role() in ('admin', 'manager'));

drop policy if exists anon_all on public.payroll_overrides;
drop policy if exists payroll_overrides_office on public.payroll_overrides;
create policy payroll_overrides_office on public.payroll_overrides
  for all to anon, authenticated
  using (public._app_request_role() in ('admin', 'manager'))
  with check (public._app_request_role() in ('admin', 'manager'));
