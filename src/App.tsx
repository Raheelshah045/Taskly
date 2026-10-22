import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Inbox, CalendarDays, CalendarClock, CheckCircle2, Trash2, Plus, LogOut, Download, Circle, Pencil, Check } from 'lucide-react'
import { supabase, configured } from './lib/supabase'
import { dbFor, addTask, patchTask, removeTask, sync, type Task } from './lib/db'

const VIEWS = [['inbox','Inbox',Inbox],['today','Today',CalendarDays],['upcoming','Upcoming',CalendarClock],['done','Completed',CheckCircle2]] as const
type View = typeof VIEWS[number][0]
const PRI = { urgent: 4, high: 3, medium: 2, low: 1 }
const PCOL = { urgent: '#e11d48', high: '#ea580c', medium: '#2563eb', low: '#0d9488' }
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const dayKey = (d: Date|string) => new Date(d).toLocaleDateString('en-CA', { timeZone: tz })

function Auth() {
  const [mode, setMode] = useState<'in'|'up'|'reset'>('in'); const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [msg, setMsg] = useState('')
  async function go(e: React.FormEvent) {
    e.preventDefault(); setMsg('')
    const r = mode === 'in' ? await supabase.auth.signInWithPassword({ email, password: pw })
      : mode === 'up' ? await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.origin } })
      : await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin })
    if (r.error) setMsg(r.error.message); else if (mode === 'up') setMsg('Check your email to verify your account, then sign in.'); else if (mode === 'reset') setMsg('Password reset link sent.')
  }
  return <main className="min-h-screen grid place-items-center p-4"><form onSubmit={go} className="glass rounded-3xl p-6 w-full max-w-sm space-y-3 pop">
    <h1 className="text-2xl font-bold">Taskly</h1><p className="text-sm" style={{color:'var(--mute)'}}>{mode==='in'?'Sign in to your tasks':mode==='up'?'Create your account':'Reset your password'}</p>
    <input className="inp" type="email" required placeholder="Email" aria-label="Email" value={email} onChange={e=>setEmail(e.target.value)} />
    {mode!=='reset' && <input className="inp" type="password" required minLength={8} placeholder="Password (8+ characters)" aria-label="Password" value={pw} onChange={e=>setPw(e.target.value)} />}
    {msg && <p role="status" className="text-sm">{msg}</p>}
    <button className="btn w-full">{mode==='in'?'Sign in':mode==='up'?'Create account':'Send reset link'}</button>
    <div className="text-sm flex justify-between" style={{color:'var(--mute)'}}>
      <button type="button" onClick={()=>setMode(mode==='in'?'up':'in')}>{mode==='in'?'New here? Sign up':'Back to sign in'}</button>
      {mode==='in' && <button type="button" onClick={()=>setMode('reset')}>Forgot password?</button>}</div></form></main>
}

