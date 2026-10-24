import 'fake-indexeddb/auto'
import { it, expect } from 'vitest'
import { dbFor, addTask, patchTask, removeTask } from './db'
import { fireDueReminders } from './reminders'
import { keyMatches } from './push'
const NOW = Date.parse('2030-01-01T10:00:00Z'), iso = (m: number) => new Date(NOW + m * 60000).toISOString()
const mk = (u: string, due: number, reminders: number[]) => { const db = dbFor(u); return addTask(db, { title: 'T', priority: 'low', due_at: iso(due), reminders }).then(() => db) }
const shown: string[] = []; const show = async (_t: string, b: string, tag: string) => { shown.push(tag + b); return true }
it('fires an offline-created reminder once, even across overlapping runs', async () => { shown.length = 0; const db = await mk('r1', 30, [30]); const [a, b] = await Promise.all([fireDueReminders(db, NOW, show), fireDueReminders(db, NOW, show)]); expect(a.length + b.length).toBe(1); expect(shown).toHaveLength(1); expect(await fireDueReminders(db, NOW + 5000, show)).toHaveLength(0) })
it('does not fire early, too late, or for completed/deleted tasks', async () => { const db = await mk('r2', 31, [30]); expect(await fireDueReminders(db, NOW, show)).toHaveLength(0)
  const old = await mk('r3', -120, [0]); expect(await fireDueReminders(old, NOW, show)).toHaveLength(0)
  const c = await mk('r4', 10, [10]); await patchTask(c, (await c.tasks.toArray())[0].id, { status: 'completed' }); expect(await fireDueReminders(c, NOW, show)).toHaveLength(0)
  const d = await mk('r5', 10, [10]); await removeTask(d, (await d.tasks.toArray())[0]); expect(await fireDueReminders(d, NOW, show)).toHaveLength(0) })
it('fires multiple offsets and survives a failing notifier', async () => { const db = await mk('r6', 5, [5, 0, 60]); const r = await fireDueReminders(db, NOW, async () => { throw new Error('x') }); expect(r.map(x => x.body)).toEqual(['Due in 5 min']) })
it('detects a changed VAPID key', () => { const a = new Uint8Array([1, 2, 3]); expect(keyMatches(a.buffer, new Uint8Array([1, 2, 3]))).toBe(true); expect(keyMatches(a.buffer, new Uint8Array([1, 2, 4]))).toBe(false); expect(keyMatches(null, a)).toBe(false) })
