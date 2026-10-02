import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ProofShot - Photo Authenticity Certificate',
  description: 'Generate a verifiable authenticity certificate for any photo. ProofShot uses AI to analyze whether an image is a real photograph or AI-generated, then issues a timestamped certificate with GPS coordinates. 100% private.',
  keywords: ['photo authenticity', 'photo certificate', 'image verification', 'proof of authenticity', 'AI image certificate', 'photo verification tool'],
  alternates: {
    canonical: 'https://deep-check-two.vercel.app/proofshot',
  },
  openGraph: {
    title: 'ProofShot - Photo Authenticity Certificate | Deep-Check',
    description: 'Generate verifiable authenticity certificates for photos. AI analysis with timestamped proof.',
    url: 'https://deep-check-two.vercel.app/proofshot',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ProofShot - Photo Authenticity Certificate | Deep-Check',
    description: 'Generate verifiable photo authenticity certificates with AI analysis and timestamped proof.',
  },
}

export default function ProofShotLayout({ children }: { children: React.ReactNode }) {
  return children
}
