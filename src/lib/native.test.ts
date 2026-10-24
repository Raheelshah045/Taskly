import 'fake-indexeddb/auto'
import { it, expect } from 'vitest'
import { dbFor, addTask, patchTask, removeTask, type Task } from './db'
import { planReminders, reconcile } from './native'
const NOW = Date.parse('2030-01-01T10:00:00Z'), iso = (m: number) => new Date(NOW + m * 60000).toISOString()
const fake = () => { const s = new Map<number, any>(); return { s, getPending: async () => ({ notifications: [...s.keys()].map(id => ({ id, title: s.get(id).title })) }), cancel: async ({ notifications }: any) => { notifications.forEach((n: any) => s.delete(n.id)) }, schedule: async ({ notifications }: any) => { notifications.forEach((n: any) => s.set(n.id, n)) } } as any }
const mk = async (u: string, due: number, reminders: number[], title = 'T') => { const db = dbFor(u); await addTask(db, { title, priority: 'low', due_at: iso(due), reminders }); return db }
const all = (db: ReturnType<typeof dbFor>) => db.tasks.toArray()
it('plans an offline-created task and is idempotent (no duplicate alarms)', async () => { const db = await mk('n1', 60, [30, 0]); const plan = planReminders(await all(db), NOW); expect(plan.map(p => p.at.getTime() - NOW)).toEqual([30 * 60000, 60 * 60000]); expect(new Set(plan.map(p => p.id)).size).toBe(2)
  const p = fake(); await reconcile(p, plan); const r = await reconcile(p, planReminders(await all(db), NOW)); expect(r).toEqual({ scheduled: 0, cancelled: 0 }); expect(p.s.size).toBe(2) })
it('skips past, completed, deleted and far-future reminders', async () => { const a = await mk('n2', -5, [0]); const b = await mk('n3', 10, [5]); await patchTask(b, (await all(b))[0].id, { status: 'completed' }); const c = await mk('n4', 10, [5]); await removeTask(c, (await all(c))[0]); const d = await mk('n5', 60 * 24 * 40, [0])
  for (const db of [a, b, c, d]) expect(planReminders(await all(db), NOW)).toHaveLength(0) })
it('completing, deleting or retitling cancels/replaces stale alarms', async () => { const db = await mk('n6', 60, [10]); const p = fake(); await reconcile(p, planReminders(await all(db), NOW)); const id = (await all(db))[0].id
  await patchTask(db, id, { title: 'New' }); const r1 = await reconcile(p, planReminders(await all(db), NOW)); expect(r1).toEqual({ scheduled: 1, cancelled: 1 }); expect([...p.s.values()][0].title).toBe('New')
  await patchTask(db, id, { status: 'completed' }); await reconcile(p, planReminders(await all(db), NOW)); expect(p.s.size).toBe(0) })
it('fired reminders are not rescheduled and the plan is capped', async () => { const db = dbFor('n7'); for (let i = 0; i < 120; i++) await addTask(db, { title: 'x' + i, priority: 'low', due_at: iso(100 + i), reminders: [0] }); const plan = planReminders(await all(db), NOW); expect(plan).toHaveLength(100); expect(new Set(plan.map(p => p.id)).size).toBe(100)
  expect(planReminders((await all(db)) as Task[], NOW + 101 * 60000).every(p => p.at.getTime() > NOW + 101 * 60000)).toBe(true) })
