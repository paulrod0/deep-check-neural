'use client'

import { useEffect } from 'react'

/**
 * PWARegister — Service Worker registration + install prompt handling
 * Placed in root layout, runs once on mount.
 */
export default function PWARegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(err => console.warn('[SW] Registration failed:', err))
    }
  }, [])

  return null
}
