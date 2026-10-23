import { supabase } from './supabase'
const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const b64 = (s: string) => Uint8Array.from(atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
export async function pushState(): Promise<'unsupported'|'denied'|'on'|'off'> {
  if (!pushSupported()) return 'unsupported'; if (Notification.permission === 'denied') return 'denied'
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}
export async function enablePush() {
  if (!KEY) throw new Error('Push is not configured (missing VITE_VAPID_PUBLIC_KEY).')
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notification permission was not granted.')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(KEY) })
  const j = sub.toJSON(); const { error } = await supabase.rpc('register_push', { p_endpoint: j.endpoint, p_p256dh: j.keys!.p256dh, p_auth: j.keys!.auth }); if (error) throw error
}
export async function disablePush() {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
  if (sub) { await supabase.rpc('unregister_push', { p_endpoint: sub.endpoint }); await sub.unsubscribe() }
}
