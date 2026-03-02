/**
 * Deep-Check Public API v1 — API Key Management
 *
 * POST /api/v1/keys   — Create a new API key (admin only)
 * GET  /api/v1/keys   — List all API keys
 *
 * Protected by admin session cookie (dc_admin_session).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createApiKey, getApiKeysList } from '@/lib/db'
import { validateAdminSession } from '@/lib/adminAuth'

function cors(res: NextResponse) {
    res.headers.set('Access-Control-Allow-Origin', '*')
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    return res
}

export async function OPTIONS() {
    return cors(new NextResponse(null, { status: 204 }))
}

export async function GET(req: NextRequest) {
    if (!await validateAdminSession(req)) {
        return cors(NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }))
    }

    const keys = await getApiKeysList()
    // Mask key values for security
    const masked = keys.map(k => ({
        ...k,
        key: k.key.slice(0, 12) + '...' + k.key.slice(-4),
    }))

    return cors(NextResponse.json({ success: true, data: masked }))
}

export async function POST(req: NextRequest) {
    if (!await validateAdminSession(req)) {
        return cors(NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }))
    }

    try {
        const { name, permissions = ['read', 'write'], webhookUrl } = await req.json()
        if (!name) {
            return cors(NextResponse.json({ success: false, error: 'name is required' }, { status: 400 }))
        }

        const apiKey = await createApiKey(name, permissions, webhookUrl)
        return cors(NextResponse.json({
            success: true,
            data: apiKey,
            note: 'Save this key — it will not be shown again in full',
        }, { status: 201 }))
    } catch {
        return cors(NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 }))
    }
}
