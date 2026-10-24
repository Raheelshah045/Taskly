// Delivery logic, separated from Deno/web-push so it can be unit-tested. No secrets are ever logged.
type Push = { endpoint: string; keys: { p256dh: string; auth: string } }
export type Deps = { sb: any; send: (sub: Push, payload: string) => Promise<unknown>; log?: (event: string, meta: Record<string, unknown>) => void }
const host = (u: string) => { try { return new URL(u).host } catch { return 'invalid-endpoint' } } // host only; the full endpoint URL is a capability
const when = (m: number) => m === 0 ? 'Due now' : `Due in ${m >= 60 && m % 60 === 0 ? m / 60 + ' h' : m + ' min'}`

export async function processDue({ sb, send, log = () => {} }: Deps) {
  const out = { due: 0, remindersCompleted: 0, remindersToRetry: 0, delivered: 0, failed: 0, expiredSubscriptionsRemoved: 0, skippedNoSubscription: 0, skippedAlreadyClaimed: 0, failures: [] as Record<string, unknown>[] }
  const { data, error } = await sb.rpc('due_reminders'); if (error) throw new Error('due_reminders failed: ' + error.message)
  for (const r of data ?? []) {
    out.due++
    const { data: subs, error: se } = await sb.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', r.user_id)
    if (se) { out.failed++; log('subscription_query_failed', { task: r.task_id, message: se.message }); continue }
    if (!subs?.length) { out.skippedNoSubscription++; continue } // nothing consumed: retried once the user subscribes
    const args = { p_task: r.task_id, p_offset: r.offset_min, p_due: r.due_at }
    const { data: claimed, error: ce } = await sb.rpc('claim_reminder', args)
    if (ce) { out.failed++; log('claim_failed', { task: r.task_id, message: ce.message }); continue }
    if (!claimed) { out.skippedAlreadyClaimed++; continue } // another invocation owns it
    let ok = 0
    const payload = JSON.stringify({ title: r.title, body: when(r.offset_min), tag: `${r.task_id}-${r.offset_min}` })
    for (const s of subs) {
      try { await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); ok++; out.delivered++ }
      catch (e: any) {
        const status = e?.statusCode
        if (status === 404 || status === 410) { // subscription is gone for good
          const { error: de } = await sb.from('push_subscriptions').delete().eq('id', s.id)
          if (de) log('subscription_delete_failed', { sub: s.id, message: de.message }); else out.expiredSubscriptionsRemoved++
        } else {
          out.failed++
          const f = { task: r.task_id, sub: s.id, host: host(s.endpoint), status, message: String(e?.message ?? e).slice(0, 200), body: String(e?.body ?? '').slice(0, 200) }
          log('push_failed', f); if (out.failures.length < 10) out.failures.push(f)
        }
      }
    }
    const { error: fe } = await sb.rpc('finish_reminder', { ...args, p_sent: ok > 0 })
    if (fe) log('finish_failed', { task: r.task_id, message: fe.message })
    ok > 0 ? out.remindersCompleted++ : out.remindersToRetry++
  }
  return out
}
