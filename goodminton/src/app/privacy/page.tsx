import type { Metadata } from 'next'
import { Contact, LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = { title: 'Privacy · Goodminton' }

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="12 October 2026">
      <p>Goodminton is a small app for organising badminton games between friends. This page explains what it stores and why.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>From Google sign-in:</b> your name, email address and profile picture link. Nothing else from your Google account is accessed.</li>
        <li><b>What you enter:</b> matches you create (name, venue, court numbers, time, cost, parking notes), matches you join, and expenses and payments you record.</li>
      </ul>

      <h2>Who can see it</h2>
      <ul>
        <li>Your name is shown to other people in matches you join. Once a match is full, only its confirmed players see names.</li>
        <li>Court numbers, parking notes and costs are shown only to confirmed players of that match.</li>
        <li>Your email address is not shown to other players.</li>
      </ul>

      <h2>How it&apos;s used</h2>
      <p>Only to run the app: signing you in, showing matches, keeping the waitlist and splitting costs. There are no ads, no tracking and no analytics, and your data is never sold or shared for marketing.</p>

      <h2>Where it&apos;s stored</h2>
      <p>Data is stored with Supabase (database and sign-in) and the app is hosted on Vercel. Both act as service providers.</p>

      <h2>Deleting your data</h2>
      <p>Ask using the contact below and your account and data will be deleted.</p>

      <h2>Contact</h2>
      <Contact />
    </LegalPage>
  )
}
