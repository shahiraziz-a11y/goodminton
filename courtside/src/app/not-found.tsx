import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="app">
      <div className="screen" style={{ minHeight: '100dvh', justifyContent: 'center', textAlign: 'center' }}>
        <span className="h1">No match here.</span>
        <span className="note">The link may be wrong, or the match was removed.</span>
        <Link href="/" className="btn">Go home</Link>
      </div>
    </div>
  )
}