function Planner({ session }: { session: Session }) {
  const uid = session.user.id, db = useMemo(() => dbFor(uid), [uid])
  const [tasks, setTasks] = useState<Task[]>([]); const [view, setView] = useState<View>('today'); const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState(''); const [due, setDue] = useState(''); const [pri, setPri] = useState<Task['priority']>('medium'); const [q, setQ] = useState('')
  const [err, setErr] = useState(''); const [online, setOnline] = useState(navigator.onLine); const [syncing, setSyncing] = useState(false); const [conf, setConf] = useState(0)
  const [editId, setEditId] = useState<string|null>(null); const [editText, setEditText] = useState('')
  const reload = useCallback(async () => { setTasks((await db.tasks.toArray()).filter(t => !t.deleted)); setLoading(false) }, [db])
  const doSync = useCallback(async () => {
    if (!navigator.onLine) return; setSyncing(true); const r = await sync(db, uid, supabase); setSyncing(false)
    if (r.error) setErr('Sync failed: ' + r.error + '. Your changes are saved on this device and will retry.'); else { setErr(''); if (r.conflicts) setConf(c => c + r.conflicts) }
    reload()
  }, [db, uid, reload])
  const syncRef = useRef(doSync); syncRef.current = doSync
  useEffect(() => { reload(); syncRef.current()
    const on = () => { setOnline(true); syncRef.current() }, off = () => setOnline(false), id = setInterval(() => syncRef.current(), 30000)
    addEventListener('online', on); addEventListener('offline', off); return () => { removeEventListener('online', on); removeEventListener('offline', off); clearInterval(id) } }, [reload])
  const mutate = async (fn: () => Promise<unknown>) => { try { await fn(); await reload(); doSync() } catch (e: any) { setErr(e.message) } }
  const add = (e: React.FormEvent) => { e.preventDefault(); const t = title.trim(); if (!t) return setErr('Enter a task title.'); setErr(''); mutate(() => addTask(db, { title: t, priority: pri, due_at: due ? new Date(due).toISOString() : null })); setTitle(''); setDue('') }
  const toggle = (t: Task) => { const done = t.status !== 'completed'; mutate(() => patchTask(db, t.id, { status: done ? 'completed' : 'todo', completed_at: done ? new Date().toISOString() : null })) }
  const del = (t: Task) => { if (confirm(`Delete "${t.title}"?`)) mutate(() => removeTask(db, t)) }
  const saveEdit = () => { const t = editText.trim(); if (t && editId) mutate(() => patchTask(db, editId, { title: t })); setEditId(null) }
  const today = dayKey(new Date())
  const shown = useMemo(() => tasks.filter(t => t.title.toLowerCase().includes(q.toLowerCase())).filter(t => {
    if (view === 'done') return t.status === 'completed'; if (t.status === 'completed') return false
    if (view === 'inbox') return !t.due_at
    if (view === 'today') return !!t.due_at && dayKey(t.due_at) <= today
    return !!t.due_at && dayKey(t.due_at) > today
  }).sort((a, b) => (a.due_at && b.due_at ? a.due_at.localeCompare(b.due_at) : 0) || PRI[b.priority] - PRI[a.priority]), [tasks, view, q, today])
  const open = tasks.filter(t => t.status !== 'completed'), overdue = open.filter(t => t.due_at && dayKey(t.due_at) < today).length
  const doneToday = tasks.filter(t => t.completed_at && dayKey(t.completed_at) === today).length, pending = tasks.filter(t => t.dirty).length
  const exportJson = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(tasks.map(({ dirty, deleted, base, ...t }) => t), null, 2)], { type: 'application/json' })); a.download = 'tasks.json'; a.click() }
  const st = !online ? ['Offline', '#b45309'] : syncing ? ['Syncing…', '#2563eb'] : pending ? [`${pending} pending`, '#7c3aed'] : ['Synced', '#047857']
  const nb = 'flex flex-col md:flex-row items-center gap-1 md:gap-3 px-3 py-2 rounded-xl text-sm'
  return <div className="min-h-screen md:grid md:grid-cols-[230px_1fr]">
    <nav aria-label="Main" className="glass fixed bottom-0 inset-x-0 z-10 flex justify-around p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] md:static md:flex-col md:justify-start md:gap-1 md:p-4 md:m-3 md:rounded-3xl md:h-[calc(100vh-1.5rem)] md:sticky md:top-3">
      <h1 className="hidden md:block text-2xl font-bold mb-4 px-3" style={{backgroundImage:'var(--grad)',WebkitBackgroundClip:'text',color:'transparent'}}>Taskly</h1>
      {VIEWS.map(([k, label, Icon]) => <button key={k} onClick={() => setView(k)} aria-current={view === k} className={nb} style={view === k ? { background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--acc)', fontWeight: 700 } : {}}><Icon size={18} />{label}</button>)}
      <button onClick={exportJson} className={nb + ' md:mt-auto'} style={{color:'var(--mute)'}}><Download size={18} />Export</button>
      <button onClick={() => supabase.auth.signOut()} className={nb} style={{color:'var(--mute)'}}><LogOut size={18} />Sign out</button>
    </nav>
    <main className="p-4 pb-28 md:p-8 max-w-3xl w-full">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-2xl font-bold">{VIEWS.find(v => v[0] === view)![1]}</h2>
        <p className="text-sm" style={{color:'var(--mute)'}}>{open.length} open · {overdue} overdue · {doneToday} done today</p></div>
        <span className="badge" role="status" style={{color:st[1],borderColor:st[1]}}><span className="dot" style={{background:st[1]}} />{st[0]}</span></header>
      {!online && <p className="card p-3 mb-3 text-sm" role="status">You're offline. Changes are saved on this device and will sync when you reconnect.</p>}
      {conf > 0 && <p className="card p-3 mb-3 text-sm" role="status">{conf} task(s) were changed on another device; your latest edit was kept. <button className="underline" onClick={() => setConf(0)}>Dismiss</button></p>}
      <form onSubmit={add} className="glass rounded-2xl p-3 mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input className="inp" placeholder="Add a task" aria-label="Task title" value={title} onChange={e => setTitle(e.target.value)} />
        <input className="inp" type="datetime-local" aria-label="Due" value={due} onChange={e => setDue(e.target.value)} />
        <select className="inp" aria-label="Priority" value={pri} onChange={e => setPri(e.target.value as Task['priority'])}>{['low','medium','high','urgent'].map(p => <option key={p}>{p}</option>)}</select>
        <button className="btn flex items-center gap-1 justify-center"><Plus size={16} />Add</button></form>
      <input className="inp mb-3" placeholder="Search tasks" aria-label="Search" value={q} onChange={e => setQ(e.target.value)} />
      {err && <p role="alert" className="card p-3 mb-3 text-sm" style={{color:'#be123c',borderColor:'#be123c'}}>{err}</p>}
      {loading ? <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="card h-14 animate-pulse" />)}</div>
        : shown.length === 0 ? <p className="card p-6 text-center" style={{color:'var(--mute)'}}>{view === 'done' ? 'Nothing completed yet.' : 'Nothing here. Add a task above.'}</p>
        : <ul className="space-y-2">{shown.map(t => <li key={t.id} className="card pop p-3 flex items-center gap-3" style={{borderLeft:`5px solid ${PCOL[t.priority]}`}}>
          <button onClick={() => toggle(t)} aria-label={t.status === 'completed' ? 'Reopen task' : 'Complete task'}>{t.status === 'completed' ? <CheckCircle2 style={{color:'#047857'}} /> : <Circle />}</button>
          <div className="flex-1 min-w-0">{editId === t.id
            ? <input className="inp" autoFocus aria-label="Edit title" value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && setEditId(null)} />
            : <p className={t.status === 'completed' ? 'line-through opacity-70' : ''}>{t.title}</p>}
            <p className="text-xs mt-0.5" style={{color:'var(--mute)'}}>{t.priority}{t.due_at && ` · ${new Date(t.due_at).toLocaleString([], { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })}`}{t.dirty ? ' · not synced' : ''}</p></div>
          {editId === t.id ? <button onClick={saveEdit} aria-label="Save title"><Check size={18} /></button> : <button onClick={() => { setEditId(t.id); setEditText(t.title) }} aria-label="Edit task"><Pencil size={18} /></button>}
          <button onClick={() => del(t)} aria-label="Delete task"><Trash2 size={18} /></button></li>)}</ul>}
    </main></div>
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null); const [ready, setReady] = useState(false)
  useEffect(() => { supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) }); const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s)); return () => data.subscription.unsubscribe() }, [])
  if (!configured) return <main className="p-8"><p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example).</p></main>
  if (!ready) return null
  return session ? <Planner session={session} /> : <Auth />
}
