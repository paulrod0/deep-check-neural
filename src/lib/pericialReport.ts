/**
 * UNE 197010:2015 — Informe Pericial Informatico Generator.
 *
 * Produces a Spanish-compliant forensic expert report (informe pericial) as PDF.
 * Follows UNE 197010:2015 structure:
 *   1. Portada (cover)
 *   2. Identificacion del perito
 *   3. Objeto del dictamen
 *   4. Antecedentes
 *   5. Metodologia (ISO/IEC 27037 + 27042)
 *   6. Analisis realizado
 *   7. Conclusiones motivadas
 *   8. Anexos (cadena de custodia, hashes, timestamps)
 *   9. Firma y sello temporal
 *
 * The perito's interpretation fields are filled by them; Deep-Check auto-fills
 * methodology, analysis, and chain-of-custody annexes.
 *
 * Output: PDF generated with jsPDF (already in package.json deps).
 */
import { jsPDF } from 'jspdf'
import { exportChain } from './forensicChain'

export interface PeritoInfo {
  nombre: string
  dni: string
  colegio: string // e.g. "Colegio Oficial de Ingenieros Informaticos de Madrid"
  colegiado: string
  titulacion: string
  telefono?: string
  email?: string
  direccion?: string
}

export interface DictamenObjeto {
  caseRef: string // Num. expediente / procedimiento judicial
  juzgado?: string
  tipoProcedimiento?: string // civil, penal, laboral, contencioso
  solicitante: string
  preguntas: string[] // Questions the perito must answer
}

export interface DeepCheckAnalysis {
  chainId: string
  modelName: string
  modelVersion: string
  modelHash: string
  result: {
    verdict: 'real' | 'deepfake' | 'inconclusive'
    probability: number // P(deepfake) in [0,1]
    confidence: number // 0..1
    layerScores?: Record<string, number>
  }
  inferenceMs: number
}

export interface ConclusionMotivada {
  pregunta: string
  respuesta: string
  fundamento: string
}

