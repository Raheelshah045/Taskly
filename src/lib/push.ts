import { supabase } from './supabase'
const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export function keyMatches(a: ArrayBuffer | null | undefined, b: Uint8Array) { if (!a) return false; const x = new Uint8Array(a); return x.length === b.length && x.every((v, i) => v === b[i]) }
const b64 = (s: string) => Uint8Array.from(atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
export async function pushState(): Promise<'unsupported'|'denied'|'on'|'off'|'stale'> {
  if (!pushSupported()) return 'unsupported'; if (Notification.permission === 'denied') return 'denied'
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
  if (!sub || Notification.permission !== 'granted') return 'off'
  return KEY && keyMatches(sub.options.applicationServerKey, b64(KEY)) ? 'on' : 'stale' // 'stale' = subscribed with a different VAPID key
}
export async function enablePush() {
  // Ask for permission first and independently of push: in-app/local reminders need it even offline or without VAPID.
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notification permission was not granted.')
  if (!KEY) throw new Error('Notifications are allowed, but push is not configured (missing VITE_VAPID_PUBLIC_KEY).')
  if (!navigator.onLine) throw new Error('Notifications are allowed. Push registration needs a connection and completes automatically next time you open Taskly online.')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (sub && !keyMatches(sub.options.applicationServerKey, b64(KEY))) { // VAPID key changed: drop the old server record and subscription, then resubscribe
    await supabase.rpc('unregister_push', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(KEY) })
  const j = sub.toJSON(); const { error } = await supabase.rpc('register_push', { p_endpoint: j.endpoint, p_p256dh: j.keys!.p256dh, p_auth: j.keys!.auth }); if (error) throw error
}
export async function disablePush() {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
  if (sub) { await supabase.rpc('unregister_push', { p_endpoint: sub.endpoint }); await sub.unsubscribe() }
}
// Silent self-heal on launch (no permission prompt): replaces stale subscriptions and re-registers the current one.
export async function refreshPush() { const s = await pushState(); if (s !== 'unsupported' && Notification.permission === 'granted' && navigator.onLine) await enablePush() }
