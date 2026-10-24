-- Lease-based claim: a reminder is only "consumed" once a push really succeeded.
alter table public.reminder_log alter column sent_at drop not null, alter column sent_at drop default;
alter table public.reminder_log add column if not exists claimed_at timestamptz not null default now();

-- Due = in window, not completed, not already sent, and not currently leased by a running invocation (2 min lease).
create or replace function public.due_reminders() returns table(task_id uuid,user_id uuid,title text,due_at timestamptz,offset_min int) language sql security definer set search_path=public as $$
 select t.id,t.user_id,t.title,t.due_at,o from tasks t cross join lateral unnest(t.reminders) o
 where t.status<>'completed' and t.due_at is not null
 and t.due_at-make_interval(mins=>o)<=now() and t.due_at-make_interval(mins=>o)>now()-interval '30 minutes'
 and not exists(select 1 from reminder_log l where l.task_id=t.id and l.offset_min=o and l.due_at=t.due_at
   and (l.sent_at is not null or l.claimed_at>now()-interval '2 minutes')) $$;

-- Atomic claim: true only for the one caller that inserts the row or takes over an expired/released, unsent lease.
create function public.claim_reminder(p_task uuid,p_offset int,p_due timestamptz) returns boolean language plpgsql security definer set search_path=public as $$
declare n int;
begin
 insert into reminder_log(task_id,offset_min,due_at,claimed_at,sent_at) values(p_task,p_offset,p_due,now(),null)
 on conflict(task_id,offset_min,due_at) do update set claimed_at=now()
  where reminder_log.sent_at is null and reminder_log.claimed_at<now()-interval '2 minutes';
 get diagnostics n=row_count; return n>0;
end $$;

-- p_sent=true marks it delivered; false releases the lease so the next cron run retries.
create function public.finish_reminder(p_task uuid,p_offset int,p_due timestamptz,p_sent boolean) returns void language sql security definer set search_path=public as $$
 update reminder_log set sent_at=case when p_sent then now() end, claimed_at=case when p_sent then claimed_at else 'epoch'::timestamptz end
 where task_id=p_task and offset_min=p_offset and due_at=p_due and sent_at is null $$;

revoke execute on function public.due_reminders,public.claim_reminder,public.finish_reminder from public,anon,authenticated;
grant execute on function public.due_reminders,public.claim_reminder,public.finish_reminder to service_role;
