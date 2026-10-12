import type { Metadata } from 'next'
import { Contact, LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = { title: 'Terms · Goodminton' }

export default function Terms() {
  return (
    <LegalPage title="Terms" updated="12 October 2026">
      <p>Goodminton is a free app for organising badminton games between friends. By using it you agree to these terms.</p>

      <h2>Using the app</h2>
      <ul>
        <li>Use it to organise and join games. Don&apos;t misuse it, try to access other people&apos;s data, or interfere with how it works.</li>
        <li>You&apos;re responsible for what you enter, such as match details and expenses.</li>
      </ul>

      <h2>Money</h2>
      <p>Goodminton only keeps a record of who owes whom. It doesn&apos;t process payments. Settling up happens between players, outside the app.</p>

      <h2>No guarantees</h2>
      <p>The app is provided as is, without warranties. Bookings are made by organisers directly with venues, and Goodminton isn&apos;t responsible for courts, venues, games or payments between players.</p>

      <h2>Changes</h2>
      <p>These terms may change as the app evolves. The date above shows the latest version.</p>

      <h2>Contact</h2>
      <Contact />
    </LegalPage>
  )
}
