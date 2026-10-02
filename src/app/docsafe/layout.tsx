import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'DocSafe - Document Verification & Forensics',
  description: 'Verify document authenticity with AI-powered forensics. Detect tampered IDs, payslips, bank statements, and contracts using Error Level Analysis (ELA) and neural network AI detection. 100% private, runs in your browser.',
  keywords: ['document verification', 'document forensics', 'ELA analysis', 'tampered document detection', 'fake ID detector', 'document authenticity', 'EXIF analysis'],
  alternates: {
    canonical: 'https://deep-check-two.vercel.app/docsafe',
  },
  openGraph: {
    title: 'DocSafe - Document Verification & Forensics | Deep-Check',
    description: 'Verify document authenticity with AI. Detect tampered IDs, payslips, and contracts using ELA and neural network detection.',
    url: 'https://deep-check-two.vercel.app/docsafe',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DocSafe - Document Verification | Deep-Check',
    description: 'AI-powered document forensics. Detect tampered documents with ELA and neural network analysis. 100% private.',
  },
}

export default function DocSafeLayout({ children }: { children: React.ReactNode }) {
  return children
}
