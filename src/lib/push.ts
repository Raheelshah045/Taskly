import { supabase } from './supabase'

const KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim()
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export function keyMatches(a: ArrayBuffer | null | undefined, b: Uint8Array) {
  if (!a) return false
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

// VAPID keys use base64url encoding and must decode to a 65-byte uncompressed P-256 public key.
function decodeVapidKey(value: string | undefined): Uint8Array {
  const cleaned = value?.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '')
  if (!cleaned) {
    throw new Error('VAPID public key is missing from this deployment.')
  }
  const invalidIndex = [...cleaned].findIndex(c => !/[A-Za-z0-9_+/=-]/.test(c))
  if (invalidIndex !== -1) {
    const code = cleaned.charCodeAt(invalidIndex)
    throw new Error(`VAPID public key contains an unsupported character at position ${invalidIndex + 1} (character code ${code}); key value is not logged.`)
  }

  let decoded: Uint8Array
  try {
    const base64 = cleaned.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
    decoded = Uint8Array.from(
      atob(base64 + '='.repeat((4 - base64.length % 4) % 4)),
      c => c.charCodeAt(0),
    )
  } catch {
    throw new Error('VAPID public key is not valid Base64/Base64URL.')
  }

  if (decoded.length !== 65) {
    throw new Error(`VAPID public key decoded to ${decoded.length} bytes; expected 65. Check that Cloudflare has the complete public key, not the private key.`)
  }
  if (decoded[0] !== 4) {
    throw new Error('VAPID public key has an invalid format. Use the complete uncompressed P-256 public key.')
  }
  return decoded
}

export async function pushState(): Promise<'unsupported'|'denied'|'on'|'off'|'stale'> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
  if (!sub || Notification.permission !== 'granted') return 'off'
  if (!KEY) return 'stale'
  try {
    return keyMatches(sub.options.applicationServerKey, decodeVapidKey(KEY)) ? 'on' : 'stale'
  } catch {
    // Do not let a broken deployment configuration crash the UI.
    return 'stale'
  }
}

export async function enablePush() {
  if (await Notification.requestPermission() !== 'granted') {
    throw new Error('Notification permission was not granted.')
  }
  if (!KEY) throw new Error('Push notifications are temporarily unavailable.')
  const applicationServerKey = decodeVapidKey(KEY)
  if (!navigator.onLine) {
    throw new Error('Notifications are allowed. Background notifications need an internet connection to finish setup.')
  }

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (sub && !keyMatches(sub.options.applicationServerKey, applicationServerKey)) {
    await supabase.rpc('unregister_push', { p_endpoint: sub.endpoint })
    await sub.unsubscribe()
    sub = null
  }
  // Pass a standalone ArrayBuffer to satisfy strict DOM typings and avoid SharedArrayBuffer ambiguity.
  const keyBuffer = new ArrayBuffer(applicationServerKey.byteLength)
  new Uint8Array(keyBuffer).set(applicationServerKey)
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBuffer })
  const j = sub.toJSON()
  const { error } = await supabase.rpc('register_push', {
    p_endpoint: j.endpoint,
    p_p256dh: j.keys!.p256dh,
    p_auth: j.keys!.auth,
  })
  if (error) throw error
}

export async function disablePush() {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription()
  if (sub) {
    await supabase.rpc('unregister_push', { p_endpoint: sub.endpoint })
    await sub.unsubscribe()
  }
}

// Silent self-heal on launch (no permission prompt): replaces stale subscriptions and re-registers the current one.
export async function refreshPush() {
  const s = await pushState()
  if (s !== 'unsupported' && Notification.permission === 'granted' && navigator.onLine) {
    try {
      await enablePush()
    } catch (error) {
      console.error('[taskly:push-setup] Background push setup failed:', error)
    }
  }
}
