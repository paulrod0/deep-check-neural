import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Model Training Dashboard',
  description: 'Deep-Check model training dashboard. Monitor real-time training metrics, loss curves, AUC, and EER for deepfake detection models.',
  alternates: {
    canonical: 'https://deep-check-two.vercel.app/training',
  },
  robots: {
    index: false,
    follow: false,
  },
}

export default function TrainingLayout({ children }: { children: React.ReactNode }) {
  return children
}
