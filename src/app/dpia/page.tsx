import Link from 'next/link'
import styles from '../privacy/page.module.css'
import dpiaStyles from './page.module.css'

export const metadata = {
  title: 'DPIA — Evaluación de Impacto | Deep-Check',
  description: 'Evaluación de Impacto relativa a la Protección de Datos (DPIA) conforme al Art. 35 RGPD para el tratamiento de datos biométricos en Deep-Check.',
}

function S({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.sectionBody}>{children}</div>
    </div>
  )
}

function Risk({
  id, title, probability, severity, residual, measure
}: {
  id: string; title: string; probability: 'Alta' | 'Media' | 'Baja'
  severity: 'Alta' | 'Media' | 'Baja'; residual: 'Alto' | 'Medio' | 'Bajo' | 'Muy bajo'
  measure: string
}) {
  const probColor = { Alta: '#ff4444', Media: '#ffcc00', Baja: '#00ff9d' }
  const sevColor  = { Alta: '#ff4444', Media: '#ffcc00', Baja: '#00ff9d' }
  const resColor  = { Alto: '#ff4444', Medio: '#ffcc00', Bajo: '#00ff9d', 'Muy bajo': '#00cfff' }
  return (
    <tr>
      <td style={{ fontFamily: 'monospace', fontSize: '12px', color: '#888', whiteSpace: 'nowrap' }}>{id}</td>
      <td style={{ fontWeight: 600, color: '#ddd', fontSize: '13px' }}>{title}</td>
      <td><span className={dpiaStyles.badge} style={{ borderColor: probColor[probability], color: probColor[probability] }}>{probability}</span></td>
      <td><span className={dpiaStyles.badge} style={{ borderColor: sevColor[severity], color: sevColor[severity] }}>{severity}</span></td>
      <td style={{ fontSize: '12px', color: '#888' }}>{measure}</td>
      <td><span className={dpiaStyles.badge} style={{ borderColor: resColor[residual], color: resColor[residual] }}>{residual}</span></td>
    </tr>
  )
}

