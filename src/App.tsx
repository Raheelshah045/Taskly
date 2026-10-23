import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Inbox, CalendarDays, CalendarClock, CheckCircle2, Trash2, Plus, LogOut, Download, Circle, Pencil, Check, AlertTriangle, Bell } from 'lucide-react'
import { supabase, configured } from './lib/supabase'
import { enablePush, disablePush, pushState } from './lib/push'
import { dbFor, addTask, patchTask, removeTask, sync, type Task } from './lib/db'

const VIEWS = [['inbox','Inbox',Inbox],['today','Today',CalendarDays],['overdue','Overdue',AlertTriangle],['upcoming','Upcoming',CalendarClock],['done','Completed',CheckCircle2]] as const
type View = typeof VIEWS[number][0]
const PRI = { urgent: 4, high: 3, medium: 2, low: 1 }
const PCOL = { urgent: '#e11d48', high: '#ea580c', medium: '#2563eb', low: '#0d9488' }
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const PRESETS = [0, 5, 15, 30, 60, 1440]
const lab = (m: number) => m === 0 ? 'At time' : m % 1440 === 0 ? `${m / 1440} d` : m % 60 === 0 ? `${m / 60} h` : `${m} min`
const dayKey = (d: Date|string) => new Date(d).toLocaleDateString('en-CA', { timeZone: tz })

function Auth() {
  const [mode, setMode] = useState<'in'|'up'|'reset'>('in'); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)
  async function go(e: React.FormEvent) {
    e.preventDefault(); setMsg(''); if (mode === 'up' && !name.trim()) return setMsg('Please enter your name.'); setBusy(true)
    const r = mode === 'in' ? await supabase.auth.signInWithPassword({ email, password: pw })
      : mode === 'up' ? await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.origin, data: { full_name: name.trim() } } })
      : await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin })
    setBusy(false)
    if (r.error) setMsg(r.error.message); else if (mode === 'up') setMsg('Check your email to verify your account, then sign in.'); else if (mode === 'reset') setMsg('Password reset link sent.')
  }
  const tab = (m: 'in'|'up', l: string) => <button type="button" onClick={() => { setMode(m); setMsg('') }} aria-pressed={mode === m} className="flex-1 py-2 rounded-xl text-sm font-semibold" style={mode === m ? { background: 'var(--grad)', color: '#fff' } : { color: 'var(--mute)' }}>{l}</button>
  return <main className="min-h-screen grid place-items-center p-4"><div className="glass rounded-[28px] w-full max-w-4xl grid md:grid-cols-2 overflow-hidden pop">
    <section className="hidden md:flex flex-col justify-between p-10 text-white" style={{ background: 'linear-gradient(150deg,#0e7490,#2563eb 40%,#7c3aed 75%,#be185d)' }}>
      <h1 className="text-3xl font-bold">Taskly</h1><div><p className="text-2xl font-semibold leading-snug">Plan your day.<br />Never miss what matters.</p><p className="mt-3 text-sm opacity-95">Works offline. Reminders reach your phone, even when the app is closed.</p></div></section>
    <form onSubmit={go} className="p-6 sm:p-10 space-y-3" style={{ background: 'var(--card)' }}>
      <h1 className="md:hidden text-2xl font-bold" style={{ backgroundImage: 'var(--grad)', WebkitBackgroundClip: 'text', color: 'transparent' }}>Taskly</h1>
      {mode !== 'reset' ? <div className="flex gap-1 p-1 rounded-2xl" style={{ border: '1px solid var(--line)' }}>{tab('in', 'Sign in')}{tab('up', 'Create account')}</div> : <h2 className="text-xl font-bold">Reset your password</h2>}
      {mode === 'up' && <input className="inp" required maxLength={60} autoComplete="name" placeholder="Your name" aria-label="Your name" value={name} onChange={e => setName(e.target.value)} />}
      <input className="inp" type="email" required autoComplete="email" placeholder="Email" aria-label="Email" value={email} onChange={e => setEmail(e.target.value)} />
      {mode !== 'reset' && <input className="inp" type="password" required minLength={8} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} placeholder="Password (8+ characters)" aria-label="Password" value={pw} onChange={e => setPw(e.target.value)} />}
      {msg && <p role="status" className="text-sm">{msg}</p>}
      <button className="btn w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
      <div className="text-sm" style={{ color: 'var(--mute)' }}>{mode === 'reset' ? <button type="button" onClick={() => setMode('in')}>Back to sign in</button> : mode === 'in' && <button type="button" onClick={() => setMode('reset')}>Forgot password?</button>}</div></form></div></main>
}

