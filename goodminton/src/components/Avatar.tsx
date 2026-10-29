'use client'

import { useState } from 'react'
import { usePhoto } from '@/lib/avatars'
import type { Person } from '@/lib/people'

/** Google photo when we have one, otherwise coloured initials. */
export function Avatar({ p, size = 36, font = 13, ring }: { p: Pick<Person, 'id' | 'initials' | 'color'>; size?: number; font?: number; ring?: boolean }) {
  const photo = usePhoto(p.id)
  const [broken, setBroken] = useState<string | null>(null)
  const show = photo && broken !== photo
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: font, background: p.color, boxShadow: ring ? '0 0 0 2px #FFFFFF' : undefined, overflow: 'hidden' }}>
      {show
        // eslint-disable-next-line @next/next/no-img-element -- Google's photo server; no-referrer or it often refuses
        ? <img src={photo} alt="" width={size} height={size} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(photo)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : p.initials}
    </span>
  )
}
