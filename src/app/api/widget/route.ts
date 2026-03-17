/**
 * GET /api/widget?id=<certificateId>&theme=light|dark&size=sm|md|lg
 * ==================================================================
 *
 * Returns an SVG verification badge that can be embedded in any website.
 * The badge shows the verification verdict, certificate ID, and date.
 *
 * Usage:
 *   <img src="https://deep-check.io/api/widget?id=CERT_ID" />
 *   <iframe src="https://deep-check.io/embed/CERT_ID" width="350" height="140" />
 *
 * This is a read-only, public endpoint — no authentication required.
 * Badge is cached for 5 minutes (stale-while-revalidate).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

interface VerdictConfig {
  color: string
  bg: string
  textColor: string
  icon: string
  label: string
}

const VERDICT_CONFIGS: Record<string, VerdictConfig> = {
  authentic:  { color: '#00E5FF', bg: '#0a2a2f', textColor: '#E8EAED', icon: '✓', label: 'VERIFIED' },
  suspicious: { color: '#FFD700', bg: '#2a2510', textColor: '#E8EAED', icon: '⚠', label: 'SUSPICIOUS' },
  tampered:   { color: '#FF4D4D', bg: '#2a1010', textColor: '#E8EAED', icon: '✗', label: 'TAMPERED' },
}

const VERDICT_CONFIGS_LIGHT: Record<string, VerdictConfig> = {
  authentic:  { color: '#0094a8', bg: '#f0feff', textColor: '#1a1a1a', icon: '✓', label: 'VERIFIED' },
  suspicious: { color: '#b8860b', bg: '#fffef0', textColor: '#1a1a1a', icon: '⚠', label: 'SUSPICIOUS' },
  tampered:   { color: '#cc0000', bg: '#fff0f0', textColor: '#1a1a1a', icon: '✗', label: 'TAMPERED' },
}

function generateSVGBadge(
  verdict: string,
  certId: string,
  issuedDate: string,
  holderName: string | null,
  theme: 'dark' | 'light',
  size: 'sm' | 'md' | 'lg',
): string {
  const configs = theme === 'light' ? VERDICT_CONFIGS_LIGHT : VERDICT_CONFIGS
  const vc = configs[verdict] || configs.suspicious
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://deep-check.io'

  const dims = {
    sm: { w: 240, h: 80, fontSize: 10, titleSize: 12, padding: 12 },
    md: { w: 350, h: 110, fontSize: 12, titleSize: 14, padding: 16 },
    lg: { w: 450, h: 140, fontSize: 14, titleSize: 17, padding: 20 },
  }
  const d = dims[size]
  const borderColor = theme === 'light' ? '#ddd' : '#333'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.w}" height="${d.h}" viewBox="0 0 ${d.w} ${d.h}">
  <defs>
    <linearGradient id="topBar" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${vc.color};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:#7B2FBE;stop-opacity:1"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${d.w}" height="${d.h}" rx="8" fill="${vc.bg}" stroke="${borderColor}" stroke-width="1"/>

  <!-- Top accent bar -->
  <rect width="${d.w}" height="3" rx="8" fill="url(#topBar)"/>
  <rect x="0" y="3" width="${d.w}" height="1" fill="${vc.bg}"/>

  <!-- Deep-Check logo text -->
  <text x="${d.padding}" y="${d.padding + d.titleSize}" font-family="system-ui, -apple-system, sans-serif" font-size="${d.titleSize}" font-weight="800" fill="${vc.textColor}">
    Deep-Check<tspan fill="${vc.color}">.</tspan>
  </text>

  <!-- Verdict badge -->
  <rect x="${d.w - d.padding - 80}" y="${d.padding}" rx="4" width="80" height="${d.titleSize + 6}" fill="${vc.color}" opacity="0.15"/>
  <text x="${d.w - d.padding - 40}" y="${d.padding + d.titleSize - 1}" font-family="system-ui, sans-serif" font-size="${d.fontSize}" font-weight="800" fill="${vc.color}" text-anchor="middle">
    ${vc.icon} ${vc.label}
  </text>

  <!-- Certificate info -->
  <text x="${d.padding}" y="${d.padding + d.titleSize + 18}" font-family="system-ui, sans-serif" font-size="${d.fontSize - 1}" fill="${vc.textColor}" opacity="0.5">
    Certificate ID
  </text>
  <text x="${d.padding}" y="${d.padding + d.titleSize + 32}" font-family="monospace" font-size="${d.fontSize}" font-weight="600" fill="${vc.color}">
    ${certId.length > 24 ? certId.slice(0, 24) + '...' : certId}
  </text>

  ${holderName ? `
  <text x="${d.padding}" y="${d.padding + d.titleSize + 48}" font-family="system-ui, sans-serif" font-size="${d.fontSize - 1}" fill="${vc.textColor}" opacity="0.5">
    ${holderName}
  </text>` : ''}

  <!-- Footer -->
  <text x="${d.padding}" y="${d.h - d.padding + 2}" font-family="system-ui, sans-serif" font-size="${Math.max(8, d.fontSize - 3)}" fill="${vc.textColor}" opacity="0.35">
    Verified ${issuedDate} · ${baseUrl.replace('https://', '')}
  </text>

  <!-- Clickable link overlay -->
  <a href="${baseUrl}/verify/${certId}" target="_blank">
    <rect width="${d.w}" height="${d.h}" fill="transparent" cursor="pointer"/>
  </a>
</svg>`
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get('id')
  const theme = (req.nextUrl.searchParams.get('theme') || 'dark') as 'dark' | 'light'
  const size = (req.nextUrl.searchParams.get('size') || 'md') as 'sm' | 'md' | 'lg'

  if (!id) {
    // Return a placeholder badge
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="110">
      <rect width="350" height="110" rx="8" fill="#111" stroke="#333"/>
      <text x="175" y="55" font-family="system-ui" font-size="14" fill="#666" text-anchor="middle">Certificate ID required</text>
    </svg>`
    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=60',
      },
    })
  }

  const supabase = getClient()
  if (!supabase) {
    const svg = generateSVGBadge('suspicious', id, 'N/A', null, theme, size)
    return new NextResponse(svg, {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=60' },
    })
  }

  try {
    const { data: analysis } = await supabase
      .from('dc_document_analyses')
      .select('id, created_at, findings')
      .eq('id', id)
      .single()

    if (!analysis) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="110">
        <rect width="350" height="110" rx="8" fill="#1a0a0a" stroke="#333"/>
        <text x="175" y="50" font-family="system-ui" font-size="14" fill="#ff4d4d" text-anchor="middle" font-weight="700">Certificate Not Found</text>
        <text x="175" y="72" font-family="monospace" font-size="10" fill="#666" text-anchor="middle">${id}</text>
      </svg>`
      return new NextResponse(svg, {
        headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=60' },
      })
    }

    const findings = (analysis.findings ?? {}) as Record<string, unknown>
    const mrzFields = (findings.mrzFields ?? {}) as Record<string, string>
    const verdict = (findings.verdict as string) || 'suspicious'
    const issuedDate = new Date(analysis.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    const holderName = mrzFields.givenNames
      ? `${mrzFields.givenNames} ${mrzFields.surname || ''}`.trim()
      : null

    const svg = generateSVGBadge(verdict, analysis.id, issuedDate, holderName, theme, size)

    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    console.error('[widget] Error:', err)
    const svg = generateSVGBadge('suspicious', id, 'Error', null, theme, size)
    return new NextResponse(svg, {
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' },
    })
  }
}