function Planner({ session }: { session: Session }) {
  const uid = session.user.id, db = useMemo(() => dbFor(uid), [uid])
  const [tasks, setTasks] = useState<Task[]>([]); const [view, setView] = useState<View>('today'); const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState(''); const [due, setDue] = useState(''); const [pri, setPri] = useState<Task['priority']>('medium'); const [q, setQ] = useState('')
  const [err, setErr] = useState(''); const [online, setOnline] = useState(navigator.onLine); const [syncing, setSyncing] = useState(false); const [conf, setConf] = useState(0)
  const [name, setName] = useState(localStorage.getItem('taskly-name-' + uid) || ''); const [askName, setAskName] = useState(false); const [nameIn, setNameIn] = useState('')
  const [rem, setRem] = useState<number[]>([15]); const [custom, setCustom] = useState(''); const [ps, setPs] = useState<string>('off')
  useEffect(() => { pushState().then(setPs); if (navigator.onLine) supabase.from('profiles').select('display_name').eq('id', uid).maybeSingle().then(({ data, error }) => { if (error) return; if (data?.display_name) { setName(data.display_name); localStorage.setItem('taskly-name-' + uid, data.display_name) } else setAskName(true) }) }, [uid])
  const saveName = async (e: React.FormEvent) => { e.preventDefault(); const n = nameIn.trim(); if (!n) return; const { error } = await supabase.from('profiles').upsert({ id: uid, display_name: n }); if (error) return setErr(error.message); setName(n); localStorage.setItem('taskly-name-' + uid, n); setAskName(false) }
  const togglePush = async () => { try { if (ps === 'on') await disablePush(); else await enablePush(); setErr('') } catch (e: any) { setErr(e.message) } setPs(await pushState()) }
  const toggleRem = (m: number) => setRem(r => r.includes(m) ? r.filter(x => x !== m) : r.length >= 5 ? r : [...r, m])
  const addCustom = () => { const m = Math.round(Number(custom)); if (m >= 0 && m <= 10080) toggleRem(m); setCustom('') }
  const h = new Date().getHours(), greet = h < 5 || h >= 17 ? 'Good evening' : h < 12 ? 'Good morning' : 'Good afternoon'
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
  const add = (e: React.FormEvent) => { e.preventDefault(); const t = title.trim(); if (!t) return setErr('Enter a task title.'); setErr(''); mutate(() => addTask(db, { title: t, priority: pri, due_at: due ? new Date(due).toISOString() : null, reminders: due ? [...rem].sort((a, b) => a - b) : [] })); setTitle(''); setDue(''); setRem([15]) }
  const toggle = (t: Task) => { const done = t.status !== 'completed'; mutate(() => patchTask(db, t.id, { status: done ? 'completed' : 'todo', completed_at: done ? new Date().toISOString() : null })) }
  const del = (t: Task) => { if (confirm(`Delete "${t.title}"?`)) mutate(() => removeTask(db, t)) }
  const saveEdit = () => { const t = editText.trim(); if (t && editId) mutate(() => patchTask(db, editId, { title: t })); setEditId(null) }
  const today = dayKey(new Date())
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNowMs(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const isOverdue = (t: Task) => t.status !== 'completed' && !!t.due_at && new Date(t.due_at).getTime() < nowMs
  const shown = useMemo(() => tasks.filter(t => t.title.toLowerCase().includes(q.toLowerCase())).filter(t => {
    if (view === 'done') return t.status === 'completed'; if (t.status === 'completed') return false
    if (view === 'inbox') return !t.due_at
    if (view === 'today') return !!t.due_at && dayKey(t.due_at) === today
    if (view === 'overdue') return !!t.due_at && new Date(t.due_at).getTime() < Date.now()
    return !!t.due_at && dayKey(t.due_at) > today
  }).sort((a, b) => (a.due_at && b.due_at ? a.due_at.localeCompare(b.due_at) : 0) || PRI[b.priority] - PRI[a.priority]), [tasks, view, q, today, nowMs])
  const open = tasks.filter(t => t.status !== 'completed'), overdue = open.filter(isOverdue).length
  const doneToday = tasks.filter(t => t.completed_at && dayKey(t.completed_at) === today).length, pending = tasks.filter(t => t.dirty).length
  const exportJson = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(tasks.map(({ dirty, deleted, base, ...t }) => t), null, 2)], { type: 'application/json' })); a.download = 'tasks.json'; a.click() }
  const st = !online ? ['Offline', '#b45309'] : syncing ? ['Syncing…', '#2563eb'] : pending ? [`${pending} pending`, '#7c3aed'] : ['Synced', '#047857']
  const nb = 'flex flex-col md:flex-row items-center gap-1 md:gap-3 px-3 py-2 rounded-xl text-sm'
  return <div className="min-h-screen md:grid md:grid-cols-[230px_1fr]">
    <nav aria-label="Main" className="glass fixed bottom-0 inset-x-0 z-10 flex justify-around p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] md:static md:flex-col md:justify-start md:gap-1 md:p-4 md:m-3 md:rounded-3xl md:h-[calc(100vh-1.5rem)] md:sticky md:top-3">
      <h1 className="hidden md:block text-2xl font-bold mb-4 px-3" style={{backgroundImage:'var(--grad)',WebkitBackgroundClip:'text',color:'transparent'}}>Taskly</h1>
      {VIEWS.map(([k, label, Icon]) => <button key={k} onClick={() => setView(k)} aria-current={view === k} className={nb} style={view === k ? { background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--acc)', fontWeight: 700 } : {}}><Icon size={18} />{label}{k === 'overdue' && overdue > 0 && <span className="badge" style={{ color: '#be123c', borderColor: '#be123c' }}>{overdue}</span>}</button>)}
      <button onClick={exportJson} className={nb + ' md:mt-auto'} style={{color:'var(--mute)'}}><Download size={18} />Export</button>
      <button onClick={async () => { await disablePush().catch(() => {}); supabase.auth.signOut() }} className={nb} style={{color:'var(--mute)'}}><LogOut size={18} />Sign out</button>
    </nav>
    <main className="p-4 pb-28 md:p-8 max-w-3xl w-full">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-2xl font-bold">{greet}{name && `, ${name}`}</h2><p className="text-sm font-semibold" style={{ color: 'var(--acc)' }}>{VIEWS.find(v => v[0] === view)![1]}</p>
        <p className="text-sm" style={{color:'var(--mute)'}}>{open.length} open · {overdue} overdue · {doneToday} done today</p></div>
        <span className="badge" role="status" style={{color:st[1],borderColor:st[1]}}><span className="dot" style={{background:st[1]}} />{st[0]}</span>{ps === 'unsupported' ? <span className="badge">Push unavailable in this browser</span> : ps === 'denied' ? <span className="badge" style={{ color: '#b45309', borderColor: '#b45309' }}>Notifications blocked in browser settings</span> : <button className="badge" onClick={togglePush} aria-pressed={ps === 'on'}><Bell size={14} />{ps === 'on' ? 'Reminders on' : 'Enable reminders'}</button>}</header>
      {askName && <form onSubmit={saveName} className="card p-3 mb-3 flex gap-2"><input className="inp" maxLength={60} required placeholder="What should we call you?" aria-label="Your name" value={nameIn} onChange={e => setNameIn(e.target.value)} /><button className="btn">Save</button></form>}
      {!online && <p className="card p-3 mb-3 text-sm" role="status">You're offline. Changes are saved on this device and will sync when you reconnect.</p>}
      {conf > 0 && <p className="card p-3 mb-3 text-sm" role="status">{conf} task(s) were changed on another device; your latest edit was kept. <button className="underline" onClick={() => setConf(0)}>Dismiss</button></p>}
      <form onSubmit={add} className="glass rounded-2xl p-3 mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input className="inp" placeholder="Add a task" aria-label="Task title" value={title} onChange={e => setTitle(e.target.value)} />
        <input className="inp" type="datetime-local" aria-label="Due" value={due} onChange={e => setDue(e.target.value)} />
        <select className="inp" aria-label="Priority" value={pri} onChange={e => setPri(e.target.value as Task['priority'])}>{['low','medium','high','urgent'].map(p => <option key={p}>{p}</option>)}</select>
        <button className="btn flex items-center gap-1 justify-center"><Plus size={16} />Add</button>
        {due && <div className="sm:col-span-full flex flex-wrap items-center gap-2" role="group" aria-label="Reminders before due time"><span className="text-sm font-semibold">Remind me:</span>
          {[...new Set([...PRESETS, ...rem])].sort((a, b) => a - b).map(m => <button type="button" key={m} onClick={() => toggleRem(m)} aria-pressed={rem.includes(m)} className="badge" style={rem.includes(m) ? { background: 'var(--grad)', color: '#fff', borderColor: 'transparent' } : {}}>{lab(m)}</button>)}
          <input className="inp" style={{ width: '7rem' }} type="number" min={0} max={10080} placeholder="min before" aria-label="Custom reminder minutes before" value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }} /><button type="button" className="badge" onClick={addCustom}>Add</button></div>}</form>
      <input className="inp mb-3" placeholder="Search tasks" aria-label="Search" value={q} onChange={e => setQ(e.target.value)} />
      {err && <p role="alert" className="card p-3 mb-3 text-sm" style={{color:'#be123c',borderColor:'#be123c'}}>{err}</p>}
      {loading ? <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="card h-14 animate-pulse" />)}</div>
        : shown.length === 0 ? <p className="card p-6 text-center" style={{color:'var(--mute)'}}>{view === 'done' ? 'Nothing completed yet.' : 'Nothing here. Add a task above.'}</p>
        : <ul className="space-y-2">{shown.map(t => <li key={t.id} className="card pop p-3 flex items-center gap-3" style={{borderLeft:`5px solid ${PCOL[t.priority]}`}}>
          <button onClick={() => toggle(t)} aria-label={t.status === 'completed' ? 'Reopen task' : 'Complete task'}>{t.status === 'completed' ? <CheckCircle2 style={{color:'#047857'}} /> : <Circle />}</button>
          <div className="flex-1 min-w-0">{editId === t.id
            ? <input className="inp" autoFocus aria-label="Edit title" value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => e.key === 'Enter' ? saveEdit() : e.key === 'Escape' && setEditId(null)} />
            : <p className={t.status === 'completed' ? 'line-through opacity-70' : ''}>{t.title}</p>}
            <p className="text-xs mt-0.5" style={{color:'var(--mute)'}}>{t.priority}{t.due_at && ` · ${new Date(t.due_at).toLocaleString([], { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })`}{isOverdue(t) && <span className="ml-2 font-semibold" style={{ color: '#be123c' }}>· OVERDUE</span>}{t.reminders?.length ? ` · 🔔 ${t.reminders.map(lab).join(', ')}` : ''}{t.dirty ? ' · not synced' : ''}</p></div>
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
