import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
// Called every minute by pg_cron. Protected by a shared secret (deploy with --no-verify-jwt).
Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 403 })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
  const { data: due, error } = await sb.rpc('due_reminders'); if (error) return new Response(error.message, { status: 500 })
  let sent = 0
  for (const r of due ?? []) {
    // Claim first: the primary key makes concurrent/repeated runs skip already-claimed reminders (no duplicates).
    const { error: claim } = await sb.from('reminder_log').insert({ task_id: r.task_id, offset_min: r.offset_min, due_at: r.due_at }); if (claim) continue
    const { data: subs } = await sb.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', r.user_id)
    const body = r.offset_min ? `Due in ${r.offset_min >= 60 && r.offset_min % 60 === 0 ? r.offset_min / 60 + ' h' : r.offset_min + ' min'}` : 'Due now'
    for (const s of subs ?? []) {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: r.title, body, tag: `${r.task_id}-${r.offset_min}` }), { TTL: 3600 }); sent++ }
      catch (e: any) { if (e.statusCode === 404 || e.statusCode === 410) await sb.from('push_subscriptions').delete().eq('id', s.id) } // expired subscription
    }
  }
  return new Response(JSON.stringify({ due: due?.length ?? 0, sent }))
})
