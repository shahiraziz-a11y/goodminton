'use client'

import { createClient } from './supabase/client'

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

export type PushState = 'unsupported' | 'needs-install' | 'off' | 'on' | 'blocked'

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || !!(navigator as { standalone?: boolean }).standalone

/** Where this device stands: can it get alerts, and are they on? */
export async function pushState(): Promise<PushState> {
  if (!KEY || typeof window === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported'
  // iPhone only allows web push from an app added to the Home Screen.
  if (isIos() && !isStandalone()) return 'needs-install'
  if (!('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'off'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) await save(sub) // keep the server copy current (also covers a new sign-in on this device)
  return sub ? 'on' : 'off'
}

/** Ask permission (must run from a tap), subscribe this device and save it. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'
  const reg = await navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready)
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(KEY) }))
  await save(sub)
  return 'on'
}

async function save(sub: PushSubscription) {
  const j = sub.toJSON()
  const { error } = await createClient().rpc('save_push_subscription', {
    p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_user_agent: navigator.userAgent,
  })
  if (error) throw error
}

function urlBase64ToBytes(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}
