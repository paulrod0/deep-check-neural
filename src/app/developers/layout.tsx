import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'API Documentation - Deep-Check Developers',
  description: 'Deep-Check REST API documentation for developers. Integrate deepfake detection, identity verification, and document forensics into your application. Simple API with base64 image input and JSON response.',
  keywords: ['deep-check API', 'deepfake detection API', 'identity verification API', 'developer documentation', 'REST API', 'face verification API'],
  alternates: {
    canonical: 'https://deep-check-two.vercel.app/developers',
  },
  openGraph: {
    title: 'API Documentation - Deep-Check Developers',
    description: 'Integrate deepfake detection and identity verification into your app with the Deep-Check REST API.',
    url: 'https://deep-check-two.vercel.app/developers',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Deep-Check API Documentation',
    description: 'REST API for deepfake detection, identity verification, and document forensics.',
  },
}

export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return children
}
