import { NextRequest, NextResponse } from 'next/server';
import { getAssessmentByIdUnscoped, saveAssessment } from '@/lib/db';
import { validateAdminSession } from '@/lib/adminAuth';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!await validateAdminSession(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const assessment = await getAssessmentByIdUnscoped(id);

    if (!assessment) {
        return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });
    }

    return NextResponse.json(assessment);
}

// PATCH /api/assessments/:id — update status (approve / flag)
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!await validateAdminSession(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const body = await request.json();

    const assessment = await getAssessmentByIdUnscoped(id);

    if (!assessment) {
        return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });
    }

    // Only allow updating status and a review note
    if (body.status && ['passed', 'review', 'flagged'].includes(body.status)) {
        assessment.status = body.status;
    }
    if (body.reviewNote) {
        assessment.alerts = [
            `[Manual Review] ${body.reviewNote}`,
            ...assessment.alerts
        ];
    }

    await saveAssessment(assessment);
    return NextResponse.json({ success: true, assessment });
}
