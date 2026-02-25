import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import CookieBanner from '@/components/CookieBanner'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Deep-Check | Trust Infrastructure for the AI Era',
  description: 'Continuous identity verification and document forensics. Detect remote fraud, deepfakes, and manipulated documents in real time.',
  keywords: ['identity verification', 'biometric', 'deepfake detection', 'document forensics', 'GDPR', 'EU AI Act'],
  openGraph: {
    title: 'Deep-Check',
    description: 'Continuous identity verification and document forensics for the AI era.',
    url: 'https://deep-check-two.vercel.app',
    siteName: 'Deep-Check',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <CookieBanner />
      </body>
    </html>
  )
}
