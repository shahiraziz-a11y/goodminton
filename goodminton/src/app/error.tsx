'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/report'

/** Something broke while showing a page: record it and offer a retry. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportError(error.message || 'Page error', [error.digest, error.stack].filter(Boolean).join('\n')) }, [error])
  return (
    <div className="screen" style={{ minHeight: '70dvh', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 16 }}>
      <span className="h1">Something went wrong</span>
      <span className="note">It&apos;s been reported. Try again, or go back home.</span>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn" style={{ height: 48, padding: '0 22px' }} onClick={reset}>Try again</button>
        <a className="btn-2" href="/" style={{ height: 48, padding: '0 22px' }}>Home</a>
      </div>
    </div>
  )
}
