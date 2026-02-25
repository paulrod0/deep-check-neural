import Link from 'next/link'
import styles from '../privacy/page.module.css'
import ensStyles from './page.module.css'

export const metadata = {
  title: 'ENS Básico — Autodeclaración de Conformidad | Deep-Check',
  description: 'Autodeclaración de conformidad con el Esquema Nacional de Seguridad (ENS) nivel Básico conforme al RD 311/2022.',
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function S({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.sectionBody}>{children}</div>
    </div>
  )
}

type Status = 'implemented' | 'partial' | 'na'

interface Control {
  id: string
  name: string
  requirement: string
  implementation: string
  status: Status
  evidence: string
}

const STATUS_LABEL: Record<Status, string> = {
  implemented: 'Cumple',
  partial: 'Parcial',
  na: 'N/A',
}
const STATUS_COLOR: Record<Status, string> = {
  implemented: '#00ff9d',
  partial: '#ffcc00',
  na: '#666',
}

// ─── ENS Básico control table (RD 311/2022, Annex II) ────────────────────────

const CONTROLS: Control[] = [
  // Marco organizativo [org]
  {
    id: 'org.1',
    name: 'Política de seguridad',
    requirement: 'Política de seguridad aprobada y publicada',
    implementation: 'Política de seguridad documentada en COMPLIANCE.md; publicada en /security',
    status: 'implemented',
    evidence: '/security · COMPLIANCE.md',
  },
  {
    id: 'org.2',
    name: 'Normativa de seguridad',
    requirement: 'Conjunto normativo de seguridad',
    implementation: 'Privacy Policy (/privacy), Terms (/terms) y Security Policy (/security) definen las normas de uso aceptable, protección de datos y divulgación responsable',
    status: 'implemented',
    evidence: '/privacy · /terms · /security',
  },
  {
    id: 'org.3',
    name: 'Procedimientos de seguridad',
    requirement: 'Procedimientos operativos documentados',
    implementation: 'Procedimientos de gestión de incidentes y divulgación responsable publicados en /security §4; pendiente documentar procedimiento de backup',
    status: 'partial',
    evidence: '/security §4',
  },
  {
    id: 'org.4',
    name: 'Proceso de autorización',
    requirement: 'Autorización formal para sistemas de información',
    implementation: 'Consentimiento explícito RGPD Art. 9 requerido antes del tratamiento biométrico; logs de consentimiento almacenados',
    status: 'implemented',
    evidence: '/interview (consent gate) · /enroll (GDPR checkbox)',
  },
  // Marco operacional [op]
  {
    id: 'op.pl.1',
    name: 'Análisis de riesgos',
    requirement: 'Análisis y gestión de riesgos',
    implementation: 'Risk register documentado en COMPLIANCE.md §3; amenazas identificadas: suplantación biométrica, exfiltración de perfiles, ataques de inyección de API',
    status: 'implemented',
    evidence: 'COMPLIANCE.md §3',
  },
  {
    id: 'op.pl.2',
    name: 'Arquitectura de seguridad',
    requirement: 'Arquitectura de seguridad documentada',
    implementation: 'Arquitectura publicada en /whitepaper §5 y /security §1: extracción biométrica client-side, transmisión de vectores derivados, almacenamiento pseudonimizado',
    status: 'implemented',
    evidence: '/whitepaper · /security',
  },
  {
    id: 'op.acc.1',
    name: 'Identificación',
    requirement: 'Identificación unívoca de usuarios',
    implementation: 'Candidatos identificados por email y profileId único (ep_*); administradores por sesión token con hash SHA-256',
    status: 'implemented',
    evidence: 'src/app/api/enrollment/route.ts · dc_admin_sessions',
  },
  {
    id: 'op.acc.2',
    name: 'Requisitos de acceso',
    requirement: 'Control de acceso a los recursos del sistema',
    implementation: 'RLS en Supabase para dc_audit_logs (service_role only); middleware protege /dashboard con cookie httpOnly; API keys de Supabase en variables de entorno',
    status: 'implemented',
    evidence: 'src/middleware.ts · Supabase RLS',
  },
  {
    id: 'op.acc.5',
    name: 'Autenticación',
    requirement: 'Mecanismos de autenticación',
    implementation: 'Dashboard admin protegido con contraseña + cookie de sesión httpOnly/Secure; comparación con crypto.timingSafeEqual para prevenir timing attacks; tokens de 32 bytes aleatorios',
    status: 'implemented',
    evidence: 'src/app/api/auth/dashboard/route.ts · src/middleware.ts',
  },
  {
    id: 'op.exp.1',
    name: 'Inventario de activos',
    requirement: 'Inventario de activos del sistema',
    implementation: 'Asset inventory documentado en COMPLIANCE.md §2: codebase (GitHub), base de datos (Supabase EU), frontend (Vercel), modelo ONNX',
    status: 'implemented',
    evidence: 'COMPLIANCE.md §2',
  },
  {
    id: 'op.exp.2',
    name: 'Configuración de seguridad',
    requirement: 'Gestión de la configuración segura',
    implementation: 'Rate limiting en middleware (20 rps/IP en /api/ml-score, 5 rps en /api/auth); cabeceras de seguridad completas (CSP, HSTS, X-Frame-Options, Permissions-Policy); security.txt publicado',
    status: 'implemented',
    evidence: 'src/middleware.ts · next.config.ts · /security.txt',
  },
  {
    id: 'op.exp.4',
    name: 'Mantenimiento',
    requirement: 'Mantenimiento del sistema',
    implementation: 'Dependencias gestionadas con npm audit; actualizaciones mediante CI/CD (Vercel). Pendiente: política de actualización trimestral formal',
    status: 'partial',
    evidence: 'package.json · Vercel CI',
  },
  {
    id: 'op.exp.7',
    name: 'Registro de actividad (audit log)',
    requirement: 'Registro de actividad de usuarios y sistema',
    implementation: 'Audit log completo en dc_audit_logs (Supabase): IPs pseudonimizadas con SHA-256+salt, event_type, endpoint, método HTTP, status_code, duration_ms. Logs en todos los endpoints críticos: /api/ml-score, /api/enrollment, /api/assessments, /api/documents, /api/auth/dashboard',
    status: 'implemented',
    evidence: 'src/lib/auditLog.ts · dc_audit_logs (Supabase) · src/middleware.ts',
  },
  {
    id: 'op.exp.8',
    name: 'Registro de gestión de incidentes',
    requirement: 'Gestión y registro de incidentes de seguridad',
    implementation: 'Política de divulgación responsable publicada en /security §4 con email de contacto; errores del servidor registrados en Vercel logs y audit log. Pendiente: procedimiento formal de escalación',
    status: 'partial',
    evidence: '/security §4 · Vercel logs',
  },
  {
    id: 'op.ext.1',
    name: 'Contratación y acuerdos de nivel de servicio',
    requirement: 'Requisitos de seguridad en contratación con terceros',
    implementation: 'Subencargados documentados: Supabase (UE, ISO 27001), Vercel (SOC 2). Listados en /privacy §7',
    status: 'implemented',
    evidence: '/privacy §7',
  },
  {
    id: 'op.mon.1',
    name: 'Detección de intrusiones',
    requirement: 'Monitorización y detección de incidentes',
    implementation: 'Rate limiting detecta y bloquea abuso de API; middleware genera logs estructurados JSON; alertas de Vercel por error 5xx',
    status: 'implemented',
    evidence: 'src/middleware.ts · Vercel Analytics',
  },
  // Medidas de protección [mp]
  {
    id: 'mp.com.1',
    name: 'Perímetro seguro',
    requirement: 'Protección de las comunicaciones',
    implementation: 'HTTPS enforced con HSTS (max-age=31536000, includeSubDomains, preload); TLS 1.3 en Vercel y Supabase',
    status: 'implemented',
    evidence: 'next.config.ts (HSTS) · Vercel TLS',
  },
  {
    id: 'mp.si.1',
    name: 'Protección de la información',
    requirement: 'Protección de la información en almacenamiento',
    implementation: 'Datos en reposo cifrados en Supabase (AES-256); IPs pseudonimizadas; perfiles biométricos con expiración a 90 días; sin almacenamiento de datos biométricos crudos',
    status: 'implemented',
    evidence: 'Supabase encryption · src/app/api/enrollment/route.ts (expiresAt)',
  },
  {
    id: 'mp.sw.1',
    name: 'Desarrollo de aplicaciones',
    requirement: 'Seguridad en el ciclo de vida del software',
    implementation: 'TypeScript estricto, ESLint, build check en CI; CSP previene XSS; sin eval(); dependencias auditadas con npm audit',
    status: 'implemented',
    evidence: 'tsconfig.json · .eslintrc · next.config.ts CSP',
  },
  {
    id: 'mp.info.3',
    name: 'Cifrado de la información',
    requirement: 'Uso de criptografía',
    implementation: 'TLS 1.3 en tránsito; AES-256 en reposo (Supabase); SHA-256 para pseudonimización de IPs; tokens de sesión con crypto.randomBytes(32)',
    status: 'implemented',
    evidence: 'src/lib/auditLog.ts · src/app/api/auth/dashboard/route.ts',
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function EnsPage() {
  const implemented = CONTROLS.filter(c => c.status === 'implemented').length
  const partial = CONTROLS.filter(c => c.status === 'partial').length
  const na = CONTROLS.filter(c => c.status === 'na').length
  const pct = Math.round((implemented + partial * 0.5) / CONTROLS.length * 100)

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* ── Header ── */}
        <div className={styles.header}>
          <Link href="/" className={styles.back}>← Deep-Check</Link>
          <div className={styles.meta}>
            <span className={styles.version}>ENS RD 311/2022</span>
            <span className={styles.date}>Fecha: 25 de febrero de 2026</span>
          </div>
        </div>

        {/* ── Title ── */}
        <h1 className={styles.title}>
          Autodeclaración de Conformidad ENS
        </h1>
        <p className={styles.subtitle}>
          Esquema Nacional de Seguridad — Nivel Básico (RD 311/2022)
        </p>

        {/* ── Formal declaration box ── */}
        <div className={ensStyles.declarationBox}>
          <div className={ensStyles.declarationIcon}>🛡</div>
          <div>
            <p className={ensStyles.declarationTitle}>Declaración Formal de Conformidad</p>
            <p className={ensStyles.declarationBody}>
              Deep-Check declara que su sistema de verificación de identidad biométrica,
              disponible en <strong>deep-check.vercel.app</strong>, cumple con los
              controles aplicables del <strong>Esquema Nacional de Seguridad (ENS) nivel Básico</strong>
              , conforme al Real Decreto 311/2022 de 3 de mayo, en la fecha indicada en
              este documento. Esta autodeclaración está disponible públicamente y será
              actualizada ante cambios sustanciales en el sistema.
            </p>
          </div>
        </div>

        {/* ── System info table ── */}
        <S title="1. Información del Sistema">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <tbody>
                {[
                  ['Nombre del sistema', 'Deep-Check — Plataforma de Verificación Biométrica'],
                  ['Versión', '1.0 (febrero 2026)'],
                  ['Responsable', 'Deep-Check (organización declarante)'],
                  ['Categoría ENS', 'Básico (RD 311/2022, Anexo I)'],
                  ['Ámbito', 'Aplicación web SaaS de verificación de identidad mediante biometría conductual y análisis forense documental'],
                  ['URL', 'https://deep-check.vercel.app'],
                  ['Infraestructura', 'Vercel (frontend/API, Edge Runtime) + Supabase (base de datos, UE)'],
                  ['Clasificación datos', 'Datos biométricos (categoría especial, RGPD Art. 9)'],
                  ['Fecha declaración', '25 de febrero de 2026'],
                  ['Próxima revisión', '25 de agosto de 2026 (revisión semestral)'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: '#888', width: '35%', fontFamily: 'monospace', fontSize: '12px' }}>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        {/* ── Compliance summary ── */}
        <S title="2. Resumen de Conformidad">
          <div className={ensStyles.scoreRow}>
            <div className={ensStyles.scoreCard}>
              <span className={ensStyles.scoreNum} style={{ color: '#00ff9d' }}>{implemented}</span>
              <span className={ensStyles.scoreLabel}>Controles implementados</span>
            </div>
            <div className={ensStyles.scoreCard}>
              <span className={ensStyles.scoreNum} style={{ color: '#ffcc00' }}>{partial}</span>
              <span className={ensStyles.scoreLabel}>Implementación parcial</span>
            </div>
            <div className={ensStyles.scoreCard}>
              <span className={ensStyles.scoreNum} style={{ color: '#666' }}>{na}</span>
              <span className={ensStyles.scoreLabel}>No aplica</span>
            </div>
            <div className={ensStyles.scoreCard}>
              <span className={ensStyles.scoreNum} style={{ color: '#00cfff' }}>{pct}%</span>
              <span className={ensStyles.scoreLabel}>Conformidad estimada</span>
            </div>
          </div>
          <div className={ensStyles.progressBar}>
            <div className={ensStyles.progressFill} style={{ width: `${pct}%` }} />
          </div>
          <p style={{ color: '#666', fontSize: '13px', marginTop: '12px' }}>
            Los controles parcialmente implementados corresponden a procedimientos operativos en proceso de formalización
            (op.exp.4 política de actualizaciones, op.exp.8 escalación de incidentes, org.3 procedimientos completos).
            No afectan a la seguridad técnica del sistema.
          </p>
        </S>

        {/* ── Control mapping table ── */}
        <S title="3. Tabla de Controles ENS Básico">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Control</th>
                  <th>Medida</th>
                  <th>Implementación</th>
                  <th>Estado</th>
                  <th>Evidencia</th>
                </tr>
              </thead>
              <tbody>
                {CONTROLS.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px', color: '#00cfff', whiteSpace: 'nowrap' }}>{c.id}</td>
                    <td style={{ fontWeight: 600, color: '#ddd', minWidth: '140px' }}>{c.name}</td>
                    <td style={{ fontSize: '12px', maxWidth: '300px' }}>{c.implementation}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className={ensStyles.badge} style={{ borderColor: STATUS_COLOR[c.status], color: STATUS_COLOR[c.status] }}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td style={{ fontSize: '11px', color: '#555', fontFamily: 'monospace' }}>{c.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        {/* ── Privacy by design ── */}
        <S title="4. Privacidad por Diseño (RGPD Art. 25)">
          <p>
            El sistema aplica privacidad por diseño en el tratamiento de datos biométricos,
            minimizando la superficie de exposición mediante las siguientes medidas técnicas:
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Principio</th>
                  <th>Implementación técnica</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Minimización de datos', 'Extracción biométrica 100% client-side (browser). Solo vectores derivados (estadísticas, no raw) se transmiten al servidor.'],
                  ['Pseudonimización', 'IPs hasheadas con SHA-256 + salt antes de almacenarse en audit log. Perfiles identificados por ID opaco (ep_*).'],
                  ['Limitación de plazo', 'Perfiles biométricos con expiración automática a 90 días (campo expires_at).'],
                  ['Consentimiento explícito', 'Modal de consentimiento RGPD Art. 9 obligatorio antes de cualquier sesión biométrica. Checkbox en /enroll.'],
                  ['Sin almacenamiento biométrico crudo', 'Nunca se almacenan keystroke timings individuales; solo estadísticas agregadas (media, desviación, percentiles).'],
                  ['Derecho de supresión', 'Endpoint DELETE /api/enrollment/:id disponible para borrado de perfil a petición del interesado.'],
                ].map(([p, i]) => (
                  <tr key={p}>
                    <td style={{ fontWeight: 600, color: '#ddd', whiteSpace: 'nowrap' }}>{p}</td>
                    <td style={{ fontSize: '13px' }}>{i}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        {/* ── AI Act compliance ── */}
        <S title="5. EU AI Act — Cumplimiento (Reglamento 2024/1689)">
          <div className={styles.note}>
            <strong style={{ color: '#ffcc00' }}>Clasificación de riesgo:</strong> Sistema de verificación de identidad biométrica. Posible clasificación como sistema de alto riesgo (Anexo III §1). Deep-Check implementa las salvaguardas del Art. 13 (transparencia), Art. 14 (supervisión humana) y Art. 11 (documentación técnica).
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Artículo AI Act</th>
                  <th>Requisito</th>
                  <th>Implementación</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Art. 13', 'Transparencia', 'Whitepaper técnico público (/whitepaper) con metodología, limitaciones y arquitectura completa', 'Cumple'],
                  ['Art. 14', 'Supervisión humana', 'Términos de servicio prohíben uso como decisión automatizada sin revisión humana; dashboard con revisión manual', 'Cumple'],
                  ['Art. 11', 'Documentación técnica', 'Technical whitepaper, COMPLIANCE.md, esta autodeclaración ENS', 'Cumple'],
                  ['Art. 9', 'Gestión de riesgos', 'Risk register en COMPLIANCE.md; análisis de falsos positivos/negativos documentado en whitepaper §7', 'Cumple'],
                  ['Art. 10', 'Datos de entrenamiento', 'Modelo ONNX entrenado con dataset público (sintético); sin datos personales en entrenamiento', 'Cumple'],
                  ['Art. 15', 'Robustez y ciberseguridad', '4 capas anti-adversarial (blink, rhythm_shift, inconsistency, saccade); rate limiting; CSP', 'Cumple'],
                ].map(([art, req, impl, status]) => (
                  <tr key={art}>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px', color: '#00cfff', whiteSpace: 'nowrap' }}>{art}</td>
                    <td style={{ fontWeight: 600, color: '#ddd' }}>{req}</td>
                    <td style={{ fontSize: '12px' }}>{impl}</td>
                    <td><span className={ensStyles.badge} style={{ borderColor: '#00ff9d', color: '#00ff9d' }}>{status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        {/* ── Roadmap ── */}
        <S title="6. Plan de Mejora Continua">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Control pendiente</th>
                  <th>Acción</th>
                  <th>Plazo objetivo</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['org.3 — Procedimientos completos', 'Documentar procedimientos operativos: backup, recuperación, cambios de configuración', 'Q2 2026'],
                  ['op.exp.4 — Política mantenimiento', 'Establecer política formal de actualización trimestral de dependencias y parches', 'Q2 2026'],
                  ['op.exp.8 — Escalación incidentes', 'Definir árbol de escalación: CISO → DPO → autoridad de control (AEPD)', 'Q2 2026'],
                  ['Auditoría externa ENS', 'Solicitar entidad de certificación acreditada para validación formal nivel Básico', 'Q3 2026'],
                  ['ISO 27001 — Auditoría', 'Contratar auditoría de certificación ISO 27001:2022 una vez estabilizado el SGSI', 'Q4 2026'],
                ].map(([c, a, p]) => (
                  <tr key={c}>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px', color: '#ffcc00' }}>{c}</td>
                    <td style={{ fontSize: '13px' }}>{a}</td>
                    <td style={{ color: '#888', whiteSpace: 'nowrap' }}>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        {/* ── Signature block ── */}
        <div className={ensStyles.signatureBlock}>
          <p className={ensStyles.signatureTitle}>Firma de la Declaración</p>
          <p className={ensStyles.signatureBody}>
            Esta autodeclaración de conformidad con el ENS nivel Básico es emitida de forma
            voluntaria por Deep-Check en el marco del artículo 40 del RD 311/2022.
            La organización declara que las medidas de seguridad descritas están implementadas
            a la fecha indicada y se compromete a mantener y mejorar continuamente el nivel
            de conformidad alcanzado.
          </p>
          <div className={ensStyles.signatureLine}>
            <div>
              <p className={ensStyles.signatureField}>Responsable de Seguridad</p>
              <p className={ensStyles.signatureValue}>Deep-Check</p>
            </div>
            <div>
              <p className={ensStyles.signatureField}>Fecha</p>
              <p className={ensStyles.signatureValue}>25 de febrero de 2026</p>
            </div>
            <div>
              <p className={ensStyles.signatureField}>Versión</p>
              <p className={ensStyles.signatureValue}>1.0</p>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className={styles.footer}>
          <Link href="/iso27001">ISO 27001 SoA →</Link>
          <Link href="/security">Política de Seguridad</Link>
          <Link href="/privacy">Política de Privacidad</Link>
          <Link href="/whitepaper">Whitepaper Técnico</Link>
          <Link href="/">← Inicio</Link>
        </div>

      </div>
    </div>
  )
}
