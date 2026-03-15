import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import CookieBanner from '@/components/CookieBanner'
import PWARegister from '@/components/PWARegister'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Deep-Check | Trust Infrastructure for the AI Era',
  description: 'Continuous identity verification and document forensics. Detect remote fraud, deepfakes, and manipulated documents in real time.',
  keywords: ['identity verification', 'biometric', 'deepfake detection', 'document forensics', 'GDPR', 'EU AI Act'],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Deep-Check',
    startupImage: [
      { url: '/icons/icon-512.png' },
    ],
  },
  icons: {
    icon: [
      { url: '/icons/icon-96.png',  sizes: '96x96',   type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'Deep-Check',
    description: 'Continuous identity verification and document forensics for the AI era.',
    url: 'https://deep-check.io',
    siteName: 'Deep-Check',
    type: 'website',
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512 }],
  },
  twitter: {
    card: 'summary',
    title: 'Deep-Check',
    description: 'Continuous identity verification — on-premise or cloud.',
    images: ['/icons/icon-512.png'],
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)',  color: '#00e5ff' },
    { media: '(prefers-color-scheme: light)', color: '#0060ff' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,   // prevent zoom-out during document capture
  userScalable: false,
  viewportFit: 'cover',  // handle iPhone notch / dynamic island
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
        <PWARegister />
      </body>
    </html>
  )
}
