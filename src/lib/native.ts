import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { StatusBar, Style } from '@capacitor/status-bar'
import type { Task } from './db'
// Native Android reminders (Capacitor LocalNotifications -> AlarmManager). Only active inside the Android app.
// Source of truth is Dexie; the OS alarm set is reconciled against it, so edits/completion/deletion are always reflected.
export const isNative = Capacitor.isNativePlatform()
export const CHANNEL = 'reminders'
const MAX = 100, HORIZON = 30 * 864e5
const log = (m: string, meta?: unknown) => console.info('[taskly:native-reminders]', m, meta ?? '')
export type Planned = { id: number; title: string; body: string; at: Date }
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return ((h >>> 0) % 2147483646) + 1 }
const bodyFor = (m: number) => (m === 0 ? 'Due now' : `Due in ${m >= 60 && m % 60 === 0 ? m / 60 + ' h' : m + ' min'}`)

// Deterministic ids (task, offset, due time, title): rescheduling the same reminder can never create a duplicate alarm.
export function planReminders(tasks: Task[], now: number): Planned[] {
  const out: (Planned & { k: string })[] = []
  for (const t of tasks) {
    if (t.deleted || t.status === 'completed' || !t.due_at) continue
    for (const m of t.reminders ?? []) {
      const at = new Date(t.due_at).getTime() - m * 60000
      if (at <= now + 1000 || at > now + HORIZON) continue
      out.push({ id: 0, k: `${t.id}|${m}|${t.due_at}|${t.title}`, title: t.title, body: bodyFor(m), at: new Date(at) })
    }
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.k.localeCompare(b.k)); const used = new Set<number>()
  return out.slice(0, MAX).map(({ k, ...p }) => { let id = hash(k); while (used.has(id)) id = (id % 2147483646) + 1; used.add(id); return { ...p, id } })
}

type Plugin = Pick<typeof LocalNotifications, 'getPending' | 'cancel' | 'schedule'>
export async function reconcile(p: Plugin, plan: Planned[]) {
  const pending = (await p.getPending()).notifications, want = new Set(plan.map(x => x.id)), have = new Set(pending.map(n => n.id))
  const stale = pending.filter(n => !want.has(n.id)), add = plan.filter(x => !have.has(x.id))
  if (stale.length) await p.cancel({ notifications: stale.map(n => ({ id: n.id })) })
  if (add.length) await p.schedule({ notifications: add.map(x => ({ id: x.id, title: x.title, body: x.body, channelId: CHANNEL, schedule: { at: x.at, allowWhileIdle: true } })) })
  log('reconciled', { scheduled: add.length, cancelled: stale.length, kept: plan.length - add.length })
  return { scheduled: add.length, cancelled: stale.length }
}

let chain: Promise<unknown> = Promise.resolve() // serialize so overlapping triggers cannot interleave
export function syncNativeReminders(tasks: Task[]) {
  if (!isNative) return Promise.resolve()
  const run = chain.then(async () => {
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return log('skipped: notification permission not granted')
    await reconcile(LocalNotifications, planReminders(tasks, Date.now()))
  })
  chain = run.catch(() => {}); return run
}
const ensureChannel = () => LocalNotifications.createChannel({ id: CHANNEL, name: 'Task reminders', description: 'Reminders for your tasks', importance: 4, vibration: true, visibility: 1 })
export async function nativeState(): Promise<'on' | 'off' | 'denied' | 'inexact'> {
  const d = (await LocalNotifications.checkPermissions()).display
  if (d === 'denied') return 'denied'; if (d !== 'granted') return 'off'
  try { if ((await LocalNotifications.checkExactNotificationSetting()).exact_alarm !== 'granted') return 'inexact' } catch { /* pre-Android 12 */ }
  return 'on'
}
export async function enableNative() {
  let d = (await LocalNotifications.checkPermissions()).display
  if (d !== 'granted') d = (await LocalNotifications.requestPermissions()).display
  if (d !== 'granted') throw new Error('Notification permission was not granted. Enable it in Android Settings → Apps → Taskly → Notifications.')
  await ensureChannel()
  const e = await LocalNotifications.checkExactNotificationSetting().catch(() => null)
  if (e && e.exact_alarm !== 'granted') await LocalNotifications.changeExactNotificationSetting() // opens the system "Alarms & reminders" screen
}
export async function cancelAllNative() { const { notifications } = await LocalNotifications.getPending(); if (notifications.length) await LocalNotifications.cancel({ notifications }) }
export async function initNative() {
  if (!isNative) return
  try { const dark = matchMedia('(prefers-color-scheme: dark)').matches; await StatusBar.setOverlaysWebView({ overlay: false }); await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }); await StatusBar.setBackgroundColor({ color: dark ? '#0b1020' : '#eef3ff' }) } catch (e) { log('status bar setup failed', String(e)) }
  await ensureChannel().catch(e => log('channel setup failed', String(e)))
}
