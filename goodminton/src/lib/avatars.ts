'use client'

import { useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'

/** Google photos of me and the people in my groups, loaded once per page. */
let photos: Record<string, string> = {}
let started = false
const listeners = new Set<() => void>()

function load() {
  if (started) return
  started = true
  Promise.resolve(createClient().rpc('people_photos')).then(({ data }) => {
    if (!data) return // signed out: initials it is
    photos = data as Record<string, string>
    listeners.forEach(l => l())
  }, () => {})
}

function subscribe(l: () => void) {
  load()
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function usePhoto(id: string): string | undefined {
  return useSyncExternalStore(subscribe, () => photos[id], () => undefined)
}
