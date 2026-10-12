import type { Metadata, Viewport } from 'next'
import { Manrope, Unbounded } from 'next/font/google'
import { FeedbackProvider } from '@/components/Feedback'
import { PwaSetup } from '@/components/Pwa'
import './globals.css'

const unbounded = Unbounded({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-unbounded' })
const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-manrope' })

export const metadata: Metadata = {
  title: 'Goodminton',
  description: 'Badminton games of 4 or 8, never in between. First in are confirmed.',
  applicationName: 'Goodminton',
  appleWebApp: { capable: true, title: 'Goodminton', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
}

export const viewport: Viewport = { themeColor: '#F7F8FA', width: 'device-width', initialScale: 1, viewportFit: 'cover' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${unbounded.variable} ${manrope.variable}`}>
      <body>
        <FeedbackProvider>{children}</FeedbackProvider>
        <PwaSetup />
      </body>
    </html>
  )
}
