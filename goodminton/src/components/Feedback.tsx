'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type Ctx = { flash: (text: string) => void; celebrate: () => void }
const FeedbackCtx = createContext<Ctx>({ flash: () => {}, celebrate: () => {} })
export const useFeedback = () => useContext(FeedbackCtx)

const CONFETTI = ['#1FB57A', '#0E8F9E', '#FF9A3D', '#FF3D7F', '#FFD23D']

/** Toasts and the "Match full!" confetti. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<string | null>(null)
  const [party, setParty] = useState(0)
  const timers = useRef<{ t?: ReturnType<typeof setTimeout>; c?: ReturnType<typeof setTimeout> }>({})
  const pieces = useRef<{ l: number; d: number; t: number; c: string; r: number; w: number }[]>([])

  const flash = useCallback((text: string) => {
    clearTimeout(timers.current.t)
    setToast(text)
    timers.current.t = setTimeout(() => setToast(null), 2600)
  }, [])

  const celebrate = useCallback(() => {
    pieces.current = Array.from({ length: 40 }, (_, i) => ({
      l: Math.random() * 100, d: Math.random() * 0.6, t: 1.6 + Math.random() * 1.2, c: CONFETTI[i % CONFETTI.length], r: Math.random() * 360, w: 6 + Math.random() * 6,
    }))
    setParty(Date.now())
    clearTimeout(timers.current.c)
    timers.current.c = setTimeout(() => setParty(0), 3000)
  }, [])

  return (
    <FeedbackCtx.Provider value={{ flash, celebrate }}>
      {children}
      {party > 0 && (
        <div key={party} className="confetti" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 15, overflow: 'hidden' }}>
          {pieces.current.map((p, i) => (
            <span key={i} style={{ position: 'absolute', top: -24, left: `${p.l}%`, width: p.w, height: p.w * 1.6, background: p.c, borderRadius: 2, transform: `rotate(${p.r}deg)`, animation: `csFall ${p.t}s ${p.d}s cubic-bezier(.25,.6,.4,1) forwards` }} />
          ))}
          <div style={{ position: 'absolute', top: '42%', left: '50%', transform: 'translate(-50%,-50%)', padding: '18px 26px', borderRadius: 24, background: '#0E5A3A', color: '#fff', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 22, whiteSpace: 'nowrap', boxShadow: '0 20px 50px -10px rgba(14,143,158,.6)', animation: 'csPop 2.8s ease forwards' }}>
            Match full!
          </div>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </FeedbackCtx.Provider>
  )
}
