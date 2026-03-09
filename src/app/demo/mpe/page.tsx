'use client'
/**
 * /src/app/demo/mpe/page.tsx
 *
 * Confidential sales demo — Deep-Check × Formaciones MPE
 * Pure inline styles. No Tailwind utility classes.
 */

import React, { useState } from 'react'

const DEMO_PASSWORD = 'mpe2026'
const STORAGE_KEY = 'dc_demo_mpe'

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)

  const submit = () => {
    if (input === DEMO_PASSWORD) {
      localStorage.setItem(STORAGE_KEY, '1')
      onUnlock()
    } else {
      setError(true)
      setShake(true)
      setTimeout(() => setShake(false), 500)
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter','Segoe UI',Arial,sans-serif" }}>
      <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', padding: '48px 40px', width: '100%', maxWidth: '400px', boxShadow: '0 24px 64px rgba(0,0,0,0.3)', textAlign: 'center', animation: shake ? 'shake 0.4s' : 'none' }}>
        <div style={{ width: '56px', height: '56px', backgroundColor: '#1e3a8a', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: '1.8rem' }}>🔒</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#111827', margin: '0 0 8px' }}>Deep-Check</h1>
        <p style={{ color: '#6b7280', fontSize: '0.9rem', margin: '0 0 32px' }}>Demo confidencial · Formaciones MPE</p>
        <input
          type="password"
          placeholder="Clave de acceso"
          value={input}
          onChange={e => { setInput(e.target.value); setError(false) }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          style={{ width: '100%', padding: '12px 16px', border: `1.5px solid ${error ? '#ef4444' : '#d1d5db'}`, borderRadius: '8px', fontSize: '1rem', outline: 'none', boxSizing: 'border-box', marginBottom: '8px' }}
          autoFocus
        />
        {error && <p style={{ color: '#ef4444', fontSize: '0.85rem', margin: '0 0 12px' }}>Clave incorrecta</p>}
        <button onClick={submit} style={{ width: '100%', backgroundColor: '#2563eb', color: '#ffffff', border: 'none', padding: '13px', borderRadius: '8px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', marginTop: error ? '0' : '12px' }}>
          Acceder
        </button>
        <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '24px' }}>Acceso restringido · No compartir</p>
      </div>
      <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }`}</style>
    </div>
  )
}

/* ─── Styles ────────────────────────────────────────────────────────────────── */

const C = {
  blue: '#2563eb',
  blueDark: '#1e3a8a',
  blueLight: '#dbeafe',
  green: '#16a34a',
  white: '#ffffff',
  textDark: '#111827',
  textMuted: '#6b7280',
  border: '#e5e7eb',
  cardBg: '#f9fafb',
  red: '#dc2626',
  redLight: '#fef2f2',
  redBorder: '#fecaca',
}

/* ─── Subcomponents ─────────────────────────────────────────────────────────── */

function FraudCard() {
  const cardStyle: React.CSSProperties = {
    background: C.white,
    border: `1px solid ${C.border}`,
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    minWidth: '320px',
    maxWidth: '380px',
    width: '100%',
  }

  const monoHeaderStyle: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginBottom: '12px',
  }

  const fileLineStyle: React.CSSProperties = {
    fontWeight: 700,
    fontSize: '0.9rem',
    color: C.textDark,
    marginBottom: '12px',
  }

  const fraudBadgeStyle: React.CSSProperties = {
    display: 'inline-block',
    background: C.redLight,
    color: C.red,
    border: `1px solid ${C.redBorder}`,
    padding: '6px 16px',
    borderRadius: '999px',
    fontWeight: 700,
    fontSize: '0.85rem',
    marginTop: '12px',
    marginBottom: '8px',
  }

  const anomalyBoxStyle: React.CSSProperties = {
    background: C.redLight,
    border: `1px solid ${C.redBorder}`,
    borderRadius: '8px',
    padding: '12px 14px',
    marginTop: '12px',
    marginBottom: '14px',
  }

  const anomalyItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '6px',
    fontSize: '0.8rem',
    color: C.red,
    marginTop: '6px',
  }

  const btnRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '10px',
    marginTop: '4px',
  }

  const btnOutlineBlueStyle: React.CSSProperties = {
    flex: 1,
    padding: '7px 10px',
    fontSize: '0.78rem',
    fontWeight: 600,
    background: C.white,
    color: C.blue,
    border: `1.5px solid ${C.blue}`,
    borderRadius: '6px',
    cursor: 'pointer',
  }

  const btnOutlineRedStyle: React.CSSProperties = {
    flex: 1,
    padding: '7px 10px',
    fontSize: '0.78rem',
    fontWeight: 600,
    background: C.white,
    color: C.red,
    border: `1.5px solid ${C.red}`,
    borderRadius: '6px',
    cursor: 'pointer',
  }

  return (
    <div style={cardStyle}>
      <div style={monoHeaderStyle}>deep-check / análisis</div>
      <div style={fileLineStyle}>📄 Máster Universitario — 20239.pdf</div>
      <div>
        <div style={fraudBadgeStyle}>FRAUDULENTO</div>
      </div>
      <div style={{ display: 'flex', gap: '20px', marginTop: '6px', marginBottom: '4px' }}>
        <div style={{ fontWeight: 700, color: C.green, fontSize: '0.9rem' }}>Confianza: 94%</div>
        <div style={{ fontWeight: 700, color: C.red, fontSize: '0.9rem' }}>3 anomalías detectadas</div>
      </div>
      <div style={anomalyBoxStyle}>
        {[
          'Fuente tipográfica inconsistente (p.3)',
          'Metadatos de creación alterados',
          'Firma digital inválida',
        ].map((a) => (
          <div key={a} style={anomalyItemStyle}>
            <span>⚠️</span>
            <span>{a}</span>
          </div>
        ))}
      </div>
      <div style={btnRowStyle}>
        <button style={btnOutlineBlueStyle}>Ver informe PDF</button>
        <button style={btnOutlineRedStyle}>Escalar a RRHH</button>
      </div>
    </div>
  )
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */

function MPEDemoContent() {
  /* ── Top bar ──────────────────────────────────────────────────────────────── */
  const topBarStyle: React.CSSProperties = {
    background: C.blueDark,
    color: C.white,
    padding: '10px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '8px',
  }

  const topBarBrandStyle: React.CSSProperties = {
    fontWeight: 700,
    fontSize: '1rem',
    color: C.white,
  }

  const topBarBadgeStyle: React.CSSProperties = {
    background: '#1d4ed8',
    color: '#bfdbfe',
    fontSize: '0.78rem',
    fontWeight: 600,
    padding: '4px 12px',
    borderRadius: '999px',
    border: '1px solid #3b82f6',
  }

  /* ── Hero ─────────────────────────────────────────────────────────────────── */
  const heroSectionStyle: React.CSSProperties = {
    padding: '80px 40px',
    background: C.white,
  }

  const heroInnerStyle: React.CSSProperties = {
    maxWidth: '1100px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'row',
    gap: '60px',
    alignItems: 'center',
    flexWrap: 'wrap',
  }

  const heroLeftStyle: React.CSSProperties = {
    flex: '1 1 400px',
    minWidth: '300px',
  }

  const heroLabelStyle: React.CSSProperties = {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: C.blue,
    marginBottom: '16px',
  }

  const heroH1Style: React.CSSProperties = {
    fontSize: '3rem',
    lineHeight: 1.2,
    color: C.textDark,
    fontWeight: 900,
    margin: '0 0 20px 0',
  }

  const heroH1SpanStyle: React.CSSProperties = {
    color: C.blue,
  }

  const heroSubStyle: React.CSSProperties = {
    fontSize: '1.1rem',
    color: C.textMuted,
    marginTop: '20px',
    lineHeight: 1.65,
    marginBottom: '0',
  }

  const heroBtnRowStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '16px',
    marginTop: '32px',
  }

  const btnPrimaryStyle: React.CSSProperties = {
    display: 'inline-block',
    background: C.blue,
    color: C.white,
    padding: '14px 28px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '1rem',
    fontWeight: 700,
    cursor: 'pointer',
    textDecoration: 'none',
  }

  const btnOutlineStyle: React.CSSProperties = {
    display: 'inline-block',
    background: C.white,
    color: C.blue,
    padding: '14px 28px',
    borderRadius: '8px',
    border: `1.5px solid ${C.blue}`,
    fontSize: '1rem',
    fontWeight: 700,
    cursor: 'pointer',
    textDecoration: 'none',
  }

  const heroRightStyle: React.CSSProperties = {
    flexShrink: 0,
    display: 'flex',
    justifyContent: 'center',
  }

  /* ── Stats bar ────────────────────────────────────────────────────────────── */
  const statsBarStyle: React.CSSProperties = {
    background: '#f0f9ff',
    padding: '32px 40px',
  }

  const statsGridStyle: React.CSSProperties = {
    maxWidth: '1100px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px',
  }

  const statItemStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    padding: '8px',
  }

  const statValueStyle: React.CSSProperties = {
    fontSize: '2.25rem',
    fontWeight: 900,
    color: C.blue,
    lineHeight: 1,
    marginBottom: '8px',
  }

  const statLabelStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    color: C.textMuted,
    fontWeight: 500,
  }

  /* ── Section shared ───────────────────────────────────────────────────────── */
  const sectionStyle: React.CSSProperties = {
    padding: '80px 40px',
    background: C.white,
  }

  const sectionInnerStyle: React.CSSProperties = {
    maxWidth: '1100px',
    margin: '0 auto',
  }

  const sectionH2Style: React.CSSProperties = {
    fontSize: '2rem',
    fontWeight: 900,
    color: C.textDark,
    marginBottom: '16px',
    marginTop: '0',
  }

  const sectionIntroStyle: React.CSSProperties = {
    fontSize: '1rem',
    color: C.textMuted,
    marginBottom: '40px',
    lineHeight: 1.65,
    maxWidth: '600px',
  }

  /* ── Problem cards ────────────────────────────────────────────────────────── */
  const problemCardsRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '24px',
    flexWrap: 'wrap',
  }

  const problemCardStyle: React.CSSProperties = {
    background: C.white,
    border: `1px solid ${C.border}`,
    borderRadius: '12px',
    padding: '28px',
    flex: '1 1 280px',
  }

  const cardIconStyle: React.CSSProperties = {
    fontSize: '2rem',
    marginBottom: '16px',
    display: 'block',
  }

  const cardTitleStyle: React.CSSProperties = {
    fontSize: '1rem',
    fontWeight: 700,
    color: C.textDark,
    marginBottom: '10px',
    marginTop: '0',
  }

  const cardBodyStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    color: C.textMuted,
    lineHeight: 1.65,
    margin: '0',
  }

  /* ── Solution section ─────────────────────────────────────────────────────── */
  const solutionSectionStyle: React.CSSProperties = {
    padding: '80px 40px',
    background: C.cardBg,
  }

  const featureGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '20px',
  }

  const featureCardStyle: React.CSSProperties = {
    background: C.white,
    border: `1px solid ${C.border}`,
    borderRadius: '12px',
    padding: '28px',
    display: 'flex',
    gap: '18px',
    alignItems: 'flex-start',
  }

  const featureIconStyle: React.CSSProperties = {
    fontSize: '1.75rem',
    flexShrink: 0,
    marginTop: '2px',
  }

  /* ── How it works ─────────────────────────────────────────────────────────── */
  const stepsRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '32px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: '48px',
  }

  const stepStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    flex: '1 1 250px',
    maxWidth: '320px',
  }

  const stepCircleStyle: React.CSSProperties = {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    background: C.blue,
    color: C.white,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.5rem',
    fontWeight: 900,
    marginBottom: '20px',
    flexShrink: 0,
  }

  const stepTitleStyle: React.CSSProperties = {
    fontSize: '1.05rem',
    fontWeight: 700,
    color: C.textDark,
    marginBottom: '10px',
    marginTop: '0',
  }

  const stepBodyStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    color: C.textMuted,
    lineHeight: 1.65,
    margin: '0',
  }

  /* ── Live demo CTA ────────────────────────────────────────────────────────── */
  const ctaSectionStyle: React.CSSProperties = {
    background: C.blue,
    color: C.white,
    padding: '80px 40px',
    textAlign: 'center',
  }

  const ctaH2Style: React.CSSProperties = {
    fontSize: '2rem',
    fontWeight: 900,
    color: C.white,
    marginBottom: '14px',
    marginTop: '0',
  }

  const ctaSubStyle: React.CSSProperties = {
    fontSize: '1rem',
    color: '#bfdbfe',
    marginBottom: '36px',
    lineHeight: 1.65,
  }

  const ctaBtnStyle: React.CSSProperties = {
    display: 'inline-block',
    background: C.white,
    color: C.blue,
    padding: '18px 40px',
    fontSize: '1.1rem',
    fontWeight: 700,
    borderRadius: '8px',
    textDecoration: 'none',
    border: 'none',
    cursor: 'pointer',
  }

  /* ── Footer ───────────────────────────────────────────────────────────────── */
  const footerStyle: React.CSSProperties = {
    background: C.textDark,
    color: C.white,
    padding: '40px',
    textAlign: 'center',
  }

  const footerTextStyle: React.CSSProperties = {
    fontSize: '0.85rem',
    color: '#9ca3af',
    marginBottom: '20px',
    maxWidth: '680px',
    margin: '0 auto 20px auto',
    lineHeight: 1.65,
  }

  const footerLinksStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    gap: '24px',
    flexWrap: 'wrap',
  }

  const footerLinkStyle: React.CSSProperties = {
    color: '#9ca3af',
    fontSize: '0.82rem',
    textDecoration: 'none',
  }

  return (
    <div style={{ minHeight: '100vh', background: C.white, fontFamily: 'inherit' }}>

      {/* ── 1. TOP BAR ──────────────────────────────────────────────────────── */}
      <div style={topBarStyle}>
        <span style={topBarBrandStyle}>Deep-Check × Formaciones MPE</span>
        <span style={topBarBadgeStyle}>🔒 Demo confidencial · No compartir</span>
      </div>

      {/* ── 2. HERO ─────────────────────────────────────────────────────────── */}
      <section style={heroSectionStyle}>
        <div style={heroInnerStyle}>
          {/* Left */}
          <div style={heroLeftStyle}>
            <div style={heroLabelStyle}>✓ Verificación forense de documentos educativos</div>
            <h1 style={heroH1Style}>
              Acaba con el fraude en{' '}
              <span style={heroH1SpanStyle}>certificados y titulaciones</span>
            </h1>
            <p style={heroSubStyle}>
              Deep-Check detecta diplomas falsificados, títulos manipulados y credenciales
              fraudulentas en segundos — antes de que causen un problema legal o reputacional
              para Formaciones MPE.
            </p>
            <div style={heroBtnRowStyle}>
              <a href="/dashboard" style={btnPrimaryStyle}>▶ Ver demo en vivo</a>
              <a href="#contacto" style={btnOutlineStyle}>Solicitar propuesta</a>
            </div>
          </div>
          {/* Right */}
          <div style={heroRightStyle}>
            <FraudCard />
          </div>
        </div>
      </section>

      {/* ── 3. STATS BAR ────────────────────────────────────────────────────── */}
      <section style={statsBarStyle}>
        <div style={statsGridStyle}>
          {[
            { value: '94%', label: 'Precisión en detección' },
            { value: '8 seg', label: 'Tiempo de análisis' },
            { value: '+2.000', label: 'Documentos/día' },
            { value: '100%', label: 'Informe legal incluido' },
          ].map((s) => (
            <div key={s.label} style={statItemStyle}>
              <span style={statValueStyle}>{s.value}</span>
              <span style={statLabelStyle}>{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── 4. PROBLEM SECTION ──────────────────────────────────────────────── */}
      <section style={sectionStyle}>
        <div style={sectionInnerStyle}>
          <h2 style={sectionH2Style}>¿A qué se enfrenta Formaciones MPE?</h2>
          <p style={sectionIntroStyle}>
            El fraude documental en el sector educativo crece cada año. Los centros de
            formación son un objetivo frecuente porque los controles manuales son lentos,
            costosos e ineficaces frente a herramientas de edición modernas.
          </p>
          <div style={problemCardsRowStyle}>
            {[
              {
                icon: '🎓',
                title: 'Alumnos con títulos previos falsos',
                body: 'Estudiantes que acceden a formaciones avanzadas presentando requisitos académicos falsificados — títulos universitarios, certificados de FP o acreditaciones previas manipuladas.',
              },
              {
                icon: '📄',
                title: 'Certificados de formación manipulados',
                body: 'Diplomas emitidos por MPE que terceros alteran digitalmente para inflar calificaciones, cambiar fechas o añadir especialidades no cursadas, dañando la reputación del centro.',
              },
              {
                icon: '👔',
                title: 'Fraude en procesos de selección',
                body: 'Candidatos a formadores, tutores o coordinadores que presentan titulaciones académicas fraudulentas para acceder a puestos para los que no están cualificados.',
              },
            ].map((card) => (
              <div key={card.title} style={problemCardStyle}>
                <span style={cardIconStyle}>{card.icon}</span>
                <h3 style={cardTitleStyle}>{card.title}</h3>
                <p style={cardBodyStyle}>{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. SOLUTION SECTION ─────────────────────────────────────────────── */}
      <section style={solutionSectionStyle}>
        <div style={sectionInnerStyle}>
          <h2 style={sectionH2Style}>Deep-Check para centros de formación</h2>
          <p style={sectionIntroStyle}>
            Cuatro capacidades específicas para el ciclo completo de documentación académica,
            desde la admisión hasta la emisión de certificados propios.
          </p>
          <div style={featureGridStyle}>
            {[
              {
                icon: '🔍',
                title: 'Verificación de titulaciones previas',
                body: 'PDFs, títulos universitarios, FP, certificados — análisis forense de metadatos, fuentes tipográficas y capas de edición.',
              },
              {
                icon: '🛡️',
                title: 'Protección de certificados propios',
                body: 'Marca digital invisible embebida en cada diploma que MPE emite. Verificable en segundos por cualquier empresa o institución que los reciba.',
              },
              {
                icon: '📦',
                title: 'Análisis masivo por lotes',
                body: 'Sube 50 documentos a la vez durante procesos de admisión o convocatorias. Resultados individuales en menos de 10 segundos por documento.',
              },
              {
                icon: '⚖️',
                title: 'Informe legal exportable',
                body: 'PDF forense con cadena de evidencias y conclusión técnica. Válido ante notario, juzgado o inspección educativa.',
              },
            ].map((card) => (
              <div key={card.title} style={featureCardStyle}>
                <span style={featureIconStyle}>{card.icon}</span>
                <div>
                  <h3 style={cardTitleStyle}>{card.title}</h3>
                  <p style={cardBodyStyle}>{card.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6. HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section style={sectionStyle}>
        <div style={sectionInnerStyle}>
          <h2 style={sectionH2Style}>Cómo funciona</h2>
          <p style={sectionIntroStyle}>
            Sin instalación, sin formación técnica. Cualquier persona del equipo de
            admisiones puede usar Deep-Check desde el primer día.
          </p>
          <div style={stepsRowStyle}>
            {[
              {
                num: '1',
                title: 'Sube el documento',
                body: 'PDF, imagen escaneada o foto del diploma. Cualquier formato habitual que recibe un centro de formación.',
              },
              {
                num: '2',
                title: 'IA analiza en 8 segundos',
                body: 'ELA, metadatos, fuentes tipográficas, firmas digitales e inconsistencias de compresión JPEG.',
              },
              {
                num: '3',
                title: 'Informe con veredicto',
                body: 'Auténtico, Sospechoso o Fraudulento — con nivel de confianza y mapa visual de anomalías.',
              },
            ].map((step) => (
              <div key={step.num} style={stepStyle}>
                <div style={stepCircleStyle}>{step.num}</div>
                <h3 style={stepTitleStyle}>{step.title}</h3>
                <p style={stepBodyStyle}>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 7. LIVE DEMO CTA ────────────────────────────────────────────────── */}
      <section style={ctaSectionStyle}>
        <h2 style={ctaH2Style}>Prueba ahora con un documento real</h2>
        <p style={ctaSubStyle}>
          Sin tarjeta de crédito · Sin instalación · Resultados en menos de 8 segundos
        </p>
        <a href="/dashboard" style={ctaBtnStyle}>
          Acceder al analizador →
        </a>
      </section>

      {/* ── 8. FOOTER ───────────────────────────────────────────────────────── */}
      <footer style={footerStyle}>
        <p style={footerTextStyle}>
          Deep-Check es una solución de verificación forense de documentos. Esta demo es
          confidencial y está preparada exclusivamente para Formaciones MPE.
        </p>
        <div style={footerLinksStyle}>
          <a href="/privacy" style={footerLinkStyle}>Política de privacidad</a>
          <span style={{ color: '#4b5563' }}>·</span>
          <a href="/terms" style={footerLinkStyle}>Términos de uso</a>
          <span style={{ color: '#4b5563' }}>·</span>
          <a href="/contact" style={footerLinkStyle}>Contacto</a>
        </div>
      </footer>

    </div>
  )
}

export default function MPEDemoPage() {
  const [unlocked, setUnlocked] = useState(() => localStorage.getItem(STORAGE_KEY) === '1')
  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />
  return <MPEDemoContent />
}
