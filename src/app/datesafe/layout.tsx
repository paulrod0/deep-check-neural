import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'DateSafe - Catfish Detection for Dating Apps',
  description: 'Detect catfish profiles on dating apps like Tinder, Bumble, and Hinge. Upload a profile photo and our AI detects AI-generated faces from StyleGAN, Midjourney, and DALL-E. 100% private, runs entirely in your browser.',
  keywords: ['catfish detection', 'dating app safety', 'fake profile detector', 'AI face detection', 'tinder catfish', 'dating scam detector', 'romance scam protection'],
  alternates: {
    canonical: 'https://deep-check-two.vercel.app/datesafe',
  },
  openGraph: {
    title: 'DateSafe - Catfish Detection for Dating Apps | Deep-Check',
    description: 'Detect catfish profiles on dating apps. Upload a profile photo and our AI detects AI-generated faces. 100% private.',
    url: 'https://deep-check-two.vercel.app/datesafe',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DateSafe - Catfish Detection for Dating Apps | Deep-Check',
    description: 'Detect catfish profiles on dating apps. AI-powered, 100% private, runs in your browser.',
  },
}

export default function DateSafeLayout({ children }: { children: React.ReactNode }) {
  return children
}