export default function DpiaPage() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* ── Cabecera ── */}
        <div className={styles.header}>
          <Link href="/" className={styles.back}>← Deep-Check</Link>
          <div className={styles.meta}>
            <span className={styles.version}>RGPD Art. 35</span>
            <span className={styles.date}>Versión 1.0 — 25 de febrero de 2026</span>
          </div>
        </div>

        <h1 className={styles.title}>Evaluación de Impacto relativa a la Protección de Datos</h1>
        <p className={styles.subtitle}>
          Data Protection Impact Assessment (DPIA) · Tratamiento de datos biométricos de comportamiento
          e imágenes de documentos · Conforme al Art. 35 RGPD (Reglamento 2016/679)
        </p>

        {/* ── Obligatoriedad ── */}
        <div className={dpiaStyles.mandatoryBox}>
          <span className={dpiaStyles.mandatoryIcon}>⚖</span>
          <div>
            <p className={dpiaStyles.mandatoryTitle}>DPIA obligatoria — Art. 35(3)(a) RGPD</p>
            <p className={dpiaStyles.mandatoryBody}>
              Esta evaluación es <strong>legalmente obligatoria</strong> conforme al Art. 35(3)(a) RGPD
              por tratarse de un <strong>tratamiento a gran escala de categorías especiales de datos</strong>{' '}
              (datos biométricos, Art. 9 RGPD) destinados a identificar de forma única a personas físicas.
              También concurre el criterio de «evaluación sistemática» (Art. 35(3)(a)) al tratarse de
              un sistema automatizado de puntuación con efectos potencialmente significativos sobre los
              interesados.
            </p>
          </div>
        </div>

        {/* ── 1. Identificación ── */}
        <S title="1. Identificación del Tratamiento">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <tbody>
                {[
                  ['Responsable del tratamiento', 'Deep-Check'],
                  ['DPO', 'Pendiente de designación formal (obligatorio si >250 empleados o tratamiento habitual de categorías especiales a gran escala)'],
                  ['Denominación del tratamiento', 'Verificación de identidad mediante biometría conductual y análisis forense de documentos'],
                  ['Referencia interna', 'DPIA-DC-001 v1.0'],
                  ['Fecha de inicio', 'Enero 2026'],
                  ['Revisión prevista', 'Agosto 2026 (semestral) o ante cambios sustanciales'],
                  ['Normativa aplicable', 'RGPD (UE) 2016/679 · LO 3/2018 LOPDGDD · Reglamento IA 2024/1689 · ENS RD 311/2022'],
                  ['Evaluador', 'Equipo técnico-legal de Deep-Check'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: '#888', width: '35%', fontFamily: 'monospace', fontSize: '12px' }}>{k}</td>
                    <td style={{ fontSize: '13px' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        {/* ── 2. Descripción del tratamiento ── */}
        <S title="2. Descripción Sistemática del Tratamiento">
          <h3>2.1 Naturaleza del tratamiento</h3>
          <p>
            Deep-Check es una plataforma SaaS que realiza <strong>dos tratamientos diferenciados</strong>,
            ambos con impacto en la privacidad:
          </p>

          <div className={dpiaStyles.treatmentGrid}>
            <div className={dpiaStyles.treatmentCard}>
              <p className={dpiaStyles.treatmentCardTitle}>Tratamiento A — Biometría conductual</p>
              <ul>
                <li>Captura patrones de pulsación de teclado (keystrokes) durante una sesión de escritura</li>
                <li>Extrae ~18 parámetros estadísticos: tiempos de vuelo/hold, entropía, periodicidad, WPM, bígramas</li>
                <li>Compara el perfil en vivo con un perfil de referencia (enrollado) mediante distancia de Mahalanobis</li>
                <li>Genera puntuación de correspondencia de identidad (0-100) y riesgo de bot/IA (0-100)</li>
              </ul>
            </div>
            <div className={dpiaStyles.treatmentCard}>
              <p className={dpiaStyles.treatmentCardTitle}>Tratamiento B — Análisis forense documental</p>
              <ul>
                <li>Recibe imágenes de documentos (JPEG/PNG/WebP) para análisis de autenticidad</li>
                <li>Aplica Error Level Analysis (ELA), análisis de metadatos EXIF y detección de uniformidad de ruido</li>
                <li>Extrae metadatos EXIF (software editor, fecha, dispositivo, GPS si presente)</li>
                <li>Genera puntuación de riesgo de manipulación (0-100) y alertas por módulo</li>
              </ul>
            </div>
          </div>

          <h3>2.2 Categorías de datos tratados</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th>Datos específicos</th>
                  <th>Clasificación RGPD</th>
                  <th>Dónde se procesa</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Datos biométricos', 'Patrones temporales de pulsación de teclado (flight time, hold time, dígrafos)', 'Categoría especial — Art. 9 RGPD', 'Extracción: client-side (navegador). Vectores derivados: servidor → Supabase'],
                  ['Datos de identificación', 'Nombre, email del candidato (enlazado al perfil)', 'Dato personal ordinario — Art. 4(1) RGPD', 'Supabase (EU)'],
                  ['Imágenes de documentos', 'Fotografías de documentos (DNI, pasaporte, facturas, etc.)', 'Dato personal si contiene imagen/datos del titular', 'Procesado client-side; no almacenado en servidor (solo análisis ELA en canvas)'],
                  ['Metadatos EXIF', 'Software editor, fecha/hora, dispositivo, coordenadas GPS (si presentes)', 'Dato personal si incluye localización o ID de dispositivo', 'Extraído client-side; resumen almacenado en Supabase (JSON)'],
                  ['Datos de red', 'Dirección IP (pseudonimizada), User-Agent', 'Dato personal ordinario', 'Middleware → dc_audit_logs (IP hasheada SHA-256+salt)'],
                  ['Datos de sesión', 'Token de sesión admin (hash SHA-256), timestamp', 'Dato de autenticación', 'dc_admin_sessions (Supabase)'],
                ].map(([c, d, r, w]) => (
                  <tr key={c}>
                    <td style={{ fontWeight: 600, color: '#ddd', fontSize: '13px' }}>{c}</td>
                    <td style={{ fontSize: '12px' }}>{d}</td>
                    <td style={{ fontSize: '12px', color: c === 'Datos biométricos' ? '#ffcc00' : '#999' }}>{r}</td>
                    <td style={{ fontSize: '12px', color: '#777' }}>{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>2.3 Finalidades del tratamiento</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Finalidad</th>
                  <th>Descripción</th>
                  <th>Base jurídica (Art. 6/9 RGPD)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Verificación de identidad', 'Comprobar que el candidato que realiza una sesión es la misma persona que enroló su perfil biométrico', 'Art. 9(2)(a) — Consentimiento explícito previo al tratamiento'],
                  ['Detección de fraude/bot', 'Identificar comportamiento automatizado (bots, scripts) o suplantación de identidad en procesos de selección o acceso', 'Art. 9(2)(a) — Consentimiento explícito'],
                  ['Análisis forense documental', 'Detectar manipulación o generación sintética de documentos aportados como prueba', 'Art. 6(1)(f) — Interés legítimo del operador (prevención de fraude documentario)'],
                  ['Registro de actividad (audit log)', 'Mantener trazabilidad de accesos y operaciones del sistema para cumplimiento ENS/ISO 27001', 'Art. 6(1)(c) — Obligación legal (ENS RD 311/2022 op.exp.7)'],
                  ['Mejora del sistema', 'Análisis agregado y anonimizado de métricas de rendimiento del algoritmo', 'Art. 6(1)(f) — Interés legítimo (únicamente datos anonimizados; no aplica RGPD)'],
                ].map(([f, d, b]) => (
                  <tr key={f}>
                    <td style={{ fontWeight: 600, color: '#ddd', fontSize: '13px', minWidth: '160px' }}>{f}</td>
                    <td style={{ fontSize: '13px' }}>{d}</td>
                    <td style={{ fontSize: '12px', color: '#00cfff' }}>{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>2.4 Interesados afectados</h3>
          <ul>
            <li><strong>Candidatos en procesos de selección:</strong> personas físicas que participan en entrevistas o pruebas monitorizadas</li>
            <li><strong>Usuarios verificados (acceso a sistemas):</strong> personas que autentican su identidad antes de acceder a plataformas de clientes</li>
            <li><strong>Remitentes de documentos:</strong> personas físicas cuyos documentos son analizados (pueden no haber dado consentimiento directo a Deep-Check — responsabilidad del operador)</li>
            <li><strong>Administradores del sistema:</strong> empleados de clientes con acceso al dashboard</li>
          </ul>

          <h3>2.5 Destinatarios y transferencias internacionales</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Destinatario</th><th>Rol</th><th>País/Región</th><th>Garantías</th></tr>
              </thead>
              <tbody>
                {[
                  ['Supabase Inc.', 'Encargado del tratamiento (base de datos)', 'UE (región eu-central-1)', 'DPA firmado, ISO 27001, SOC 2 Type II, clausulas contractuales tipo (CCT)'],
                  ['Vercel Inc.', 'Encargado del tratamiento (hosting/CDN)', 'EE. UU. (con Edge UE)', 'DPA firmado, SCCs, SOC 2 Type II. Datos de sesión pueden procesarse en nodos UE'],
                  ['Clientes de Deep-Check (operadores)', 'Responsables conjuntos o encargados según contrato', 'Variable', 'Contrato de servicio + DPA; obligados a garantizar base jurídica y derechos de interesados'],
                ].map(([d, r, c, g]) => (
                  <tr key={d}>
                    <td style={{ fontWeight: 600, color: '#ddd' }}>{d}</td>
                    <td style={{ color: '#888', fontSize: '12px' }}>{r}</td>
                    <td style={{ color: '#888', fontSize: '12px' }}>{c}</td>
                    <td style={{ fontSize: '12px' }}>{g}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.note}>
            <strong style={{ color: '#ffcc00' }}>Transferencia a EE. UU. (Vercel):</strong> Amparada en Decisión de Adecuación del Marco de Privacidad UE-EE. UU. (DPF, julio 2023) + SCCs como garantía adicional.
            Revisar ante posible invalidación del DPF.
          </div>
        </S>

        {/* ── 3. Necesidad y proporcionalidad ── */}
        <S title="3. Evaluación de Necesidad y Proporcionalidad">
          <h3>3.1 ¿Es necesario el tratamiento?</h3>
          <p>
            La biometría conductual mediante análisis de pulsaciones de teclado es actualmente
            el método menos intrusivo disponible para verificación continua de identidad en
            entornos digitales remotos, en comparación con alternativas como:
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Alternativa</th><th>Intrusividad</th><th>Motivo de descarte/complemento</th></tr>
              </thead>
              <tbody>
                {[
                  ['Reconocimiento facial', 'Muy alta', 'Procesa imágenes del rostro (Art. 9); más intrusivo; requiere cámara activa'],
                  ['Huella dactilar / iris', 'Alta', 'Requiere hardware dedicado; no aplicable en contextos remotos SaaS'],
                  ['OTP / MFA tradicional', 'Baja', 'No detecta suplantación post-autenticación; no verifica identidad continua'],
                  ['Biometría conductual (keystroke)', 'Media-Baja', 'Seleccionado: no captura datos morfológicos; solo patrones temporales estadísticos'],
                  ['Sin verificación biométrica', 'N/A', 'Inaceptable: el producto no cumpliría su finalidad de detección de fraude'],
                ].map(([a, i, m]) => (
                  <tr key={a}>
                    <td style={{ fontWeight: 600, color: '#ddd', fontSize: '13px' }}>{a}</td>
                    <td style={{ color: i === 'Muy alta' || i === 'Alta' ? '#ff6b6b' : i === 'Media-Baja' ? '#00ff9d' : '#888', fontFamily: 'monospace', fontSize: '12px' }}>{i}</td>
                    <td style={{ fontSize: '12px' }}>{m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>3.2 Principio de minimización (Art. 5(1)(c) RGPD)</h3>
          <ul>
            <li>Solo se capturan <strong>tiempos de pulsación</strong>, nunca el contenido de lo escrito</li>
            <li>El texto escrito por el candidato <strong>nunca se transmite</strong> al servidor</li>
            <li>Los keystroke timings individuales <strong>no se almacenan</strong>; solo estadísticas agregadas (media, desviación estándar, percentiles)</li>
            <li>Los perfiles biométricos tienen <strong>expiración automática a 90 días</strong></li>
            <li>No se cruzan datos biométricos con otras fuentes de datos</li>
          </ul>

          <h3>3.3 Limitación de la finalidad (Art. 5(1)(b) RGPD)</h3>
          <p>
            Los datos biométricos recogidos <strong>solo se utilizan para la finalidad declarada</strong>
            (verificación de identidad / detección de bot). Están contractualmente prohibidos:
            perfilado de personalidad, inferencia de estado de salud, monitorización fuera del
            contexto de verificación, venta a terceros.
          </p>

          <h3>3.4 Proporcionalidad</h3>
          <div className={dpiaStyles.propGrid}>
            {[
              { label: '✓ Proporcional', desc: 'El tratamiento se limita a la duración de la sesión de verificación (media: 3-8 minutos)' },
              { label: '✓ Proporcional', desc: 'Procesamiento client-side: los raw timings nunca salen del dispositivo del candidato' },
              { label: '✓ Proporcional', desc: 'La puntuación final (0-100) no permite reconstruir el perfil biométrico original' },
              { label: '⚠ Supervisión', desc: 'Los operadores deben garantizar que la decisión final no sea exclusivamente automatizada (Art. 22 RGPD)' },
            ].map(({ label, desc }) => (
              <div key={desc} className={dpiaStyles.propCard} style={{ borderColor: label.startsWith('✓') ? '#00ff9d33' : '#ffcc0033' }}>
                <span className={dpiaStyles.propLabel} style={{ color: label.startsWith('✓') ? '#00ff9d' : '#ffcc00' }}>{label}</span>
                <span className={dpiaStyles.propDesc}>{desc}</span>
              </div>
            ))}
          </div>
        </S>

        {/* ── 4. Evaluación de riesgos ── */}
        <S title="4. Evaluación de Riesgos para los Derechos y Libertades">
          <p style={{ marginBottom: '16px' }}>
            Conforme a la metodología de la AEPD y CNIL, cada riesgo se evalúa por{' '}
            <strong>probabilidad de materialización</strong> (sin medidas) y <strong>gravedad del impacto</strong> sobre los interesados,
            obteniendo un nivel de riesgo residual tras aplicar las medidas de mitigación.
          </p>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Riesgo</th>
                  <th>Prob.</th>
                  <th>Gravedad</th>
                  <th>Medidas de mitigación</th>
                  <th>Riesgo residual</th>
                </tr>
              </thead>
              <tbody>
                <Risk
                  id="R-01"
                  title="Acceso no autorizado a perfiles biométricos almacenados"
                  probability="Media"
                  severity="Alta"
                  measure="RLS Supabase (service_role only), AES-256 en reposo, audit log de accesos, rate limiting, CSP"
                  residual="Bajo"
                />
                <Risk
                  id="R-02"
                  title="Re-identificación de datos pseudonimizados (ataque de correlación)"
                  probability="Baja"
                  severity="Alta"
                  measure="Solo se almacenan estadísticas agregadas (no raw timings); IP hasheada con salt; sin cruce con otras BBDD"
                  residual="Muy bajo"
                />
                <Risk
                  id="R-03"
                  title="Suplantación de identidad (spoofing biométrico — replay o sintético)"
                  probability="Media"
                  severity="Alta"
                  measure="4 capas anti-adversarial: blink rate, rhythm_shift, inconsistency, saccade gate; detección de bursts; validación en enroll"
                  residual="Medio"
                />
                <Risk
                  id="R-04"
                  title="Falso positivo: rechazo erróneo de persona legítima (discriminación algorítmica)"
                  probability="Media"
                  severity="Media"
                  measure="Umbral calibrado (FPR < 5% en benchmark); supervisión humana obligatoria (Terms §2.3); posibilidad de apelación"
                  residual="Bajo"
                />
                <Risk
                  id="R-05"
                  title="Decisión automatizada sin intervención humana (Art. 22 RGPD)"
                  probability="Media"
                  severity="Alta"
                  measure="Términos de servicio prohíben uso como decisión automatizada exclusiva; dashboard requiere revisión humana; EU AI Act Art. 14 implementado"
                  residual="Bajo"
                />
                <Risk
                  id="R-06"
                  title="Exfiltración de datos vía ataque XSS / inyección en la aplicación"
                  probability="Baja"
                  severity="Alta"
                  measure="CSP estricta (no unsafe-inline); TypeScript strict; no eval(); queries parametrizadas (Supabase ORM); npm audit"
                  residual="Muy bajo"
                />
                <Risk
                  id="R-07"
                  title="Uso secundario no autorizado de datos biométricos por parte del operador"
                  probability="Baja"
                  severity="Alta"
                  measure="DPA contractual con operadores; auditoría de uso; acceso API restringido por API key; audit log de todas las consultas"
                  residual="Bajo"
                />
                <Risk
                  id="R-08"
                  title="Violación de seguridad sin notificación en plazo (RGPD Art. 33 — 72h)"
                  probability="Baja"
                  severity="Media"
                  measure="Audit log permite detección rápida; alertas de Vercel en 5xx; procedimiento de notificación AEPD documentado"
                  residual="Bajo"
                />
                <Risk
                  id="R-09"
                  title="Transferencia internacional insegura (Vercel EE.UU.)"
                  probability="Media"
                  severity="Media"
                  measure="DPF (Decisión de Adecuación jul-2023) + SCCs; datos biométricos almacenados en Supabase EU; Edge Functions configuradas para UE"
                  residual="Bajo"
                />
                <Risk
                  id="R-10"
                  title="Retención excesiva de datos biométricos tras finalidad cumplida"
                  probability="Baja"
                  severity="Media"
                  measure="Expiración automática a 90 días (campo expires_at); endpoint DELETE /api/enrollment/:id para ejercicio de supresión"
                  residual="Muy bajo"
                />
                <Risk
                  id="R-11"
                  title="Tratamiento de datos de menores sin consentimiento parental"
                  probability="Baja"
                  severity="Alta"
                  measure="Términos de servicio prohíben uso con menores de 18 años; responsabilidad contractual del operador de verificar edad"
                  residual="Bajo"
                />
                <Risk
                  id="R-12"
                  title="GPS / datos de localización en metadatos EXIF de documentos"
                  probability="Media"
                  severity="Media"
                  measure="EXIF leído client-side; coordenadas GPS en análisis forense nunca se transmiten al servidor (solo flag booleano de presencia); usuario informado"
                  residual="Muy bajo"
                />
              </tbody>
            </table>
          </div>

          <div className={dpiaStyles.riskLegend}>
            {[
              { label: 'Muy bajo', color: '#00cfff' },
              { label: 'Bajo', color: '#00ff9d' },
              { label: 'Medio', color: '#ffcc00' },
              { label: 'Alto', color: '#ff4444' },
            ].map(({ label, color }) => (
              <span key={label} className={dpiaStyles.legendItem}>
                <span className={dpiaStyles.legendDot} style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </S>

        {/* ── 5. Medidas técnicas y organizativas ── */}
        <S title="5. Medidas Técnicas y Organizativas (Art. 32 RGPD)">
          <h3>5.1 Medidas técnicas implementadas</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Medida</th><th>Descripción técnica</th><th>Control RGPD</th></tr>
              </thead>
              <tbody>
                {[
                  ['Privacidad por diseño', 'Extracción biométrica 100% client-side (browser Web API). Solo vectores estadísticos derivados se transmiten. Sin almacenamiento de timings individuales.', 'Art. 25 RGPD'],
                  ['Pseudonimización', 'IPs hasheadas SHA-256+salt antes de almacenarse. Perfiles identificados con ID opaco (ep_*). Email solo para lookup de perfil.', 'Art. 4(5) + Art. 32(1)(a)'],
                  ['Cifrado en tránsito', 'TLS 1.3 enforced via HSTS (max-age=31536000, preload). Sin downgrade HTTP.', 'Art. 32(1)(a)'],
                  ['Cifrado en reposo', 'AES-256 gestionado por Supabase (PostgreSQL). Claves gestionadas por proveedor ISO 27001.', 'Art. 32(1)(a)'],
                  ['Control de acceso', 'RLS Supabase: audit_logs solo service_role; API keys en Vercel env; dashboard con sesión httpOnly/Secure; timingSafeEqual.', 'Art. 32(1)(b)'],
                  ['Limitación de acceso', 'Rate limiting por IP: 20 req/min en /api/ml-score, 5 req/min en /api/auth. Bloqueo automático con Retry-After.', 'Art. 32(1)(b)'],
                  ['Audit logging', 'Registro completo en dc_audit_logs: eventType, endpoint, IP pseudonimizada, status_code, duration_ms. Append-only.', 'Art. 5(2) — Responsabilidad proactiva'],
                  ['Consentimiento técnico', 'Modal de consentimiento RGPD Art. 9 obligatorio antes de cualquier captura biométrica. No bypass posible.', 'Art. 7 + Art. 9(2)(a)'],
                  ['Minimización', 'Solo stats agregadas almacenadas (no raw). El texto escrito por el candidato no se transmite ni registra.', 'Art. 5(1)(c)'],
                  ['Expiración automática', 'Campo expires_at en perfiles biométricos: 90 días. Sin renovación automática.', 'Art. 5(1)(e)'],
                  ['Cabeceras de seguridad', 'CSP, HSTS, X-Frame-Options: SAMEORIGIN, X-Content-Type-Options: nosniff, Permissions-Policy: camera=(self).', 'Art. 32 — Integridad aplicación'],
                ].map(([m, d, c]) => (
                  <tr key={m}>
                    <td style={{ fontWeight: 600, color: '#ddd', fontSize: '13px', minWidth: '140px' }}>{m}</td>
                    <td style={{ fontSize: '12px' }}>{d}</td>
                    <td style={{ fontSize: '12px', color: '#00cfff', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>5.2 Medidas organizativas implementadas y pendientes</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Medida</th><th>Estado</th><th>Plazo</th></tr>
              </thead>
              <tbody>
                {[
                  ['Política de privacidad publicada (Art. 13/14 RGPD)', 'Implementado', '—'],
                  ['Cláusulas de consentimiento explícito (Art. 9(2)(a))', 'Implementado', '—'],
                  ['Registro de actividades de tratamiento (Art. 30 RGPD)', 'Pendiente — este DPIA sirve de base', 'Q2 2026'],
                  ['Designación formal de DPO (si aplica Art. 37)', 'Pendiente — evaluar obligatoriedad', 'Q2 2026'],
                  ['DPA firmados con Supabase y Vercel', 'Implementado (aceptado en creación de cuenta)', '—'],
                  ['DPA con clientes/operadores (plantilla)', 'Pendiente', 'Q2 2026'],
                  ['Procedimiento de respuesta a violaciones (Art. 33/34)', 'Parcial — documentado en COMPLIANCE.md', 'Q2 2026'],
                  ['Procedimiento de ejercicio de derechos (Art. 15-22)', 'Parcial — endpoint DELETE implementado; proceso manual', 'Q2 2026'],
                  ['Formación en protección de datos del equipo', 'Pendiente', 'Q3 2026'],
                  ['Auditoría de privacidad por tercero', 'Pendiente', 'Q4 2026'],
                ].map(([m, s, p]) => (
                  <tr key={m}>
                    <td style={{ fontSize: '13px' }}>{m}</td>
                    <td><span className={dpiaStyles.badge} style={{
                      borderColor: s === 'Implementado' ? '#00ff9d' : s.startsWith('Parcial') ? '#ffcc00' : '#666',
                      color: s === 'Implementado' ? '#00ff9d' : s.startsWith('Parcial') ? '#ffcc00' : '#888'
                    }}>{s === 'Implementado' ? '✓ Hecho' : s.startsWith('Parcial') ? '◎ Parcial' : '○ Pendiente'}</span></td>
                    <td style={{ color: '#666', fontFamily: 'monospace', fontSize: '12px' }}>{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        {/* ── 6. Derechos de los interesados ── */}
        <S title="6. Derechos de los Interesados (Arts. 15–22 RGPD)">
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Derecho</th><th>Art.</th><th>Implementación técnica</th><th>Canal</th></tr>
              </thead>
              <tbody>
                {[
                  ['Acceso', '15', 'Endpoint GET /api/enrollment?email={email} devuelve perfil completo', 'Email a privacy@deep-check.app'],
                  ['Rectificación', '16', 'Re-enrolamiento del perfil biométrico corrige el vector de referencia', 'Email + re-enrolamiento'],
                  ['Supresión (derecho al olvido)', '17', 'DELETE /api/enrollment/:id elimina perfil biométrico; datos de audit log pseudonimizados no vinculables', 'Email a privacy@deep-check.app'],
                  ['Limitación del tratamiento', '18', 'El operador puede marcar perfiles como inactivos (flag enabled=false) sin suprimirlos', 'Dashboard del operador'],
                  ['Portabilidad', '20', 'GET /api/enrollment/:id devuelve perfil en JSON exportable', 'Email a privacy@deep-check.app'],
                  ['Oposición', '21', 'El interesado puede retirar el consentimiento; el sistema no puede usarse sin consentimiento', 'Retirada de consentimiento en plataforma'],
                  ['No decisión automatizada exclusiva', '22', 'Términos prohíben uso sin supervisión humana; el resultado es siempre una puntuación, no una decisión', 'Contractual con operadores'],
                ].map(([d, a, i, c]) => (
                  <tr key={d}>
                    <td style={{ fontWeight: 600, color: '#ddd', fontSize: '13px' }}>{d}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px', color: '#00cfff' }}>Art. {a}</td>
                    <td style={{ fontSize: '12px' }}>{i}</td>
                    <td style={{ fontSize: '12px', color: '#777' }}>{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.note}>
            <strong>Plazo de respuesta:</strong> 1 mes desde la solicitud (prorrogable 2 meses por complejidad, con comunicación al interesado).
            Autoridad de control competente: <strong>AEPD</strong> (Agencia Española de Protección de Datos) — <a href="https://www.aepd.es" style={{ color: '#00cfff' }} target="_blank" rel="noopener noreferrer">www.aepd.es</a>.
          </div>
        </S>

        {/* ── 7. Conclusión ── */}
        <S title="7. Conclusión y Decisión sobre el Tratamiento">
          <div className={dpiaStyles.conclusionGrid}>
            <div className={dpiaStyles.conclusionCard} style={{ borderColor: '#00ff9d44' }}>
              <p className={dpiaStyles.conclusionTitle} style={{ color: '#00ff9d' }}>✓ Riesgos residuales aceptables</p>
              <p className={dpiaStyles.conclusionBody}>
                9 de los 12 riesgos identificados tienen riesgo residual <strong>Bajo o Muy bajo</strong> tras
                la aplicación de las medidas técnicas. El tratamiento cumple el principio de minimización,
                aplica privacidad por diseño y pseudonimización.
              </p>
            </div>
            <div className={dpiaStyles.conclusionCard} style={{ borderColor: '#ffcc0044' }}>
              <p className={dpiaStyles.conclusionTitle} style={{ color: '#ffcc00' }}>⚠ Riesgo residual Medio — R-03</p>
              <p className={dpiaStyles.conclusionBody}>
                El riesgo de spoofing biométrico sofisticado permanece en nivel <strong>Medio</strong>.
                Se acepta como riesgo inherente al estado del arte en biometría conductual.
                Las 4 capas anti-adversarial implementadas son las medidas disponibles sin incrementar
                la intrusividad del sistema.
              </p>
            </div>
          </div>

          <div className={dpiaStyles.decisionBox}>
            <p className={dpiaStyles.decisionTitle}>Decisión: El tratamiento puede llevarse a cabo</p>
            <p className={dpiaStyles.decisionBody}>
              Con base en el análisis de necesidad, proporcionalidad y riesgos realizado,
              <strong> el tratamiento de datos biométricos y forenses por parte de Deep-Check es
              lícito y puede continuar</strong>, condicionado a:
            </p>
            <ol className={dpiaStyles.decisionList}>
              <li>Mantener el consentimiento explícito como base jurídica (Art. 9(2)(a)) y la arquitectura de privacidad por diseño</li>
              <li>No permitir decisiones automatizadas exclusivas sin supervisión humana (Art. 22)</li>
              <li>Completar el Registro de Actividades de Tratamiento (Art. 30) antes de Q2 2026</li>
              <li>Designar o evaluar la obligatoriedad del DPO antes de Q2 2026</li>
              <li>Firmar DPA con cada operador-cliente antes de dar acceso al API</li>
              <li>Revisar esta DPIA ante cualquier cambio sustancial en el sistema (nuevo módulo de IA, nuevas categorías de datos, nuevos destinatarios)</li>
            </ol>
          </div>

          <div className={styles.note} style={{ marginTop: '20px' }}>
            <strong>Consulta previa a la AEPD:</strong> Conforme al Art. 36 RGPD, si tras la revisión de los riesgos
            residuales se concluye que el riesgo para los interesados sigue siendo alto (en particular el R-03
            en contextos de uso policial o de selección masiva), Deep-Check consultará a la AEPD antes
            de proceder con dicho despliegue específico.
          </div>
        </S>

        {/* ── Firma ── */}
        <div className={dpiaStyles.signatureBlock}>
          <p className={dpiaStyles.signatureTitle}>Aprobación de la DPIA</p>
          <div className={dpiaStyles.signatureGrid}>
            {[
              { role: 'Responsable del Tratamiento', name: 'Deep-Check', date: '25/02/2026' },
              { role: 'DPO (pendiente designación)', name: '—', date: '—' },
              { role: 'Próxima revisión', name: 'Agosto 2026', date: 'o ante cambio sustancial' },
            ].map(({ role, name, date }) => (
              <div key={role} className={dpiaStyles.signatureItem}>
                <p className={dpiaStyles.sigRole}>{role}</p>
                <p className={dpiaStyles.sigName}>{name}</p>
                <p className={dpiaStyles.sigDate}>{date}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className={styles.footer}>
          <Link href="/ens">ENS Básico →</Link>
          <Link href="/iso27001">ISO 27001 SoA →</Link>
          <Link href="/privacy">Política de Privacidad</Link>
          <Link href="/security">Seguridad</Link>
          <Link href="/whitepaper">Whitepaper</Link>
          <Link href="/">← Inicio</Link>
        </div>

      </div>
    </div>
  )
}
