import { it, expect } from 'vitest'
import { processDue } from './core.ts'
function world() {
  const w: any = { now: 1e9, due: [{ task_id: 't1', user_id: 'u1', title: 'Call', due_at: '2030-01-01T10:00:00+00:00', offset_min: 30 }], subs: [{ id: 's1', user_id: 'u1', endpoint: 'https://push.example/x/secret-token', p256dh: 'p', auth: 'a' }], e: undefined as any }
  const L = 120000
  w.sb = { rpc: (n: string, a: any) => Promise.resolve({ error: null, data:
    n === 'due_reminders' ? (w.e && (w.e.sent || w.e.claimed > w.now - L) ? [] : w.due)
    : n === 'claim_reminder' ? (!w.e ? (w.e = { sent: false, claimed: w.now }, true) : !w.e.sent && w.e.claimed < w.now - L ? (w.e.claimed = w.now, true) : false)
    : (w.e && !w.e.sent && (a.p_sent ? (w.e.sent = true) : (w.e.claimed = -Infinity)), null) }),
    from: () => ({ select: () => ({ eq: (_: string, v: string) => Promise.resolve({ error: null, data: w.subs.filter((s: any) => s.user_id === v) }) }), delete: () => ({ eq: (_: string, v: string) => { w.subs = w.subs.filter((s: any) => s.id !== v); return Promise.resolve({ error: null }) } }) }) }
  return w
}
const run = (w: any, send: any, logs: any[] = []) => processDue({ sb: w.sb, send, log: (e: string, m: unknown) => logs.push([e, m]) })
it('no subscription: nothing consumed, retried later', async () => { const w = world(); w.subs = []; const r = await run(w, async () => {}); expect(r).toMatchObject({ due: 1, skippedNoSubscription: 1, delivered: 0 }); expect(w.e).toBeUndefined(); expect((await run(w, async () => {})).due).toBe(1) })
it('failed send releases the claim and retries; success then completes', async () => { const w = world(); const r1 = await run(w, async () => { throw { statusCode: 500, message: 'boom' } }); expect(r1).toMatchObject({ failed: 1, remindersToRetry: 1, remindersCompleted: 0 }); expect(w.e.sent).toBe(false)
  const r2 = await run(w, async () => {}); expect(r2).toMatchObject({ delivered: 1, remindersCompleted: 1 }); expect((await run(w, async () => {})).due).toBe(0) })
it('410 removes the subscription and the reminder is not consumed', async () => { const w = world(); const r = await run(w, async () => { throw { statusCode: 410 } }); expect(r).toMatchObject({ expiredSubscriptionsRemoved: 1, remindersToRetry: 1, failed: 0 }); expect(w.subs).toHaveLength(0); expect(w.e.sent).toBe(false) })
it('one good subscription is enough; the other failure is counted', async () => { const w = world(); w.subs.push({ ...w.subs[0], id: 's2' }); let n = 0; const r = await run(w, async () => { if (n++ === 0) throw { statusCode: 403 } }); expect(r).toMatchObject({ delivered: 1, failed: 1, remindersCompleted: 1 }); expect(w.e.sent).toBe(true) })
it('concurrent invocations send only once', async () => { const w = world(); let calls = 0; const send = async () => { calls++; await new Promise(r => setTimeout(r, 5)) }; const [a, b] = await Promise.all([run(w, send), run(w, send)]); expect(calls).toBe(1); expect(a.skippedAlreadyClaimed + b.skippedAlreadyClaimed).toBe(1) })
it('abandoned lease expires and can be retaken', async () => { const w = world(); await w.sb.rpc('claim_reminder', {}); expect((await run(w, async () => {})).due).toBe(0); w.now += 121000; expect((await run(w, async () => {})).delivered).toBe(1) })
it('logs never contain secrets or full endpoints', async () => { const w = world(); const logs: any[] = []; const r = await run(w, async () => { throw { statusCode: 403, message: 'rejected', body: 'BadJwtToken', headers: { authorization: 'Bearer SECRET' }, privateKey: 'PRIV' } }, logs); const s = JSON.stringify([logs, r]); expect(s).not.toMatch(/SECRET|PRIV|secret-token/); expect(s).toContain('push.example') })

