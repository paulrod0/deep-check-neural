import type { MetadataRoute } from 'next'

const BASE_URL = 'https://deep-check-two.vercel.app'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date().toISOString()

  const routes = [
    { path: '/', priority: 1.0, changeFrequency: 'weekly' as const },
    { path: '/amireal', priority: 0.9, changeFrequency: 'weekly' as const },
    { path: '/datesafe', priority: 0.9, changeFrequency: 'weekly' as const },
    { path: '/docsafe', priority: 0.9, changeFrequency: 'weekly' as const },
    { path: '/listingcheck', priority: 0.8, changeFrequency: 'weekly' as const },
    { path: '/proofshot', priority: 0.8, changeFrequency: 'weekly' as const },
    { path: '/resumeguard', priority: 0.8, changeFrequency: 'weekly' as const },
    { path: '/trustmyprofile', priority: 0.8, changeFrequency: 'weekly' as const },
    { path: '/pricing', priority: 0.9, changeFrequency: 'monthly' as const },
    { path: '/developers', priority: 0.7, changeFrequency: 'monthly' as const },
    { path: '/training', priority: 0.5, changeFrequency: 'monthly' as const },
    { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' as const },
    { path: '/terms', priority: 0.3, changeFrequency: 'yearly' as const },
    { path: '/security', priority: 0.3, changeFrequency: 'yearly' as const },
  ]

  return routes.map((route) => ({
    url: `${BASE_URL}${route.path}`,
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))
}