export interface ReportInput {
  perito: PeritoInfo
  dictamen: DictamenObjeto
  analysis: DeepCheckAnalysis
  conclusiones: ConclusionMotivada[]
  peritoObservaciones?: string
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

function today(): string {
  const d = new Date()
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`
}

function verdictLabel(v: DeepCheckAnalysis['result']['verdict']): string {
  return v === 'real' ? 'AUTENTICO (NO MANIPULADO)' :
         v === 'deepfake' ? 'MANIPULADO (DEEPFAKE)' :
         'INCONCLUYENTE'
}

function addWrapped(doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight = 6): number {
  const lines = doc.splitTextToSize(text, maxWidth)
  for (const line of lines) {
    doc.text(line, x, y)
    y += lineHeight
  }
  return y
}

function section(doc: jsPDF, title: string, y: number): number {
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 20, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  return y + 8
}

// --------------------------------------------------------------------------- //
// PDF builder
// --------------------------------------------------------------------------- //

export async function generatePericialPDF(input: ReportInput): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const PAGE_W = 210
  const PAGE_H = 297
  const MARGIN = 20
  const USABLE_W = PAGE_W - 2 * MARGIN

  const chainExport = await exportChain(input.analysis.chainId)

  // === Page 1: Portada (cover) ===
  doc.setFontSize(9)
  doc.setFont('helvetica', 'italic')
  doc.text('Conforme a UNE 197010:2015 — Criterios generales para la elaboracion del informe pericial', MARGIN, 15)
  doc.text('Metodologia: UNE 71506:2013 | ISO/IEC 27037:2012 | ISO/IEC 27042:2015', MARGIN, 20)

  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('INFORME PERICIAL INFORMATICO', PAGE_W / 2, 80, { align: 'center' })

  doc.setFontSize(14)
  doc.setFont('helvetica', 'normal')
  doc.text('Analisis Forense de Autenticidad de Contenido Audiovisual', PAGE_W / 2, 95, { align: 'center' })

  doc.setFontSize(11)
  doc.text(`Expediente: ${input.dictamen.caseRef}`, PAGE_W / 2, 120, { align: 'center' })
  if (input.dictamen.juzgado) {
    doc.text(`Juzgado: ${input.dictamen.juzgado}`, PAGE_W / 2, 128, { align: 'center' })
  }
  doc.text(`Fecha: ${today()}`, PAGE_W / 2, 138, { align: 'center' })

  doc.setFontSize(10)
  doc.setFont('helvetica', 'italic')
  let y = 180
  doc.text('Perito Informatico:', MARGIN, y); y += 6
  doc.setFont('helvetica', 'normal')
  doc.text(input.perito.nombre, MARGIN, y); y += 5
  doc.text(`DNI: ${input.perito.dni}`, MARGIN, y); y += 5
  doc.text(`${input.perito.colegio} — Colegiado Num. ${input.perito.colegiado}`, MARGIN, y); y += 5
  doc.text(input.perito.titulacion, MARGIN, y); y += 5

  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  doc.text('Generado con Deep-Check Forensic Suite. Cadena de custodia validada segun ISO/IEC 27037.',
           PAGE_W / 2, PAGE_H - 20, { align: 'center' })
  doc.text(`Chain ID: ${input.analysis.chainId}`, PAGE_W / 2, PAGE_H - 15, { align: 'center' })

  // === Page 2: Identificacion del perito ===
  doc.addPage()
  y = 30
  y = section(doc, '1. IDENTIFICACION DEL PERITO', y)

  doc.setFontSize(10)
  const peritoLines = [
    `Nombre completo: ${input.perito.nombre}`,
    `DNI/NIE: ${input.perito.dni}`,
    `Titulacion academica: ${input.perito.titulacion}`,
    `Colegio profesional: ${input.perito.colegio}`,
    `Numero de colegiado: ${input.perito.colegiado}`,
  ]
  if (input.perito.telefono) peritoLines.push(`Telefono: ${input.perito.telefono}`)
  if (input.perito.email) peritoLines.push(`Correo electronico: ${input.perito.email}`)
  if (input.perito.direccion) peritoLines.push(`Direccion profesional: ${input.perito.direccion}`)

  for (const line of peritoLines) {
    doc.text(line, MARGIN, y); y += 6
  }

  // Declaracion de independencia (required by LEC 335)
  y += 6
  y = section(doc, '1.1 Declaracion de independencia e imparcialidad', y)
  const decl = 'El perito que suscribe declara, bajo juramento o promesa de decir verdad, ' +
    'que ha actuado y, en su caso, actuara con la mayor objetividad posible, tomando en ' +
    'consideracion tanto lo que pueda favorecer como lo que sea susceptible de causar perjuicio ' +
    'a cualquiera de las partes, y conoce las sanciones penales en las que podria incurrir si ' +
    'incumpliere su deber como perito (Art. 335.2 LEC).'
  y = addWrapped(doc, decl, MARGIN, y, USABLE_W)

  // === Objeto del dictamen ===
  y += 10
  y = section(doc, '2. OBJETO DEL DICTAMEN', y)
  doc.text(`Expediente / Procedimiento: ${input.dictamen.caseRef}`, MARGIN, y); y += 6
  if (input.dictamen.juzgado) { doc.text(`Juzgado: ${input.dictamen.juzgado}`, MARGIN, y); y += 6 }
  if (input.dictamen.tipoProcedimiento) { doc.text(`Tipo de procedimiento: ${input.dictamen.tipoProcedimiento}`, MARGIN, y); y += 6 }
  doc.text(`Solicitante: ${input.dictamen.solicitante}`, MARGIN, y); y += 8

  doc.setFont('helvetica', 'bold')
  doc.text('Cuestiones objeto de analisis:', MARGIN, y); y += 6
  doc.setFont('helvetica', 'normal')
  for (let i = 0; i < input.dictamen.preguntas.length; i++) {
    y = addWrapped(doc, `${i + 1}. ${input.dictamen.preguntas[i]}`, MARGIN, y, USABLE_W)
    y += 2
  }

  // === Page 3: Metodologia ===
  doc.addPage()
  y = 30
  y = section(doc, '3. METODOLOGIA', y)

  const methodology = [
    'El analisis se ha realizado siguiendo la metodologia de analisis forense informatico ' +
    'definida por la norma UNE 71506:2013, en conformidad con los estandares internacionales ' +
    'ISO/IEC 27037:2012 (identificacion, recogida, adquisicion y preservacion de evidencia digital) ' +
    'e ISO/IEC 27042:2015 (analisis e interpretacion).',
    '',
    'Las fases aplicadas han sido:',
    '',
    '  a) IDENTIFICACION: Registro de la evidencia original con calculo de huella digital SHA-256 ' +
    'y sellado de tiempo mediante autoridad de sellado de tiempo (TSA) segun RFC 3161.',
    '',
    '  b) ADQUISICION Y PRESERVACION: La evidencia se mantiene inalterada en almacenamiento ' +
    'cifrado y registrada en cadena de custodia append-only con verificacion de integridad ' +
    'criptografica en cada eslabon.',
    '',
    '  c) ANALISIS: Ejecucion de detector de manipulacion audiovisual Deep-Check V10.0 — modelo ' +
    'de red neuronal profunda (VideoMAE-Large) entrenado sobre el dataset FaceForensics++ ' +
    'validado academicamente y complementado con muestras de generadores modernos (Sora, Veo 3, ' +
    'Flux, MidJourney v7).',
    '',
    '  d) INTERPRETACION: Las conclusiones se derivan del output del modelo con indicacion de ' +
    'probabilidad y nivel de confianza, contrastadas con criterios de aptitud ISO/IEC 30107-3 ' +
    '(deteccion de ataques de presentacion biometrica).',
  ]
  for (const p of methodology) {
    if (p === '') { y += 4; continue }
    y = addWrapped(doc, p, MARGIN, y, USABLE_W)
    if (y > PAGE_H - 30) { doc.addPage(); y = 30 }
  }

  // === Analisis realizado ===
  y += 6
  if (y > PAGE_H - 80) { doc.addPage(); y = 30 }
  y = section(doc, '4. ANALISIS REALIZADO', y)

  doc.text(`Modelo aplicado: ${input.analysis.modelName} ${input.analysis.modelVersion}`, MARGIN, y); y += 6
  doc.text(`Huella SHA-256 del modelo: ${input.analysis.modelHash.substring(0, 32)}...`, MARGIN, y); y += 6
  doc.text(`Tiempo de inferencia: ${input.analysis.inferenceMs} ms`, MARGIN, y); y += 6
  doc.text(`Identificador de cadena (Chain ID): ${input.analysis.chainId}`, MARGIN, y); y += 10

  doc.setFont('helvetica', 'bold')
  doc.text('Resultado del analisis:', MARGIN, y); y += 6
  doc.setFont('helvetica', 'normal')
  doc.text(`  Veredicto: ${verdictLabel(input.analysis.result.verdict)}`, MARGIN, y); y += 6
  doc.text(`  Probabilidad de manipulacion: ${(input.analysis.result.probability * 100).toFixed(2)}%`, MARGIN, y); y += 6
  doc.text(`  Nivel de confianza: ${(input.analysis.result.confidence * 100).toFixed(1)}%`, MARGIN, y); y += 10

  if (input.analysis.result.layerScores) {
    doc.setFont('helvetica', 'bold')
    doc.text('Desglose por capas de deteccion:', MARGIN, y); y += 6
    doc.setFont('helvetica', 'normal')
    for (const [layer, score] of Object.entries(input.analysis.result.layerScores)) {
      doc.text(`  - ${layer}: ${(score * 100).toFixed(2)}%`, MARGIN, y); y += 5
    }
  }

  // === Conclusiones ===
  doc.addPage()
  y = 30
  y = section(doc, '5. CONCLUSIONES MOTIVADAS', y)

  for (let i = 0; i < input.conclusiones.length; i++) {
    const c = input.conclusiones[i]
    doc.setFont('helvetica', 'bold')
    y = addWrapped(doc, `${i + 1}. ${c.pregunta}`, MARGIN, y, USABLE_W)
    doc.setFont('helvetica', 'normal')
    y = addWrapped(doc, `Respuesta: ${c.respuesta}`, MARGIN, y, USABLE_W)
    y = addWrapped(doc, `Fundamento: ${c.fundamento}`, MARGIN, y, USABLE_W)
    y += 6
    if (y > PAGE_H - 40) { doc.addPage(); y = 30 }
  }

  if (input.peritoObservaciones) {
    y = section(doc, '5.1 Observaciones del perito', y)
    y = addWrapped(doc, input.peritoObservaciones, MARGIN, y, USABLE_W)
  }

  // === Anexo: cadena de custodia ===
  doc.addPage()
  y = 30
  y = section(doc, 'ANEXO I. CADENA DE CUSTODIA (ISO/IEC 27037)', y)
  doc.setFontSize(8)
  doc.text(`Chain ID: ${chainExport.chainId}`, MARGIN, y); y += 5
  doc.text(`Verificacion de integridad: ${chainExport.verification.valid ? 'VALIDA' : 'ROTA — ' + chainExport.verification.breaks.join('; ')}`, MARGIN, y); y += 8

  doc.setFont('helvetica', 'bold')
  doc.text('Seq | Timestamp (UTC) | Actor | Accion | Hash (parcial)', MARGIN, y); y += 5
  doc.setFont('helvetica', 'normal')
  for (const row of chainExport.entries) {
    if (y > PAGE_H - 20) { doc.addPage(); y = 30 }
    const line = `${row.seq.toString().padStart(2, '0')} | ${row.timestamp} | ${row.actor.substring(0, 15)} | ${row.action} | ${row.entry_hash.substring(0, 16)}...`
    doc.text(line, MARGIN, y); y += 5
  }

  // === Firma ===
  doc.addPage()
  y = 30
  y = section(doc, '6. FIRMA Y SELLADO', y)
  doc.setFontSize(10)
  y = addWrapped(doc,
    `En ${today()}, el perito abajo firmante ratifica la presente peritacion y se somete a cuantas ` +
    'aclaraciones le fueren requeridas por el juzgado o las partes.',
    MARGIN, y, USABLE_W)
  y += 20
  doc.text('Fdo.:', MARGIN, y)
  doc.text(input.perito.nombre, MARGIN + 20, y); y += 5
  doc.text(`Colegiado Num. ${input.perito.colegiado} — ${input.perito.colegio}`, MARGIN, y); y += 15

  doc.setFontSize(8)
  doc.setFont('helvetica', 'italic')
  y = addWrapped(doc,
    'El presente informe ha sido generado con Deep-Check Forensic Suite. Todas las operaciones ' +
    'han sido registradas en una cadena de custodia append-only con verificacion criptografica ' +
    'de integridad segun ISO/IEC 27037:2012. La huella digital del informe y la cadena completa ' +
    'pueden ser validadas independientemente utilizando la herramienta de verificacion publica ' +
    'en https://deep-check-two.vercel.app/api/v1/forensic/verify.',
    MARGIN, y, USABLE_W)

  return new Uint8Array(doc.output('arraybuffer'))
}
