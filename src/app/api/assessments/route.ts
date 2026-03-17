import { NextRequest, NextResponse } from 'next/server';
import { getAssessments, saveAssessment, Assessment } from '@/lib/db';
import { writeAuditLog, extractIP } from '@/lib/auditLog'
import { validateAdminSession } from '@/lib/adminAuth'
import { getOrgFromSession } from '@/lib/auth'
import { checkSessionLimit, incrementSessionUsage } from '@/lib/planLimits'

export async function GET(req: NextRequest) {
    if (!await validateAdminSession(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const assessments = await getAssessments();
    void writeAuditLog({
        eventType: 'data_access',
        endpoint: '/api/assessments',
        method: 'GET',
        ip: extractIP(req.headers),
        statusCode: 200,
    })
    return NextResponse.json(assessments);
}

export async function POST(req: NextRequest) {
    const t0 = Date.now()
    const ip = extractIP(req.headers)

    // Auth required — admin session or org session
    const org = await getOrgFromSession(req)
    if (!org && !await validateAdminSession(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Plan gating: check session limit for org users ──
    if (org) {
        const { allowed, used, limit } = await checkSessionLimit(org.id)
        if (!allowed) {
            return NextResponse.json({
                error: 'Límite del plan alcanzado',
                detail: `Has usado ${used}/${limit} sesiones este mes. Actualiza a Pro para sesiones ilimitadas.`,
                upgradeUrl: '/pricing',
            }, { status: 403 })
        }
    }

    try {
        const assessment: Assessment = await req.json();
        await saveAssessment(assessment);
        // Track usage for org
        if (org) void incrementSessionUsage(org.id)
        void writeAuditLog({
            eventType: 'assessment_saved',
            endpoint: '/api/assessments',
            method: 'POST',
            ip,
            statusCode: 200,
            durationMs: Date.now() - t0,
            details: { candidateName: assessment.candidateName, id: assessment.id },
        })
        return NextResponse.json({ success: true });
    } catch (error) {
        void writeAuditLog({
            eventType: 'error',
            endpoint: '/api/assessments',
            method: 'POST',
            ip,
            statusCode: 400,
            durationMs: Date.now() - t0,
        })
        return NextResponse.json({ success: false, error: 'Invalid data' }, { status: 400 });
    }
}
