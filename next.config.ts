import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent clickjacking
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Prevent MIME sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // XSS protection (legacy browsers)
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  // Referrer policy — don't leak full URL to third parties
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Permissions policy — disable sensors not used by the app
  {
    key: 'Permissions-Policy',
    value: [
      'camera=(self)',          // only our origin can request camera
      'microphone=()',          // never needed
      'geolocation=()',         // never needed
      'payment=()',             // never needed
      'usb=()',                 // never needed
      'accelerometer=()',
      'gyroscope=()',
    ].join(', '),
  },
  // HSTS — force HTTPS for 1 year (Vercel handles TLS, this is belt-and-suspenders)
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  // Content Security Policy
  // face-api.js loads ONNX models from /public — blob: needed for canvas operations
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Scripts: self + inline (Next.js requires this) + blob: (ONNX wasm)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
      // Styles: self + inline (CSS-in-JS / modules)
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Images: self + data: (canvas thumbnails / ELA) + blob:
      "img-src 'self' data: blob:",
      // Fonts
      "font-src 'self' https://fonts.gstatic.com",
      // Connections: self (API routes) + Supabase
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co`,
      // Media: camera stream
      "media-src 'self' blob:",
      // Workers: face-api wasm workers
      "worker-src 'self' blob:",
      // Object/embed: none
      "object-src 'none'",
      // Base URI: self only
      "base-uri 'self'",
      // Form action: self only
      "form-action 'self'",
      // Frame ancestors: none (reinforces X-Frame-Options)
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  // Required for Docker standalone deployment (node server.js)
  output: 'standalone',
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
  // Strict mode for better React hygiene
  reactStrictMode: true,
}

export default nextConfig;
