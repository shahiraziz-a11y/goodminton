import type { Metadata, Viewport } from 'next'
import { Manrope, Unbounded } from 'next/font/google'
import { FeedbackProvider } from '@/components/Feedback'
import './globals.css'

const unbounded = Unbounded({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-unbounded' })
const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-manrope' })

export const metadata: Metadata = {
  title: 'Goodminton',
  description: 'Badminton games of 4 or 8, never in between. First in are confirmed.',
}

export const viewport: Viewport = { themeColor: '#F7F8FA', width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${unbounded.variable} ${manrope.variable}`}>
      <body>
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  )
}
