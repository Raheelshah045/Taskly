import type { LocalDB } from './db'
// Local (in-app) reminders. Runs only while Taskly is open/active; closed-app delivery is handled by remote Web Push.
export const CATCHUP_MS = 30 * 60 * 1000
export type Fired = { title: string; body: string }
const bodyFor = (m: number) => (m === 0 ? 'Due now' : `Due in ${m >= 60 && m % 60 === 0 ? m / 60 + ' h' : m + ' min'}`)

// Stateless: re-reads IndexedDB each call, so edits, completion, deletion, reloads and clock changes are always respected.
// Each (task, offset, due_at) is claimed with an atomic add() into the `fired` store, so overlapping timers or tabs cannot double-fire.
export async function fireDueReminders(db: LocalDB, now: number, show: (title: string, body: string, tag: string) => Promise<boolean>): Promise<Fired[]> {
  const out: Fired[] = []
  for (const t of await db.tasks.toArray()) {
    if (t.deleted || t.status === 'completed' || !t.due_at) continue
    const due = new Date(t.due_at).getTime()
    for (const m of t.reminders ?? []) {
      const at = due - m * 60000
      if (at > now || at < now - CATCHUP_MS) continue
      const key = `${t.id}|${m}|${t.due_at}`
      try { await db.fired.add({ key, at: now }) } catch { continue } // already fired
      const body = bodyFor(m)
      await show(t.title, body, `${t.id}-${m}`).catch(() => false)
      out.push({ title: t.title, body })
    }
  }
  await db.fired.where('at').below(now - 7 * 864e5).delete()
  return out
}

// Same tag as the server push payload, so a local and a remote notification for one reminder replace each other on the device.
export async function showLocalNotification(title: string, body: string, tag: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
  if (reg) await reg.showNotification(title, { body, tag, icon: '/icon-192.png', badge: '/icon-192.png' })
  else new Notification(title, { body, tag })
  return true
}
