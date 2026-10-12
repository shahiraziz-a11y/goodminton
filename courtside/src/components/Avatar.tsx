import type { Person } from '@/lib/people'

export function Avatar({ p, size = 36, font = 13, ring }: { p: Pick<Person, 'initials' | 'color'>; size?: number; font?: number; ring?: boolean }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: font, background: p.color, boxShadow: ring ? '0 0 0 2px #FFFFFF' : undefined }}>
      {p.initials}
    </span>
  )
}
