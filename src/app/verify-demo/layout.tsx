import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Deep-Check Verify Demo | Document Verification Pipeline',
  description: 'Live document verification demo — DINOv2 forensics + Gemma 4 AI analysis. Compare Xeon on-premise vs AWS GPU backends.',
}

export default function VerifyDemoLayout({ children }: { children: React.ReactNode }) {
  return children
}
