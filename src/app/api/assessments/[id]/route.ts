import { NextRequest, NextResponse } from 'next/server';
import { getAssessments, saveAssessment, initDb } from '@/lib/db';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    await initDb();
    const { id } = await params;
    const assessments = await getAssessments();
    const assessment = assessments.find((a) => a.id === id);

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
    await initDb();
    const { id } = await params;
    const body = await request.json();

    const assessments = await getAssessments();
    const assessment = assessments.find((a) => a.id === id);

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
