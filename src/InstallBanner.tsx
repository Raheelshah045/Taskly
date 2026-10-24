import { useEffect, useState } from 'react'
import { Download, X, Smartphone } from 'lucide-react'
import { isNative } from './lib/native'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export default function InstallBanner() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem('taskly-install-dismissed') === '1' } catch { return false }
  })
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    if (isNative) return
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPromptEvent(event as InstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPromptEvent(null)
    }
    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone) {
      setInstalled(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (isNative || installed || hidden) return null

  const install = async () => {
    if (!promptEvent) {
      setHelpOpen(v => !v)
      return
    }
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    setPromptEvent(null)
  }

  const dismiss = () => {
    setHidden(true)
    try { localStorage.setItem('taskly-install-dismissed', '1') } catch {}
  }

  return (
    <aside className="fixed inset-x-3 bottom-[5.5rem] md:bottom-4 z-50 mx-auto max-w-xl" aria-label="Install Taskly">
      <div className="glass rounded-2xl p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: 'var(--grad)' }}>
            <Smartphone size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Get Taskly on your device</p>
            <p className="text-xs sm:text-sm" style={{ color: 'var(--mute)' }}>Quick access, offline support and reminders.</p>
          </div>
          <button className="btn flex shrink-0 items-center gap-2 text-sm" onClick={install}>
            <Download size={16} /> Install
          </button>
          <button onClick={dismiss} aria-label="Dismiss install banner" className="p-1" style={{ color: 'var(--mute)' }}>
            <X size={18} />
          </button>
        </div>
        {helpOpen && (
          <p className="mt-3 rounded-xl p-3 text-sm" style={{ background: 'var(--card)', color: 'var(--ink)' }}>
            { /iphone|ipad|ipod/i.test(navigator.userAgent)
              ? 'On iPhone or iPad: open this page in Safari, tap Share, then choose “Add to Home Screen”.'
              : 'If no install prompt appears, open your browser menu (⋮) and choose “Install app” or “Add to Home screen”. Use HTTPS for installation.'}
          </p>
        )}
      </div>
    </aside>
  )
}
