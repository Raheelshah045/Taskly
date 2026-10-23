import Dexie, { type Table } from 'dexie'
export type Task = { id: string; title: string; priority: 'low'|'medium'|'high'|'urgent'; status: 'todo'|'in_progress'|'completed'; due_at: string|null; completed_at: string|null; created_at: string; updated_at: string; reminders: number[]; dirty: 0|1; deleted: 0|1; base: string|null }
class DB extends Dexie { tasks!: Table<Task, string>; constructor(uid: string) { super('taskly-' + uid); this.version(1).stores({ tasks: 'id,dirty,deleted' }) } }
const dbs: Record<string, DB> = {}
// One IndexedDB database per user id: accounts on a shared device never mix.
export const dbFor = (uid: string) => (dbs[uid] ??= new DB(uid))
export type LocalDB = ReturnType<typeof dbFor>

export const addTask = (db: LocalDB, t: { title: string; priority: Task['priority']; due_at: string|null; reminders?: number[] }) => { const n = new Date().toISOString(); return db.tasks.add({ id: crypto.randomUUID(), ...t, reminders: t.reminders ?? [], status: 'todo', completed_at: null, created_at: n, updated_at: n, dirty: 1, deleted: 0, base: null }) }
export const patchTask = (db: LocalDB, id: string, p: Partial<Task>) => db.tasks.update(id, { ...p, updated_at: new Date().toISOString(), dirty: 1 })
export const removeTask = async (db: LocalDB, t: Task) => (t.base ? db.tasks.update(t.id, { deleted: 1, dirty: 1 }) : db.tasks.delete(t.id)) // never synced -> nothing to delete remotely

let running = false
// Push dirty rows (client UUIDs + upsert = no duplicates), then pull and merge. Local unsynced edits always win and are never overwritten.
export async function sync(db: LocalDB, uid: string, sb: any): Promise<{ pushed: number; conflicts: number; error?: string }> {
  if (running) return { pushed: 0, conflicts: 0 }
  running = true; let pushed = 0, conflicts = 0
  try {
    const dirty = await db.tasks.where('dirty').equals(1).toArray()
    const live = dirty.filter(t => !t.deleted && t.base)
    if (live.length) {
      const { data, error } = await sb.from('tasks').select('id,updated_at').in('id', live.map(t => t.id)); if (error) throw error
      for (const r of data as { id: string; updated_at: string }[]) if (r.updated_at > live.find(t => t.id === r.id)!.base!) conflicts++ // remote changed elsewhere; local wins
    }
    for (const t of dirty) {
      if (t.deleted) { const { error } = await sb.from('tasks').delete().eq('id', t.id); if (error) throw error; await db.tasks.where('id').equals(t.id).and(x => !!x.deleted).delete() }
      else { const { error } = await sb.from('tasks').upsert({ id: t.id, user_id: uid, title: t.title, priority: t.priority, status: t.status, due_at: t.due_at, completed_at: t.completed_at, created_at: t.created_at, reminders: t.reminders ?? [] }, { onConflict: 'id' }); if (error) throw error
        await db.tasks.where('id').equals(t.id).and(x => x.updated_at === t.updated_at).modify({ dirty: 0 }) } // edits made mid-sync stay dirty
      pushed++
    }
    const { data, error } = await sb.from('tasks').select('id,title,priority,status,due_at,completed_at,created_at,updated_at,reminders').is('parent_id', null); if (error) throw error
    const ids = new Set((data as Task[]).map(r => r.id))
    await db.transaction('rw', db.tasks, async () => {
      for (const r of data as Task[]) { const l = await db.tasks.get(r.id)
        if (!l) await db.tasks.put({ ...r, reminders: r.reminders ?? [], dirty: 0, deleted: 0, base: r.updated_at })
        else if (l.dirty) await db.tasks.update(r.id, { base: r.updated_at })
        else await db.tasks.put({ ...r, reminders: r.reminders ?? [], dirty: 0, deleted: 0, base: r.updated_at }) }
      for (const l of await db.tasks.toArray()) if (!l.dirty && !ids.has(l.id)) await db.tasks.delete(l.id) // deleted on another device
    })
    return { pushed, conflicts }
  } catch (e: any) { return { pushed, conflicts, error: e?.message ?? 'Sync failed' } } finally { running = false }
}
