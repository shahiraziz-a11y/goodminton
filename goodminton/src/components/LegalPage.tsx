import Link from 'next/link'
import type { ReactNode } from 'react'

/** Plain text page in the app's style, for the privacy policy and terms. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="app">
      <header className="topbar"><div className="topbar-row"><Link href="/" className="wordmark">GOODMINTON</Link></div></header>
      <main>
        <article className="screen legal" style={{ gap: 16, fontSize: 15, lineHeight: 1.55 }}>
          <span className="h1">{title}</span>
          <span className="note">Last updated {updated}</span>
          {children}
        </article>
      </main>
    </div>
  )
}

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL

export function Contact() {
  return CONTACT
    ? <p><a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
    : <p>Contact the organiser who invited you to Goodminton.</p>
}
