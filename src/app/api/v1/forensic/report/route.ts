/**
 * POST /api/v1/forensic/report
 *
 * Generate a UNE 197010:2015 compliant informe pericial as PDF.
 * The chain must be sealed first via /api/v1/forensic/seal (or equivalent).
 *
 * Body (JSON):
 *   {
 *     perito: { nombre, dni, colegio, colegiado, titulacion, ... },
 *     dictamen: { caseRef, juzgado?, tipoProcedimiento?, solicitante, preguntas[] },
 *     analysis: { chainId, modelName, modelVersion, modelHash, result, inferenceMs },
 *     conclusiones: [{ pregunta, respuesta, fundamento }],
 *     peritoObservaciones?: string
 *   }
 *
 * Returns: application/pdf
 */
import { NextRequest, NextResponse } from 'next/server'
import { generatePericialPDF, type ReportInput } from '@/lib/pericialReport'
import { sealChain } from '@/lib/forensicChain'
import { requireApiKey, ForensicAuthError } from '@/lib/forensicAuth'

export async function POST(req: NextRequest) {
  try {
    // Auth first — sealing and PDF gen are expensive, gate them.
    const auth = await requireApiKey(req)

    const body = (await req.json()) as ReportInput & { autoSeal?: boolean }
    if (!body.perito || !body.dictamen || !body.analysis || !body.conclusiones) {
      return NextResponse.json(
        { error: 'missing_fields', message: 'perito, dictamen, analysis, conclusiones are required' },
        { status: 400 }
      )
    }

    // Auto-seal the chain before generating the report (default true).
    // Sealing actor is the API key name so the chain audit is consistent.
    if (body.autoSeal !== false) {
      try {
        await sealChain(auth.actor, body.analysis.chainId)
      } catch {
        // Already sealed — ignore
      }
    }

    const pdf = await generatePericialPDF(body)
    return new NextResponse(pdf as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="informe_pericial_${body.dictamen.caseRef.replace(/[^\w.-]/g, '_')}.pdf"`,
        'X-Chain-Id': body.analysis.chainId,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    if (e instanceof ForensicAuthError) {
      return NextResponse.json({ error: 'unauthorized', message: e.message }, { status: e.status })
    }
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'report_failed', message: msg }, { status: 500 })
  }
}

export const runtime = 'nodejs'
export const maxDuration = 60
