import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ListingCheck - Listing Photo Verification',
  description: 'Detect AI-generated real estate photos and virtual staging. Verify property listing photos from Airbnb, Zillow, Idealista, and Rightmove. Upload up to 5 photos for batch AI analysis. 100% private, runs in your browser.',
  keywords: ['listing photo verification', 'AI real estate photos', 'virtual staging detector', 'fake listing detection', 'airbnb photo verification', 'property photo AI check'],
  alternates: {
    canonical: 'https://deep-check-two.vercel.app/listingcheck',
  },
  openGraph: {
    title: 'ListingCheck - Listing Photo Verification | Deep-Check',
    description: 'Detect AI-generated real estate photos and virtual staging. Verify property listings with AI analysis.',
    url: 'https://deep-check-two.vercel.app/listingcheck',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ListingCheck - Listing Photo Verification | Deep-Check',
    description: 'Detect AI-generated real estate photos. Verify property listings with neural network analysis.',
  },
}

export default function ListingCheckLayout({ children }: { children: React.ReactNode }) {
  return children
}
