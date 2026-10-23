-- Reminders (minutes before due_at), push subscriptions, delivery log, signup name -> profile
alter table public.tasks add column if not exists reminders int[] not null default '{}' check(cardinality(reminders)<=5);
create table public.push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,endpoint text not null unique,p256dh text not null,auth text not null,created_at timestamptz not null default now());
create index on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
create policy own on public.push_subscriptions for select using(user_id=auth.uid());
create policy own_del on public.push_subscriptions for delete using(user_id=auth.uid());
create table public.reminder_log(task_id uuid not null references public.tasks on delete cascade,offset_min int not null,due_at timestamptz not null,sent_at timestamptz not null default now(),primary key(task_id,offset_min,due_at));
alter table public.reminder_log enable row level security; -- no policies: only the service role (edge function) can use it
-- Register/reassign this browser's subscription to the calling user (handles shared devices)
create function public.register_push(p_endpoint text,p_p256dh text,p_auth text) returns void language sql security definer set search_path=public as $$
 insert into push_subscriptions(user_id,endpoint,p256dh,auth) values(auth.uid(),p_endpoint,p_p256dh,p_auth)
 on conflict(endpoint) do update set user_id=auth.uid(),p256dh=excluded.p256dh,auth=excluded.auth $$;
create function public.unregister_push(p_endpoint text) returns void language sql security definer set search_path=public as $$
 delete from push_subscriptions where endpoint=p_endpoint and user_id=auth.uid() $$;
revoke execute on function public.register_push,public.unregister_push from public,anon;
grant execute on function public.register_push,public.unregister_push to authenticated;
-- Reminders that are due now (30-minute catch-up window), not yet sent
create function public.due_reminders() returns table(task_id uuid,user_id uuid,title text,due_at timestamptz,offset_min int) language sql security definer set search_path=public as $$
 select t.id,t.user_id,t.title,t.due_at,o from tasks t cross join lateral unnest(t.reminders) o
 where t.status<>'completed' and t.due_at is not null
 and t.due_at-make_interval(mins=>o)<=now() and t.due_at-make_interval(mins=>o)>now()-interval '30 minutes'
 and not exists(select 1 from reminder_log l where l.task_id=t.id and l.offset_min=o and l.due_at=t.due_at) $$;
revoke execute on function public.due_reminders from public,anon,authenticated;
grant execute on function public.due_reminders to service_role;
-- Save the signup name; backfill profiles for any existing users without one (keeps existing data)
create or replace function public.new_user() returns trigger language plpgsql security definer set search_path=public as $$
 begin insert into public.profiles(id,display_name) values(new.id,nullif(trim(new.raw_user_meta_data->>'full_name'),'')) on conflict do nothing;return new;end $$;
insert into public.profiles(id) select id from auth.users on conflict do nothing;
