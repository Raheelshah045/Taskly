
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { processDue } from './core.ts'

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { 'content-type': 'application/json' },
  })

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response('forbidden', { status: 403 })
  }

  const missing = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VAPID_SUBJECT',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
  ].filter((k) => !Deno.env.get(k))

  if (missing.length) {
    return json({ error: 'missing secrets: ' + missing.join(', ') }, 500)
  }

  try {
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT')!,
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    )
  } catch (e) {
    return json({
      error: 'invalid VAPID configuration: ' + (e as Error).message,
    }, 500)
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    return json(
      await processDue({
        sb,
        send: (sub, payload) =>
          webpush.sendNotification(sub, payload, {
            TTL: 3600,
            urgency: 'high',
          }),
        log: (event, meta) =>
          console.error(event, JSON.stringify(meta)),
      }),
    )
  } catch (e) {
    console.error('run_failed', (e as Error).message)
    return json({ error: (e as Error).message }, 500)
  }
})
