import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ResumeGuard - Resume & LinkedIn Photo Verification',
  description: 'Detect AI-generated LinkedIn headshots and fake profile photos. Batch scan up to 10 photos at once. Built for HR departments, recruiters, and hiring platforms. Detects StyleGAN, DALL-E, and Midjourney faces. 100% private.',
  keywords: ['resume verification', 'LinkedIn fake profile', 'AI headshot detector', 'fake LinkedIn photo', 'HR verification tool', 'recruiter AI tool', 'profile photo verification'],
  alternates: {
    canonical: 'https://deep-check-two.vercel.app/resumeguard',
  },
  openGraph: {
    title: 'ResumeGuard - Resume Photo Verification | Deep-Check',
    description: 'Detect AI-generated LinkedIn headshots and fake profile photos. Batch scan for HR and recruiters.',
    url: 'https://deep-check-two.vercel.app/resumeguard',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ResumeGuard - Resume Photo Verification | Deep-Check',
    description: 'Detect AI-generated LinkedIn headshots. Batch scan up to 10 photos. Built for HR and recruiters.',
  },
}

export default function ResumeGuardLayout({ children }: { children: React.ReactNode }) {
  return children
}
