/**
 * Deep-Check · Next.js Edge Middleware
 *
 * ENS Controls implemented here:
 *   op.exp.2  — Configuración de seguridad (rate limiting)
 *   op.acc.5  — Mecanismo de autenticación (dashboard access control)
 *   op.exp.7  — Registro de actividad (structured request logging)
 *   mp.com.1  — Perímetro seguro (block unauthenticated admin access)
 */

import { NextRequest, NextResponse } from 'next/server'

// ─── Rate limiting (in-memory per Edge instance) ─────────────────────────────
// ENS op.exp.2: Configuración de seguridad
// Limits: 100 req/min general, 20 req/min for auth/sensitive endpoints

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

const LIMITS: Record<string, number> = {
    '/api/ml-score':           20,  // ML inference — expensive
    '/api/enrollment':         10,  // biometric enrollment
    '/api/documents':          30,  // forensic analysis
    '/api/auth':               5,   // auth attempts — strict
    'default':                 100, // general limit per minute
}

function getRateLimit(pathname: string): number {
    for (const [prefix, limit] of Object.entries(LIMITS)) {
        if (pathname.startsWith(prefix)) return limit
    }
    return LIMITS.default
}

function checkRateLimit(ip: string, pathname: string): boolean {
    const key   = `${ip}:${pathname.split('/').slice(0, 3).join('/')}`
    const limit = getRateLimit(pathname)
    const now   = Date.now()
    const entry = rateLimitMap.get(key)

    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(key, { count: 1, resetAt: now + 60_000 })
        return true // allowed
    }
    if (entry.count >= limit) return false // rate limited
    entry.count++
    return true
}

// ─── IP extraction ────────────────────────────────────────────────────────────

function getIP(req: NextRequest): string {
    return (
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        req.headers.get('x-real-ip') ??
        'unknown'
    )
}

// ─── Admin session check ──────────────────────────────────────────────────────
// ENS op.acc.5: Mecanismo de autenticación
// Dashboard requires a valid admin session cookie

function isAdminAuthenticated(req: NextRequest): boolean {
    const token = req.cookies.get('dc_admin_session')?.value
    if (!token) return false
    // Token format: "dc_admin_<random>" — actual validation happens in the auth API
    // Middleware only checks for presence and basic format to avoid DB calls at edge
    return token.startsWith('dc_admin_') && token.length > 20
}

// ─── Structured logging ───────────────────────────────────────────────────────
// ENS op.exp.7: Registro de la actividad
// Logs to console in JSON (captured by Vercel log aggregation)

function logRequest(req: NextRequest, status: number, note?: string) {
    const entry = {
        ts:       new Date().toISOString(),
        method:   req.method,
        path:     req.nextUrl.pathname,
        status,
        ip:       getIP(req).replace(/\.\d+$/, '.***'),  // partial anonymisation
        ua:       req.headers.get('user-agent')?.slice(0, 80) ?? '',
        note,
    }
    // Vercel captures console.log as structured logs
    console.log(JSON.stringify({ type: 'access_log', ...entry }))
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl
    const ip = getIP(req)

    // ── 1. Dashboard auth guard ───────────────────────────────────────────────
    if (pathname.startsWith('/dashboard') && !pathname.startsWith('/dashboard/login')) {
        if (!isAdminAuthenticated(req)) {
            logRequest(req, 302, 'auth_redirect')
            const loginUrl = new URL('/dashboard/login', req.url)
            loginUrl.searchParams.set('from', pathname)
            return NextResponse.redirect(loginUrl)
        }
    }

    // ── 2. Rate limiting ──────────────────────────────────────────────────────
    if (pathname.startsWith('/api/')) {
        if (!checkRateLimit(ip, pathname)) {
            logRequest(req, 429, 'rate_limited')
            return new NextResponse(
                JSON.stringify({
                    error: 'Too many requests',
                    retryAfter: 60,
                    ens: 'op.exp.2'  // ENS control reference
                }),
                {
                    status: 429,
                    headers: {
                        'Content-Type':  'application/json',
                        'Retry-After':   '60',
                        'X-RateLimit-Limit': String(getRateLimit(pathname)),
                    },
                }
            )
        }
    }

    // ── 3. Add security headers to all responses ──────────────────────────────
    const res = NextResponse.next()

    // Correlate requests for audit trail
    const requestId = crypto.randomUUID()
    res.headers.set('X-Request-ID', requestId)

    // ── 4. Log access ─────────────────────────────────────────────────────────
    if (pathname.startsWith('/api/')) {
        logRequest(req, 200)
    }

    return res
}

export const config = {
    matcher: [
        // Apply to all API routes and dashboard
        '/api/:path*',
        '/dashboard/:path*',
        '/dashboard',
    ],
}
