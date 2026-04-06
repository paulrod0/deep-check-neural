import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Am I Real? - Live Deepfake Detection',
  description: 'Test if you are real or a deepfake with live camera analysis. Deep-Check uses a 6-layer AI detection stack including rPPG heartbeat analysis, facial biomechanics, and neural network inference — all running in your browser. Zero data sent to servers.',
  keywords: ['am I real', 'deepfake test', 'live deepfake detection', 'liveness detection', 'face verification', 'deepfake detector camera', 'AI face check'],
  alternates: {
    canonical: 'https://deep-check-two.vercel.app/amireal',
  },
  openGraph: {
    title: 'Am I Real? - Live Deepfake Detection | Deep-Check',
    description: 'Test if you are real or a deepfake with live camera AI analysis. 6-layer detection stack runs entirely in your browser.',
    url: 'https://deep-check-two.vercel.app/amireal',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Am I Real? - Live Deepfake Detection | Deep-Check',
    description: 'Test if you are real or a deepfake with live camera AI analysis. Privacy-first, runs in your browser.',
  },
}

export default function AmIRealLayout({ children }: { children: React.ReactNode }) {
  return children
}
