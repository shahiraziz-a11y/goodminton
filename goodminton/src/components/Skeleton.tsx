import type { CSSProperties } from 'react'

/** Grey placeholder block shown while the next screen loads. */
export const Bone = ({ h, w = '100%', r = 20, style }: { h: number; w?: number | string; r?: number; style?: CSSProperties }) => (
  <div className="bone" style={{ height: h, width: w, borderRadius: r, ...style }} />
)

/** Instant placeholder screen so a tap responds immediately, before the server answers. */
export function LoadingScreen({ variant }: { variant: 'home' | 'match' | 'list' | 'form' }) {
  return (
    <div className="app" aria-busy="true" aria-label="Loading">
      <header className="topbar"><div className="topbar-row"><span className="wordmark">GOODMINTON</span></div></header>
      <main>
        <div className="screen">
          {variant === 'home' && <>
            <Bone h={64} w="55%" r={14} /><Bone h={96} /><Bone h={110} /><Bone h={110} />
          </>}
          {variant === 'match' && <>
            <Bone h={14} w="60%" r={7} /><Bone h={66} w="85%" r={14} /><Bone h={250} /><Bone h={56} r={18} /><Bone h={180} />
          </>}
          {variant === 'list' && <>
            <Bone h={36} w="50%" r={12} /><Bone h={130} r={28} /><Bone h={66} /><Bone h={66} /><Bone h={66} />
          </>}
          {variant === 'form' && <>
            <Bone h={36} w="50%" r={12} /><Bone h={110} /><Bone h={52} r={16} /><Bone h={52} r={16} /><Bone h={52} r={16} />
          </>}
        </div>
      </main>
    </div>
  )
}
