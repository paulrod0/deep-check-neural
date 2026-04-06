import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'TrustMyProfile - Verified Profile Badge',
  description: 'Get a verified badge for your online profile. TrustMyProfile uses face matching and deepfake detection to prove you are a real person. Verify yourself or check if a profile photo is AI-generated. 100% private.',
  keywords: ['profile verification', 'verified badge', 'trust badge', 'face matching', 'identity proof', 'profile authenticity', 'online trust verification'],
  alternates: {
    canonical: 'https://deep-check-two.vercel.app/trustmyprofile',
  },
  openGraph: {
    title: 'TrustMyProfile - Verified Profile Badge | Deep-Check',
    description: 'Get a verified badge for your online profile. Face matching and deepfake detection to prove you are real.',
    url: 'https://deep-check-two.vercel.app/trustmyprofile',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TrustMyProfile - Verified Profile Badge | Deep-Check',
    description: 'Get a verified badge for your profile. AI-powered face matching and deepfake detection.',
  },
}

export default function TrustMyProfileLayout({ children }: { children: React.ReactNode }) {
  return children
}
