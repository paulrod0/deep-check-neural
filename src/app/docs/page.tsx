'use client'

import React, { useState } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'sessions' | 'enrollment' | 'webhooks' | 'keys'

const BASE_URL = 'https://deep-check-two.vercel.app'

// ─── Code block ───────────────────────────────────────────────────────────────

function Code({ children, lang = 'json' }: { children: string; lang?: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <div style={{ position: 'relative', marginBottom: '20px' }}>
            <button
                onClick={() => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                style={{ position: 'absolute', top: '10px', right: '12px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '0.72rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}
            >
                {copied ? '✓ Copied' : 'Copy'}
            </button>
            <pre style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '16px', fontSize: '0.8rem', overflowX: 'auto', lineHeight: 1.6, margin: 0, color: '#cdd6f4', fontFamily: 'monospace' }}>
                {children}
            </pre>
        </div>
    )
}

function Endpoint({ method, path, desc }: { method: string; path: string; desc: string }) {
    const color = method === 'GET' ? '#89b4fa' : method === 'POST' ? 'var(--color-primary)' : method === 'PATCH' ? '#ffd700' : '#f38ba8'
    return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', marginBottom: '10px', border: '1px solid var(--color-border)' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', fontWeight: 700, color, minWidth: '48px', paddingTop: '1px' }}>{method}</span>
            <div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', marginBottom: '3px' }}>{path}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{desc}</div>
            </div>
        </div>
    )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DocsPage() {
    const [tab, setTab] = useState<Tab>('overview')

    const tabs: { id: Tab; label: string }[] = [
        { id: 'overview',   label: 'Overview' },
        { id: 'sessions',   label: 'Sessions API' },
        { id: 'enrollment', label: 'Enrollment API' },
        { id: 'webhooks',   label: 'Webhooks' },
        { id: 'keys',       label: 'API Keys' },
    ]

    return (
        <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex' }}>
            {/* Sidebar nav */}
            <nav style={{ width: '220px', flexShrink: 0, borderRight: '1px solid var(--color-border)', padding: '32px 0', position: 'sticky', top: 0, height: '100vh' }}>
                <div style={{ padding: '0 24px 24px', borderBottom: '1px solid var(--color-border)', marginBottom: '16px' }}>
                    <Link href="/" style={{ textDecoration: 'none' }}>
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)' }}>Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span></div>
                    </Link>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>API Reference v1</div>
                </div>
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} style={{
                        display: 'block', width: '100%', padding: '9px 24px', textAlign: 'left',
                        background: tab === t.id ? 'rgba(0,212,127,0.08)' : 'transparent',
                        borderLeft: `3px solid ${tab === t.id ? 'var(--color-primary)' : 'transparent'}`,
                        border: 'none', color: tab === t.id ? 'var(--color-primary)' : 'var(--color-text-muted)',
                        fontSize: '0.87rem', cursor: 'pointer', fontWeight: tab === t.id ? 600 : 400,
                        transition: 'all 0.15s',
                    }}>
                        {t.label}
                    </button>
                ))}
                <div style={{ padding: '24px 24px 0', marginTop: 'auto' }}>
                    <Link href="/dashboard/settings" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textDecoration: 'none', display: 'block', marginBottom: '8px' }}>⚙ Gestionar Keys</Link>
                    <Link href="/dashboard" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textDecoration: 'none' }}>← Dashboard</Link>
                </div>
            </nav>

            {/* Content */}
            <main style={{ flex: 1, padding: '48px 52px', maxWidth: '860px', overflowY: 'auto' }}>

                {tab === 'overview' && (
                    <>
                        <h1 style={{ fontSize: '2rem', marginBottom: '8px' }}>Deep-Check API</h1>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '32px', lineHeight: 1.7 }}>
                            La API de Deep-Check permite a plataformas externas (LMS, ATS, CMS, sistemas legales) integrarse con el motor de verificación biométrica. Puedes crear sesiones, consultar resultados, gestionar perfiles de enrollment y recibir notificaciones en tiempo real via webhooks.
                        </p>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Arquitectura</h2>
                        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', padding: '20px', border: '1px solid var(--color-border)', marginBottom: '28px', fontSize: '0.85rem', lineHeight: 1.8, color: 'var(--color-text-muted)' }}>
                            <p style={{ margin: '0 0 10px 0', color: 'var(--color-text)' }}>🖥️ <strong>Dónde corre Deep-Check</strong></p>
                            <p style={{ margin: '0 0 8px 0' }}>• <strong style={{ color: 'var(--color-text)' }}>Frontend:</strong> React 19 en el navegador del candidato. Toda la biometría (keystroke dynamics, face-api, gaze tracking) se procesa <em>100% en el cliente</em> — ningún audio ni vídeo sale del navegador.</p>
                            <p style={{ margin: '0 0 8px 0' }}>• <strong style={{ color: 'var(--color-text)' }}>API:</strong> Next.js serverless functions en Vercel (edge network global). Latencia &lt;50ms desde Europa/US.</p>
                            <p style={{ margin: '0 0 8px 0' }}>• <strong style={{ color: 'var(--color-text)' }}>Storage:</strong> JSON file-based (MVP). Migratable a PostgreSQL/Supabase para producción.</p>
                            <p style={{ margin: 0 }}>• <strong style={{ color: 'var(--color-text)' }}>Modelos ML:</strong> TinyFaceDetector + FaceLandmark68Net — descargados en el navegador del candidato, nunca en el servidor.</p>
                        </div>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Base URL</h2>
                        <Code lang="bash">{`${BASE_URL}/api/v1`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Autenticación</h2>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '12px', fontSize: '0.88rem' }}>
                            Todas las peticiones deben incluir el header <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>Authorization</code> con una API key válida:
                        </p>
                        <Code lang="bash">{`Authorization: Bearer dc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Formato de respuesta</h2>
                        <Code>{`{
  "success": true,
  "data": { ... },
  "meta": { "total": 42, "page": 1, "limit": 20, "pages": 3 }
}

// En caso de error:
{
  "success": false,
  "error": "Descripción del error"
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Códigos de estado</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '28px' }}>
                            {[
                                ['200', 'OK — Petición correcta'],
                                ['201', 'Created — Recurso creado'],
                                ['400', 'Bad Request — Parámetros inválidos'],
                                ['401', 'Unauthorized — API key inválida o ausente'],
                                ['404', 'Not Found — Recurso no existe'],
                                ['422', 'Unprocessable — Validación fallida (ej. keystrokes insuficientes)'],
                            ].map(([code, desc]) => (
                                <div key={code} style={{ display: 'flex', gap: '16px', fontSize: '0.85rem' }}>
                                    <code style={{ minWidth: '36px', color: parseInt(code) < 400 ? 'var(--color-primary)' : '#ff4d4d', fontFamily: 'monospace' }}>{code}</code>
                                    <span style={{ color: 'var(--color-text-muted)' }}>{desc}</span>
                                </div>
                            ))}
                        </div>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Endpoints disponibles</h2>
                        <Endpoint method="GET"   path="/api/v1/sessions"        desc="Listar sesiones (paginado, filtrable por status/external_ref)" />
                        <Endpoint method="POST"  path="/api/v1/sessions"        desc="Crear sesión desde plataforma externa" />
                        <Endpoint method="GET"   path="/api/v1/sessions/:id"    desc="Obtener sesión por ID" />
                        <Endpoint method="PATCH" path="/api/v1/sessions/:id"    desc="Actualizar status o añadir nota de revisión" />
                        <Endpoint method="GET"   path="/api/v1/enroll"          desc="Consultar perfil de enrollment por email" />
                        <Endpoint method="POST"  path="/api/v1/enroll"          desc="Guardar perfil biométrico de enrollment" />
                        <Endpoint method="GET"   path="/api/v1/keys"            desc="Listar API keys (requiere X-Admin-Secret)" />
                        <Endpoint method="POST"  path="/api/v1/keys"            desc="Crear nueva API key (requiere X-Admin-Secret)" />
                    </>
                )}

                {tab === 'sessions' && (
                    <>
                        <h1 style={{ fontSize: '2rem', marginBottom: '24px' }}>Sessions API</h1>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>GET /api/v1/sessions</h2>
                        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginBottom: '12px' }}>Lista todas las sesiones. Soporta paginación y filtros.</p>
                        <h3 style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Query params</h3>
                        <Code>{`page=1            // Página (default: 1)
limit=20          // Resultados por página (max: 100)
status=passed     // Filtrar: passed | review | flagged
external_ref=xxx  // Filtrar por ID de tu plataforma`}</Code>
                        <h3 style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '8px' }}>Ejemplo</h3>
                        <Code lang="bash">{`curl "${BASE_URL}/api/v1/sessions?status=flagged&page=1" \\
  -H "Authorization: Bearer dc_live_..."`}</Code>
                        <Code>{`{
  "success": true,
  "data": [
    {
      "id": "abc123",
      "candidateName": "María García",
      "role": "Backend Engineer",
      "date": "2026-02-20",
      "score": 62,
      "status": "flagged",
      "alertCount": 5,
      "evidenceCount": 3,
      "aiRisk": 45,
      "tabSwitchCount": 2,
      "sessionHash": "a3f2c1...",
      "externalRef": "lms-exam-2045"
    }
  ],
  "meta": { "total": 1, "page": 1, "limit": 20, "pages": 1 }
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '32px' }}>PATCH /api/v1/sessions/:id</h2>
                        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginBottom: '12px' }}>Actualiza el estado de una sesión o añade una nota de revisión.</p>
                        <Code lang="bash">{`curl -X PATCH "${BASE_URL}/api/v1/sessions/abc123" \\
  -H "Authorization: Bearer dc_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "status": "flagged",
    "reviewNote": "Confirmed cheating via external proctoring footage",
    "externalRef": "lms-exam-2045"
  }'`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '32px' }}>Integración con Moodle / Canvas</h2>
                        <Code lang="javascript">{`// Ejemplo: verificar resultado al entregar examen
async function onExamSubmit(examId, studentEmail) {
  const res = await fetch(
    \`${BASE_URL}/api/v1/sessions?external_ref=\${examId}\`,
    { headers: { Authorization: 'Bearer ' + DEEPCHECK_API_KEY } }
  );
  const { data } = await res.json();
  const session = data[0];

  if (!session || session.status === 'flagged') {
    return { allowed: false, reason: 'Proctoring: suspicious activity detected' };
  }
  if (session.score < 70) {
    return { allowed: false, reason: 'Proctoring: trust score below threshold' };
  }
  return { allowed: true, trustScore: session.score };
}`}</Code>
                    </>
                )}

                {tab === 'enrollment' && (
                    <>
                        <h1 style={{ fontSize: '2rem', marginBottom: '24px' }}>Enrollment API</h1>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '28px', lineHeight: 1.7, fontSize: '0.88rem' }}>
                            El enrollment crea una <strong>firma biométrica de referencia</strong> para un candidato. En sesiones posteriores, el sistema compara la escritura en vivo contra ese baseline y genera un <code>identityMatchScore</code> (0-100%).
                            El perfil caduca a los 90 días y es específico por contexto de escritura.
                        </p>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>Contextos disponibles</h2>
                        <Code>{`prose_es      // Texto en español (ensayos, contratos, exámenes ES)
prose_en      // English prose (certifications, journalism, legal docs)
code_python   // Python (tech interviews, data science exams)
code_js       // JavaScript/TypeScript (frontend/fullstack interviews)
code_general  // Language-agnostic (mixed environments)`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>POST /api/v1/enroll</h2>
                        <Code lang="bash">{`curl -X POST "${BASE_URL}/api/v1/enroll" \\
  -H "Authorization: Bearer dc_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "candidateName": "Pablo López",
    "candidateEmail": "pablo@empresa.com",
    "context": "code_python",
    "profile": {
      "flightMean": 142,
      "flightStd": 38,
      "holdMean": 95,
      "holdStd": 22,
      "entropy": 2.74,
      "digrams": {
        "def ": { "mean": 118, "std": 15, "count": 12 },
        "self": { "mean": 98,  "std": 11, "count": 18 }
      },
      "wpmMin": 0, "wpmMax": 0,
      "sampleSize": 187
    }
  }'`}</Code>
                        <Code>{`{
  "success": true,
  "data": {
    "id": "ep_a1b2c3d4e5f6",
    "expiresAt": "2026-05-21T10:30:00.000Z",
    "enrollmentHash": "sha256:3a7f...",
    "sampleSize": 187,
    "context": "code_python"
  }
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>Flujo completo de integración</h2>
                        <Code lang="javascript">{`// 1. El candidato hace enrollment en /enroll (UI de Deep-Check)
//    → Recibe profileId + enrollmentHash

// 2. Tu plataforma vincula el profileId al candidato
await db.updateCandidate(studentId, { deepCheckProfileId: profileId });

// 3. Al comenzar el examen, el sistema verifica que el enrollment es válido
const enrollRes = await fetch(
  \`${BASE_URL}/api/v1/enroll?email=\${studentEmail}\`,
  { headers: { Authorization: 'Bearer ' + DEEPCHECK_API_KEY } }
);
const { data: profile } = await enrollRes.json();
if (!profile || new Date(profile.expiresAt) < new Date()) {
  throw new Error('Enrollment required before exam');
}

// 4. Al finalizar la sesión, consulta el identityMatchScore
const sessionRes = await fetch(
  \`${BASE_URL}/api/v1/sessions/\${sessionId}\`,
  { headers: { Authorization: 'Bearer ' + DEEPCHECK_API_KEY } }
);
const { data: session } = await sessionRes.json();
if (session.identityMatchScore < 65) {
  // Identidad no coincide con el perfil registrado
  flagForReview(session.id, 'Identity mismatch vs enrollment');
}`}</Code>
                    </>
                )}

                {tab === 'webhooks' && (
                    <>
                        <h1 style={{ fontSize: '2rem', marginBottom: '24px' }}>Webhooks</h1>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '28px', lineHeight: 1.7, fontSize: '0.88rem' }}>
                            Los webhooks permiten que tu plataforma reciba notificaciones en tiempo real cuando una sesión de Deep-Check finaliza o cambia de estado.
                            Configura la URL del webhook al crear la API key.
                        </p>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>Eventos disponibles</h2>
                        <Code>{`session.completed   // Sesión finalizada (candidato pulsó "End Session")
session.flagged     // Sesión marcada como sospechosa (auto o manual)
session.approved    // Sesión aprobada manualmente por el revisor`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>Payload del webhook</h2>
                        <Code>{`{
  "event": "session.completed",
  "timestamp": "2026-02-20T14:32:00.000Z",
  "data": {
    "id": "abc123",
    "candidateName": "María García",
    "score": 62,
    "status": "flagged",
    "sessionHash": "a3f2c1...",
    "aiRisk": 45,
    "tabSwitchCount": 2,
    "identityMatchScore": 71,
    "externalRef": "lms-exam-2045"
  }
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>Verificar autenticidad del webhook</h2>
                        <Code lang="javascript">{`// El payload incluye una firma HMAC-SHA256
// (próximamente — v1.1)
const signature = req.headers['x-deepcheck-signature'];
const expected = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(JSON.stringify(req.body))
  .digest('hex');

if (signature !== \`sha256=\${expected}\`) {
  return res.status(401).send('Invalid signature');
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>Ejemplo: handler en Express</h2>
                        <Code lang="javascript">{`app.post('/webhooks/deepcheck', express.json(), (req, res) => {
  const { event, data } = req.body;

  if (event === 'session.flagged') {
    // Bloquear acceso del candidato en tu LMS
    await lms.blockSubmission(data.externalRef);
    await notify.sendAlert(\`Candidate \${data.candidateName} flagged\`);
  }

  if (event === 'session.completed') {
    // Registrar resultado en tu base de datos
    await db.saveResult({
      examId: data.externalRef,
      trustScore: data.score,
      passed: data.status === 'passed',
      hash: data.sessionHash,
    });
  }

  res.status(200).send('ok');
});`}</Code>
                    </>
                )}

                {tab === 'keys' && (
                    <>
                        <h1 style={{ fontSize: '2rem', marginBottom: '24px' }}>API Keys</h1>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '28px', lineHeight: 1.7, fontSize: '0.88rem' }}>
                            Las API keys controlan el acceso a la API pública. Cada key tiene permisos específicos y puede asociarse a un webhook URL.
                            Las keys se crean via el endpoint de administración (protegido por <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>X-Admin-Secret</code>).
                        </p>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>POST /api/v1/keys</h2>
                        <Code lang="bash">{`curl -X POST "${BASE_URL}/api/v1/keys" \\
  -H "X-Admin-Secret: tu-admin-secret" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Moodle LMS — Universidad XYZ",
    "permissions": ["read", "write"],
    "webhookUrl": "https://moodle.universidad.edu/deepcheck/webhook"
  }'`}</Code>
                        <Code>{`{
  "success": true,
  "data": {
    "key": "dc_live_a1b2c3d4e5f6...",
    "name": "Moodle LMS — Universidad XYZ",
    "permissions": ["read", "write"],
    "webhookUrl": "https://moodle.universidad.edu/deepcheck/webhook",
    "createdAt": "2026-02-20T10:00:00.000Z",
    "active": true
  },
  "note": "Save this key — it will not be shown again in full"
}`}</Code>

                        <div style={{ background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.25)', borderRadius: '10px', padding: '16px', fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                            ⚠️ <strong style={{ color: '#ffd700' }}>Seguridad:</strong> Guarda el valor completo de la key al crearla — no se mostrará de nuevo. El endpoint <code>/api/v1/keys GET</code> solo devuelve versiones enmascaradas (<code>dc_live_a1b2c3d4...</code>).
                        </div>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>Permisos</h2>
                        <Code>{`read     // Listar y leer sesiones y perfiles
write    // Crear y actualizar sesiones y perfiles
webhook  // Registrar URL de webhook (incluido en create key)`}</Code>

                        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '12px' }}>
                            También puedes gestionar keys desde la UI en{' '}
                            <Link href="/dashboard/settings" style={{ color: 'var(--color-primary)' }}>Dashboard → Settings</Link>.
                        </p>
                    </>
                )}
            </main>
        </div>
    )
}
