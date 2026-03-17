'use client'

import React, { useState } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'sessions' | 'enrollment' | 'verify' | 'certificates' | 'ml' | 'webhooks' | 'keys' | 'audit' | 'gdpr' | 'team'

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
        { id: 'overview',      label: 'Overview' },
        { id: 'verify',        label: 'Verify API' },
        { id: 'certificates',  label: 'Certificates' },
        { id: 'ml',            label: 'ML / Training' },
        { id: 'sessions',      label: 'Sessions API' },
        { id: 'enrollment',    label: 'Enrollment API' },
        { id: 'audit',         label: 'Audit Trail' },
        { id: 'gdpr',          label: 'GDPR' },
        { id: 'team',          label: 'Team / Org' },
        { id: 'webhooks',      label: 'Webhooks' },
        { id: 'keys',          label: 'API Keys' },
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
                            <p style={{ margin: '0 0 8px 0' }}>• <strong style={{ color: 'var(--color-text)' }}>Frontend:</strong> React 19 en el navegador del candidato. Toda la biometría (keystroke dynamics, MediaPipe FaceLandmarker 478pts + iris, gaze tracking) se procesa <em>100% en el cliente</em> — ningún audio ni vídeo sale del navegador.</p>
                            <p style={{ margin: '0 0 8px 0' }}>• <strong style={{ color: 'var(--color-text)' }}>API:</strong> Next.js serverless functions en Vercel (edge network global). Latencia &lt;50ms desde Europa/US.</p>
                            <p style={{ margin: '0 0 8px 0' }}>• <strong style={{ color: 'var(--color-text)' }}>Storage:</strong> JSON file-based (MVP). Migratable a PostgreSQL/Supabase para producción.</p>
                            <p style={{ margin: 0 }}>• <strong style={{ color: 'var(--color-text)' }}>Modelos ML:</strong> MediaPipe FaceLandmarker (478 landmarks + iris + 52 blendshapes) — ejecutado 100% en GPU del navegador, nunca en el servidor.</p>
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
                        <h3 style={{ fontSize: '0.95rem', marginBottom: '8px', marginTop: '20px', color: 'var(--color-primary)' }}>Document Verification</h3>
                        <Endpoint method="POST"  path="/api/v1/verify"          desc="Verify a single document or batch (up to 10)" />
                        <Endpoint method="POST"  path="/api/v1/batch"           desc="Async batch verification (up to 100 documents, with progress polling)" />
                        <Endpoint method="GET"   path="/api/v1/batch?jobId=..." desc="Poll batch job status and retrieve results" />
                        <Endpoint method="GET"   path="/api/verifications"      desc="List KYC verification history with filtering and pagination" />
                        <Endpoint method="POST"  path="/api/documents/validate" desc="Standalone document number validation (195 countries)" />
                        <Endpoint method="GET"   path="/api/documents/coverage" desc="Country coverage statistics and supported document types" />
                        <Endpoint method="GET"   path="/api/certificates?id=..."  desc="Retrieve a signed verification certificate" />
                        <Endpoint method="POST"  path="/api/certificates"       desc="Generate a verification certificate from analysis ID" />

                        <h3 style={{ fontSize: '0.95rem', marginBottom: '8px', marginTop: '20px', color: 'var(--color-primary)' }}>ML / Continuous Learning</h3>
                        <Endpoint method="POST"  path="/api/ml/feedback"        desc="Submit user feedback for model improvement" />
                        <Endpoint method="GET"   path="/api/ml/feedback"        desc="Get retraining status and model history" />
                        <Endpoint method="GET"   path="/api/ml/status"          desc="Get comprehensive ML system metrics" />
                        <Endpoint method="POST"  path="/api/ml/retrain"         desc="Trigger model retraining" />
                        <Endpoint method="POST"  path="/api/ml/webhook"         desc="SageMaker training completion webhook" />

                        <h3 style={{ fontSize: '0.95rem', marginBottom: '8px', marginTop: '20px', color: 'var(--color-primary)' }}>Sessions & Enrollment</h3>
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

                {tab === 'verify' && (
                    <>
                        <h1 style={{ fontSize: '2rem', marginBottom: '8px' }}>Document Verification API</h1>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '32px', lineHeight: 1.7 }}>
                            Programmatic KYC document verification. Supports single and batch (up to 10) documents.
                            Each verification returns a signed certificate that can be shared with third parties.
                        </p>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>POST /api/v1/verify — Single Document</h2>
                        <Code lang="bash">{`curl -X POST ${BASE_URL}/api/v1/verify \\
  -H "Authorization: Bearer dc_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "documentFront": "data:image/jpeg;base64,/9j/4AAQ...",
    "documentType": "passport",
    "externalRef": "APP-2026-001",
    "webhookUrl": "https://your-server.com/webhook"
  }'`}</Code>

                        <h3 style={{ fontSize: '0.95rem', marginBottom: '8px', color: 'var(--color-text-muted)' }}>Response</h3>
                        <Code>{`{
  "success": true,
  "data": {
    "certificateId": "a1b2c3d4-...",
    "verdict": "authentic",
    "documentType": "passport",
    "mrz": {
      "valid": true,
      "documentType": "TD3",
      "fields": {
        "surname": "SMITH",
        "givenNames": "JOHN WILLIAM",
        "nationality": "GBR",
        "docNumber": "123456789",
        "dobFormatted": "15/03/1990",
        "expiryFormatted": "01/01/2030",
        "isExpired": false
      },
      "checksumsPassed": 4,
      "checksumsFailed": 0,
      "alerts": []
    },
    "forensics": { "riskScore": 5, "riskLevel": "clean" },
    "faceQuality": { "faceFound": true, "faceCount": 1, "qualityScore": 12 },
    "verifyUrl": "https://deep-check.io/verify/a1b2c3d4-...",
    "processingMs": 1245
  }
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>POST /api/v1/verify — Batch (up to 10)</h2>
                        <Code lang="bash">{`curl -X POST ${BASE_URL}/api/v1/verify \\
  -H "Authorization: Bearer dc_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "documents": [
      { "documentFront": "data:image/jpeg;base64,...", "documentType": "passport" },
      { "documentFront": "data:image/jpeg;base64,...", "documentType": "dni" }
    ]
  }'`}</Code>

                        <h3 style={{ fontSize: '0.95rem', marginBottom: '8px', color: 'var(--color-text-muted)' }}>Batch Response</h3>
                        <Code>{`{
  "success": true,
  "data": {
    "results": [ ... ],
    "totalDocuments": 2,
    "verdicts": { "authentic": 1, "suspicious": 1, "tampered": 0 }
  }
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '8px', marginTop: '2rem' }}>Supported Document Types</h2>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '24px' }}>
                            {[
                                ['passport', 'Passport (MRZ TD3, 2×44)'],
                                ['dni', 'National ID / DNI (MRZ TD1, 3×30)'],
                                ['driving_license', 'Driving Licence (EU format)'],
                                ['residence_permit', 'Residence Permit (TIE/NIE)'],
                                ['eu_id_card', 'EU ID Card older format (TD2)'],
                                ['visa', 'Visa (MRV-B, 2×36)'],
                            ].map(([type, desc]) => (
                                <div key={type} style={{ background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: 8, fontSize: '0.82rem' }}>
                                    <code style={{ color: 'var(--color-primary)' }}>{type}</code>
                                    <span style={{ color: 'var(--color-text-muted)', marginLeft: '8px' }}>{desc}</span>
                                </div>
                            ))}
                        </div>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '2rem' }}>POST /api/documents/validate — Standalone Document Number Validation</h2>
                        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginBottom: '12px', lineHeight: 1.6 }}>
                            Validate national ID numbers, passport numbers, IBANs, and tax codes without image upload.
                            Supports 195 countries with tiered validation (22 algorithmic, 40+ format, rest basic).
                        </p>
                        <Code lang="bash">{`curl -X POST ${BASE_URL}/api/documents/validate \\
  -H "Content-Type: application/json" \\
  -d '{
    "documentNumber": "12345678Z",
    "countryCode": "ESP",
    "documentType": "nif"
  }'`}</Code>

                        <h3 style={{ fontSize: '0.95rem', marginBottom: '8px', color: 'var(--color-text-muted)' }}>Response</h3>
                        <Code>{`{
  "valid": true,
  "country": "Spain",
  "countryCode": "ESP",
  "documentType": "NIF",
  "formattedNumber": "12345678-Z",
  "details": "Check letter valid",
  "countryInfo": {
    "name": "Spain",
    "region": "Europe",
    "idTypes": ["DNI", "NIE", "TIE"],
    "hasNFC": true
  }
}`}</Code>

                        <h3 style={{ fontSize: '0.95rem', marginBottom: '8px', color: 'var(--color-text-muted)' }}>Supported Document Types (by name)</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '24px' }}>
                            {[
                                'nif', 'nie', 'codice_fiscale', 'cpf', 'run', 'rut', 'curp',
                                'tc_kimlik', 'aadhaar', 'sa_id', 'personalausweis', 'nric',
                                'fin', 'rrn', 'my_number', 'pesel', 'cnp', 'rodne_cislo',
                                'bsn', 'nn', 'china_id', 'cedula_ec', 'iban', 'passport',
                            ].map(t => (
                                <div key={t} style={{ background: 'rgba(255,255,255,0.03)', padding: '4px 8px', borderRadius: 6, fontSize: '0.76rem', fontFamily: 'monospace', color: 'var(--color-primary)' }}>
                                    {t}
                                </div>
                            ))}
                        </div>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '2rem' }}>GET /api/documents/coverage — Country Coverage Stats</h2>
                        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', marginBottom: '12px', lineHeight: 1.6 }}>
                            Returns full coverage statistics: countries by region, validation tiers, MRZ format support, and NFC ePassport compatibility.
                        </p>
                        <Code lang="bash">{`curl ${BASE_URL}/api/documents/coverage`}</Code>

                        <h3 style={{ fontSize: '0.95rem', marginBottom: '8px', color: 'var(--color-text-muted)' }}>Response (summarized)</h3>
                        <Code>{`{
  "totalCountries": 155,
  "tier1Countries": 22,
  "tier2Countries": 43,
  "tier3Countries": 90,
  "nfcCountries": 120,
  "mrzSupport": { "TD1": 52, "TD2": 1, "TD3": 155, "MRV-B": 0 },
  "regions": [
    { "region": "Europe", "count": 44, "countries": [...] },
    { "region": "Americas", "count": 29, "countries": [...] },
    { "region": "Asia-Pacific", "count": 33, "countries": [...] },
    ...
  ],
  "supportedCodes": ["ESP", "DEU", "FRA", ...]
}`}</Code>

                        <div style={{ background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.2)', borderRadius: 10, padding: '1rem', marginBottom: '1.5rem' }}>
                            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                                <strong style={{ color: 'var(--color-primary)' }}>195 Countries:</strong> All ICAO 9303 member states are supported via universal MRZ passport verification.
                                22 countries have full algorithmic check-digit validation for national IDs.
                                The /validate endpoint auto-detects the appropriate validator from the country code.
                            </p>
                        </div>
                    </>
                )}

                {tab === 'certificates' && (
                    <>
                        <h1 style={{ fontSize: '2rem', marginBottom: '8px' }}>Verification Certificates</h1>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '32px', lineHeight: 1.7 }}>
                            Generate cryptographically signed certificates for verified documents.
                            Certificates can be shared with employers, universities, or government agencies.
                            Third parties verify authenticity at the certificate URL.
                        </p>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>GET /api/certificates?id=&lt;certificateId&gt;</h2>
                        <Code lang="bash">{`curl "${BASE_URL}/api/certificates?id=a1b2c3d4-..."

# Response:
{
  "valid": true,
  "expired": false,
  "certificate": {
    "id": "a1b2c3d4-...",
    "version": "1.0",
    "issuedAt": "2026-03-17T14:30:00Z",
    "expiresAt": "2027-03-17T14:30:00Z",
    "verification": {
      "verdict": "authentic",
      "documentType": "passport",
      "mrzSummary": { "nationality": "ESP", "checksumsPassed": 4 },
      "forensicsSummary": { "riskScore": 5, "riskLevel": "clean" },
      "faceMatchPerformed": true,
      "livenessCheckPerformed": true
    },
    "verifyUrl": "https://deep-check.io/verify/a1b2c3d4-...",
    "signature": "a3f8b2c1d4e5..."
  }
}`}</Code>

                        <div style={{ background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.2)', borderRadius: 10, padding: '1rem', marginBottom: '1.5rem' }}>
                            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                                <strong style={{ color: 'var(--color-primary)' }}>Tamper-Proof:</strong> Each certificate includes a SHA-256 HMAC signature.
                                Any modification to the certificate data invalidates the signature.
                                Third parties can verify authenticity by checking the <code>verifyUrl</code>.
                            </p>
                        </div>
                    </>
                )}

                {tab === 'ml' && (
                    <>
                        <h1 style={{ fontSize: '2rem', marginBottom: '8px' }}>ML / Continuous Learning API</h1>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '32px', lineHeight: 1.7 }}>
                            The continuous learning system improves the model with every verification.
                            Users submit feedback on model predictions, which accumulates until the
                            retraining threshold is met. New models are auto-deployed only if they
                            exceed the current model&apos;s AUC.
                        </p>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>POST /api/ml/feedback — Submit Correction</h2>
                        <Code lang="bash">{`curl -X POST ${BASE_URL}/api/ml/feedback \\
  -H "Content-Type: application/json" \\
  -d '{
    "analysis_id": "cert_171...",
    "predicted_label": "genuine",
    "predicted_score": 85,
    "actual_label": "tampered",
    "document_type": "passport",
    "notes": "Visible editing on expiry date"
  }'`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>GET /api/ml/status — System Metrics</h2>
                        <Code>{`{
  "deployedModel": {
    "version": 3,
    "auc": 0.8535,
    "accuracy": 0.842,
    "f1": 0.8987,
    "training_samples": 1960,
    "deployed": true
  },
  "retrainStatus": {
    "canRetrain": false,
    "pendingSamples": 42,
    "threshold": 100,
    "feedbackCount": 142
  },
  "feedbackStats": {
    "total": 142,
    "used": 100,
    "corrections": 18
  },
  "deployMode": "cloud",
  "sagemakerConfigured": true
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>POST /api/ml/retrain — Trigger Retraining</h2>
                        <Code lang="bash">{`curl -X POST ${BASE_URL}/api/ml/retrain \\
  -H "X-Retrain-Secret: your-secret" \\
  -d '{ "orgId": "global", "force": false }'

# Response:
{
  "success": true,
  "jobName": "deep-check-retrain-global-1710...",
  "message": "Retraining triggered with 105 new samples",
  "estimatedDurationMinutes": 30
}`}</Code>

                        <div style={{ background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.2)', borderRadius: 10, padding: '1rem' }}>
                            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                                <strong style={{ color: 'var(--color-primary)' }}>Architecture:</strong> Feedback → Accumulate → SageMaker Training → Auto-deploy with AUC rollback protection.
                                On-premise deployments use local ONNX models instead of SageMaker.
                            </p>
                        </div>
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

                {tab === 'audit' && (
                    <>
                        <h1 style={{ fontSize: '2rem', marginBottom: '24px' }}>Audit Trail</h1>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '28px', lineHeight: 1.7, fontSize: '0.88rem' }}>
                            Deep-Check provides a tamper-evident audit trail using SHA-256 hash chains. Every action is logged with a cryptographic link to the previous entry,
                            making it impossible to modify or delete entries without detection. This meets ENS op.exp.7, op.exp.8, and ISO 27001 A.12.4 requirements.
                        </p>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>GET /api/audit</h2>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '12px', fontSize: '0.85rem' }}>Query your organization&apos;s audit trail with optional filters.</p>
                        <Code lang="bash">{`curl "${BASE_URL}/api/audit?action=document.analyze&limit=10" \\
  -H "Cookie: sb-access-token=YOUR_TOKEN"`}</Code>
                        <Code>{`{
  "success": true,
  "data": [
    {
      "id": 142,
      "action": "document.analyze",
      "actorEmail": "admin@company.com",
      "resourceType": "document",
      "resourceId": "doc_abc123",
      "details": { "verdict": "authentic", "riskScore": 12 },
      "ipAddress": "192.168.1.***",
      "createdAt": "2026-03-17T10:00:00.000Z"
    }
  ],
  "pagination": { "total": 142, "limit": 10, "offset": 0 }
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>Verify Chain Integrity</h2>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '12px', fontSize: '0.85rem' }}>
                            Verify that the audit log has not been tampered with. Each entry contains the SHA-256 hash of the previous entry.
                        </p>
                        <Code lang="bash">{`curl "${BASE_URL}/api/audit?verify=true" \\
  -H "Cookie: sb-access-token=YOUR_TOKEN"`}</Code>
                        <Code>{`{
  "success": true,
  "verification": {
    "valid": true,
    "entriesChecked": 142,
    "message": "All 142 audit entries verified — chain integrity confirmed"
  }
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>Available Actions</h2>
                        <Code>{`document.analyze     // Document forensic analysis performed
document.verify      // KYC identity verification
session.create       // Interview session started
session.flag         // Session flagged as suspicious
auth.login           // User logged in
auth.logout          // User signed out
member.invite        // Team member invited
member.remove        // Team member removed
api_key.create       // API key generated
ml.feedback          // ML model feedback submitted
ml.retrain_trigger   // ML retraining initiated
certificate.generate // Verification certificate created
gdpr.export_request  // GDPR data export requested
gdpr.deletion_request // GDPR data deletion requested`}</Code>
                    </>
                )}

                {tab === 'gdpr' && (
                    <>
                        <h1 style={{ fontSize: '2rem', marginBottom: '24px' }}>GDPR Compliance</h1>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '28px', lineHeight: 1.7, fontSize: '0.88rem' }}>
                            Deep-Check supports GDPR Article 15 (Right of Access) and Article 17 (Right to Erasure).
                            Data subjects can request exports of all their data or request complete deletion.
                        </p>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>POST /api/gdpr — Request Data Export</h2>
                        <Code lang="bash">{`curl -X POST "${BASE_URL}/api/gdpr" \\
  -H "Cookie: sb-access-token=YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "type": "export" }'`}</Code>
                        <Code>{`{
  "success": true,
  "message": "Data export request submitted. You will be notified when ready.",
  "requestId": "req_abc123",
  "status": "processing"
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>POST /api/gdpr — Request Data Deletion</h2>
                        <Code lang="bash">{`curl -X POST "${BASE_URL}/api/gdpr" \\
  -H "Cookie: sb-access-token=YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "type": "deletion" }'`}</Code>
                        <Code>{`{
  "success": true,
  "message": "Deletion request submitted. Will be processed within 30 days per GDPR.",
  "requestId": "req_def456",
  "status": "pending"
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>GET /api/gdpr — List Requests</h2>
                        <Code lang="bash">{`curl "${BASE_URL}/api/gdpr" \\
  -H "Cookie: sb-access-token=YOUR_TOKEN"`}</Code>
                        <Code>{`{
  "success": true,
  "data": [
    {
      "id": "req_abc123",
      "type": "export",
      "status": "completed",
      "requesterEmail": "user@company.com",
      "dataUrl": "...",
      "createdAt": "2026-03-17T10:00:00.000Z",
      "completedAt": "2026-03-17T10:02:00.000Z",
      "expiresAt": "2026-03-24T10:02:00.000Z"
    }
  ]
}`}</Code>

                        <div style={{ background: 'rgba(0,212,127,0.08)', border: '1px solid rgba(0,212,127,0.25)', borderRadius: '10px', padding: '16px', fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.6, marginTop: '20px' }}>
                            Data export links expire after 7 days. Deletion requests are processed within the GDPR-mandated 30-day window.
                            All GDPR actions are logged in the tamper-evident audit trail.
                        </div>
                    </>
                )}

                {tab === 'team' && (
                    <>
                        <h1 style={{ fontSize: '2rem', marginBottom: '24px' }}>Team & Organization</h1>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '28px', lineHeight: 1.7, fontSize: '0.88rem' }}>
                            Manage team members programmatically. Available on Pro and Enterprise plans.
                            Roles: <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>owner</code>,
                            <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>member</code>,
                            <code style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px' }}>viewer</code>.
                        </p>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>GET /api/org/members</h2>
                        <Code lang="bash">{`curl "${BASE_URL}/api/org/members" \\
  -H "Cookie: sb-access-token=YOUR_TOKEN"`}</Code>
                        <Code>{`{
  "success": true,
  "data": {
    "orgId": "org_abc123",
    "orgName": "Acme Corp",
    "plan": "pro",
    "members": [
      { "id": "m1", "email": "owner@acme.com", "role": "owner", "joinedAt": "2026-01-15" },
      { "id": "m2", "email": "analyst@acme.com", "role": "member", "joinedAt": "2026-02-20" }
    ]
  }
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>POST /api/org/members — Invite Member</h2>
                        <Code lang="bash">{`curl -X POST "${BASE_URL}/api/org/members" \\
  -H "Cookie: sb-access-token=YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{ "email": "new@acme.com", "role": "member" }'`}</Code>
                        <Code>{`{
  "success": true,
  "message": "new@acme.com added as member",
  "member": { "userId": "uuid", "email": "new@acme.com", "role": "member" }
}`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>DELETE /api/org/members — Remove Member</h2>
                        <Code lang="bash">{`curl -X DELETE "${BASE_URL}/api/org/members?id=MEMBER_ID" \\
  -H "Cookie: sb-access-token=YOUR_TOKEN"`}</Code>

                        <h2 style={{ fontSize: '1.2rem', marginBottom: '12px', marginTop: '28px' }}>GET /api/org/billing — Billing Info</h2>
                        <Code lang="bash">{`curl "${BASE_URL}/api/org/billing" \\
  -H "Cookie: sb-access-token=YOUR_TOKEN"`}</Code>
                        <Code>{`{
  "success": true,
  "data": {
    "org": { "plan": "pro", "planLabel": "Pro", "planStatus": "active" },
    "usage": { "sessionsUsed": 23, "sessionsLimit": -1, "docsUsed": 8, "docsLimit": -1 },
    "billing": {
      "hasSubscription": true,
      "billingPortalUrl": "https://app.lemonsqueezy.com/my-orders",
      "manageSubscriptionUrl": "https://app.lemonsqueezy.com/my-orders"
    }
  }
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
