import { NextRequest, NextResponse } from 'next/server';
import { getAssessments, saveAssessment, Assessment } from '@/lib/db';
import { writeAuditLog, extractIP } from '@/lib/auditLog'

export async function GET(req: NextRequest) {
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
    try {
        const assessment: Assessment = await req.json();
        await saveAssessment(assessment);
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
