'use client'
import React, { useState } from 'react'

const DEMO_PASSWORD = 'bbva2026'
const STORAGE_KEY = 'dc_demo_bbva'

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)
  const submit = () => {
    if (input === DEMO_PASSWORD) { localStorage.setItem(STORAGE_KEY, '1'); onUnlock() }
    else { setError(true); setShake(true); setTimeout(() => setShake(false), 500) }
  }
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#072146', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter','Segoe UI',Arial,sans-serif" }}>
      <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', padding: '48px 40px', width: '100%', maxWidth: '400px', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', textAlign: 'center', animation: shake ? 'shake 0.4s' : 'none' }}>
        <div style={{ width: '56px', height: '56px', backgroundColor: '#004481', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: '1.8rem' }}>🔒</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1a2332', margin: '0 0 8px' }}>Deep-Check</h1>
        <p style={{ color: '#5a6a7e', fontSize: '0.9rem', margin: '0 0 32px' }}>Demo confidencial · BBVA</p>
        <input type="password" placeholder="Clave de acceso" value={input} onChange={e => { setInput(e.target.value); setError(false) }} onKeyDown={e => e.key === 'Enter' && submit()}
          style={{ width: '100%', padding: '12px 16px', border: `1.5px solid ${error ? '#ef4444' : '#d1e3f8'}`, borderRadius: '8px', fontSize: '1rem', outline: 'none', boxSizing: 'border-box', marginBottom: '8px' }} autoFocus />
        {error && <p style={{ color: '#ef4444', fontSize: '0.85rem', margin: '0 0 12px' }}>Clave incorrecta</p>}
        <button onClick={submit} style={{ width: '100%', backgroundColor: '#004481', color: '#ffffff', border: 'none', padding: '13px', borderRadius: '8px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', marginTop: error ? '0' : '12px' }}>Acceder</button>
        <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '24px' }}>Acceso restringido · No compartir</p>
      </div>
      <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }`}</style>
    </div>
  )
}

function BBVADemoContent() {
  return (
    <div style={{ fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", color: '#1a2332', margin: 0, padding: 0 }}>

      {/* 1. TOP BAR */}
      <div style={{ backgroundColor: '#004481', padding: '12px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#ffffff', fontWeight: 700, fontSize: '1rem', letterSpacing: '0.02em' }}>
          Deep-Check × BBVA
        </span>
        <span style={{ backgroundColor: '#5BC4F5', color: '#004481', padding: '4px 14px', borderRadius: '4px', fontWeight: 600, fontSize: '0.85rem' }}>
          🔒 Demo confidencial
        </span>
      </div>

      {/* 2. HERO */}
      <div style={{ background: 'linear-gradient(135deg, #072146 0%, #004481 100%)', padding: '100px 40px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'row', gap: '60px', alignItems: 'center' }}>

          {/* Hero Left */}
          <div style={{ flex: 1 }}>
            <div style={{ color: '#5BC4F5', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.12em', marginBottom: '20px' }}>
              ONBOARDING DIGITAL · FRAUDE · DEEPFAKES
            </div>
            <h1 style={{ fontSize: '3.2rem', color: '#ffffff', lineHeight: 1.15, margin: 0, fontWeight: 800 }}>
              Onboarding digital.<br />
              <span style={{ color: '#5BC4F5' }}>Fraude imposible.</span>
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '1.1rem', marginTop: '20px', lineHeight: 1.7, maxWidth: '520px' }}>
              Deep-Check protege cada punto de contacto digital de BBVA — desde la apertura de cuenta hasta la concesión de crédito — detectando identidades falsas, deepfakes y documentos manipulados en menos de 8 segundos.
            </p>
            <div style={{ display: 'flex', gap: '16px', marginTop: '36px', flexWrap: 'wrap' }}>
              <a
                href="/dashboard"
                style={{ backgroundColor: '#5BC4F5', color: '#004481', padding: '14px 32px', borderRadius: '6px', border: 'none', fontWeight: 700, fontSize: '1rem', textDecoration: 'none', display: 'inline-block', cursor: 'pointer' }}
              >
                Ver demo en vivo
              </a>
              <a
                href="mailto:info@hiumsolutions.com"
                style={{ backgroundColor: 'transparent', border: '1.5px solid #ffffff', color: '#ffffff', padding: '14px 32px', borderRadius: '6px', fontWeight: 600, fontSize: '1rem', textDecoration: 'none', display: 'inline-block', cursor: 'pointer' }}
              >
                Hablar con el equipo
              </a>
            </div>
          </div>

          {/* Hero Right: Onboarding Card */}
          <div style={{ minWidth: '320px', maxWidth: '380px', backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px', padding: '24px', backdropFilter: 'blur(10px)' }}>
            <div style={{ color: '#ffffff', opacity: 0.6, fontSize: '0.78rem', fontWeight: 600, letterSpacing: '0.08em', marginBottom: '6px' }}>
              SESIÓN ONBOARDING DIGITAL
            </div>
            <div style={{ color: '#ffffff', fontSize: '0.9rem', marginBottom: '18px', fontWeight: 500 }}>
              Cliente: María García Ruiz
            </div>

            {/* Verification items */}
            {[
              { icon: '🤳', label: 'Selfie verificado', status: '✅', statusText: 'Verificado', statusColor: '#22c55e', isAmber: false },
              { icon: '🪪', label: 'DNI escaneado', status: '✅', statusText: 'Verificado', statusColor: '#22c55e', isAmber: false },
              { icon: '💼', label: 'Nómina aportada', status: '⚠️', statusText: 'Posible manipulación', statusColor: '#f59e0b', isAmber: true },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.1)', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.2rem' }}>{item.icon}</span>
                  <span style={{ color: '#ffffff', fontSize: '0.88rem' }}>{item.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '1rem' }}>{item.status}</span>
                  <span style={{ color: item.statusColor, fontSize: '0.78rem', fontWeight: 600 }}>{item.statusText}</span>
                </div>
              </div>
            ))}

            {/* Risk Score */}
            <div style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ color: '#ffffff', fontSize: '0.85rem', fontWeight: 600 }}>Riesgo: MEDIO</span>
                <span style={{ color: '#f59e0b', fontSize: '0.85rem', fontWeight: 700 }}>65%</span>
              </div>
              <div style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                <div style={{ width: '65%', height: '100%', backgroundColor: '#f59e0b', borderRadius: '4px' }} />
              </div>
              <div style={{ color: '#f59e0b', fontSize: '0.78rem', fontWeight: 600, marginTop: '10px' }}>
                ⚠ Revisión recomendada
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. DIFFERENTIATOR BANNER */}
      <div style={{ backgroundColor: '#5BC4F5', padding: '32px 40px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', textAlign: 'center' }}>
          <p style={{ color: '#004481', fontSize: '1.1rem', fontStyle: 'italic', fontWeight: 500, margin: 0, lineHeight: 1.7 }}>
            &quot;BBVA fue pionero en banca digital. Deep-Check es el siguiente paso: verificación forense de documentos nativamente digital y transparente para el cliente.&quot;
          </p>
        </div>
      </div>

      {/* 4. PROBLEM SECTION */}
      <div style={{ backgroundColor: '#ffffff', padding: '80px 40px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ color: '#004481', fontSize: '2rem', fontWeight: 800, marginBottom: '40px', marginTop: 0 }}>
            Los vectores de fraude en banca digital
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {[
              {
                icon: '🎭',
                title: 'Deepfakes en videollamadas',
                badge: 'CRÍTICO',
                badgeColor: '#dc2626',
                desc: 'IA generativa permite suplantar identidades en verificaciones en vivo. Indistinguibles para el ojo humano.',
              },
              {
                icon: '🤖',
                title: 'Documentos sintéticos de IA',
                badge: 'CRÍTICO',
                badgeColor: '#dc2626',
                desc: 'DNIs y nóminas generadas por DALL-E o Midjourney superan filtros de OCR tradicionales.',
              },
              {
                icon: '🔑',
                title: 'Account Takeover',
                badge: 'ALTO',
                badgeColor: '#ea580c',
                desc: 'Documentos robados + foto alterada para cambiar titularidad de cuentas existentes.',
              },
              {
                icon: '💳',
                title: 'Fraude en préstamos inmediatos',
                badge: 'ALTO',
                badgeColor: '#ea580c',
                desc: 'FICO scores inflados con extractos bancarios manipulados en solicitudes digitales.',
              },
            ].map((card, i) => (
              <div key={i} style={{ backgroundColor: '#f0f6ff', borderLeft: '4px solid #004481', padding: '28px', borderRadius: '0 8px 8px 0', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '20px', right: '20px', backgroundColor: card.badgeColor, color: '#ffffff', fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '4px', letterSpacing: '0.06em' }}>
                  {card.badge}
                </div>
                <div style={{ fontSize: '1.6rem', marginBottom: '12px' }}>{card.icon}</div>
                <h3 style={{ color: '#004481', fontSize: '1.05rem', fontWeight: 700, margin: '0 0 10px 0' }}>{card.title}</h3>
                <p style={{ color: '#5a6a7e', fontSize: '0.92rem', lineHeight: 1.6, margin: 0 }}>{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5. SOLUTION SECTION */}
      <div style={{ backgroundColor: '#f0f6ff', padding: '80px 40px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ color: '#004481', fontSize: '2rem', fontWeight: 800, marginBottom: '40px', marginTop: 0 }}>
            Deep-Check para el ecosistema BBVA
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {[
              {
                icon: '🎥',
                title: 'Detección de deepfakes en video',
                desc: 'Análisis frame a frame de sesiones de verificación. Detecta artefactos de síntesis en menos de 2 segundos por frame.',
              },
              {
                icon: '🔬',
                title: 'Documentos sintéticos de IA',
                desc: 'Detecta imágenes generadas por difusión: ruido sintético, artefactos de bordes, inconsistencias de perspectiva.',
              },
              {
                icon: '🔌',
                title: 'API para BBVA Next',
                desc: 'Integración con microservicios en Kubernetes. OpenAPI 3.0, SDK para Java/Node, latencia <8s P99.',
              },
              {
                icon: '🔔',
                title: 'Webhook en tiempo real',
                desc: 'Notificación instantánea al sistema de riesgos cuando se detecta anomalía. Payload STIX 2.1.',
              },
            ].map((card, i) => (
              <div key={i} style={{ backgroundColor: '#ffffff', border: '1px solid #d1e3f8', borderRadius: '12px', padding: '28px' }}>
                <div style={{ fontSize: '1.8rem', marginBottom: '14px' }}>{card.icon}</div>
                <h3 style={{ color: '#004481', fontSize: '1.05rem', fontWeight: 700, margin: '0 0 10px 0' }}>{card.title}</h3>
                <p style={{ color: '#5a6a7e', fontSize: '0.92rem', lineHeight: 1.6, margin: 0 }}>{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 6. ARCHITECTURE SECTION */}
      <div style={{ backgroundColor: '#072146', padding: '80px 40px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ color: '#ffffff', fontSize: '2rem', fontWeight: 800, marginBottom: '50px', marginTop: 0, textAlign: 'center' }}>
            Arquitectura pensada para BBVA
          </h2>

          {/* Architecture flow */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0', flexWrap: 'wrap', rowGap: '16px' }}>

            {/* App BBVA */}
            <div style={{ backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(91,196,245,0.3)', borderRadius: '8px', padding: '12px 20px', color: '#ffffff', fontSize: '0.85rem', textAlign: 'center', fontWeight: 600 }}>
              App BBVA
            </div>
            <div style={{ color: '#5BC4F5', fontSize: '1.4rem', padding: '0 8px', fontWeight: 700 }}>→</div>

            {/* API Gateway */}
            <div style={{ backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(91,196,245,0.3)', borderRadius: '8px', padding: '12px 20px', color: '#ffffff', fontSize: '0.85rem', textAlign: 'center', fontWeight: 600 }}>
              API Gateway
            </div>
            <div style={{ color: '#5BC4F5', fontSize: '1.4rem', padding: '0 8px', fontWeight: 700 }}>→</div>

            {/* Deep-Check Engine */}
            <div style={{ backgroundColor: 'rgba(91,196,245,0.15)', border: '1px solid rgba(91,196,245,0.5)', borderRadius: '8px', padding: '12px 20px', color: '#5BC4F5', fontSize: '0.85rem', textAlign: 'center', fontWeight: 700 }}>
              Deep-Check Engine
            </div>
            <div style={{ color: '#5BC4F5', fontSize: '1.4rem', padding: '0 8px', fontWeight: 700 }}>→</div>

            {/* Analysis mini grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {['ELA Analysis', 'AI Detector', 'EXIF Parser', 'Deepfake Scanner'].map((item, i) => (
                <div key={i} style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(91,196,245,0.2)', borderRadius: '6px', padding: '8px 12px', color: '#ffffff', fontSize: '0.75rem', textAlign: 'center', fontWeight: 500 }}>
                  {item}
                </div>
              ))}
            </div>
            <div style={{ color: '#5BC4F5', fontSize: '1.4rem', padding: '0 8px', fontWeight: 700 }}>→</div>

            {/* Risk Score */}
            <div style={{ backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(91,196,245,0.3)', borderRadius: '8px', padding: '12px 20px', color: '#ffffff', fontSize: '0.85rem', textAlign: 'center', fontWeight: 600 }}>
              Risk Score
            </div>
            <div style={{ color: '#5BC4F5', fontSize: '1.4rem', padding: '0 8px', fontWeight: 700 }}>→</div>

            {/* BBVA Core Banking */}
            <div style={{ backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(91,196,245,0.3)', borderRadius: '8px', padding: '12px 20px', color: '#ffffff', fontSize: '0.85rem', textAlign: 'center', fontWeight: 600 }}>
              BBVA Core Banking
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: '36px', color: '#5BC4F5', fontSize: '0.83rem', fontWeight: 500, letterSpacing: '0.04em' }}>
            Sin almacenamiento de datos sensibles · Zero-knowledge analysis · Todo procesado en memoria
          </div>
        </div>
      </div>

      {/* 7. COMPLIANCE SECTION */}
      <div style={{ backgroundColor: '#ffffff', padding: '80px 40px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ color: '#004481', fontSize: '2rem', fontWeight: 800, marginBottom: '40px', marginTop: 0 }}>
            Cumplimiento regulatorio
          </h2>
          <div style={{ display: 'flex', flexDirection: 'row', gap: '24px', flexWrap: 'wrap' }}>
            {[
              {
                icon: '🇪🇺',
                title: 'GDPR & LOPD',
                desc: 'Procesamiento conforme al RGPD europeo y Ley Orgánica 3/2018. DPA disponible.',
              },
              {
                icon: '🏦',
                title: 'PSD2 & EBA Guidelines',
                desc: 'Cumplimiento con directrices EBA sobre autenticación reforzada y seguridad de pagos.',
              },
              {
                icon: '🏛️',
                title: 'ENS · RD 311/2022',
                desc: 'Compatible con el Esquema Nacional de Seguridad para administraciones y entidades críticas.',
              },
            ].map((card, i) => (
              <div key={i} style={{ border: '2px solid #d1e3f8', borderRadius: '12px', padding: '28px', textAlign: 'center', flex: 1, minWidth: '200px' }}>
                <div style={{ fontSize: '2.2rem', marginBottom: '14px' }}>{card.icon}</div>
                <h3 style={{ color: '#004481', fontSize: '1.05rem', fontWeight: 700, margin: '0 0 12px 0' }}>{card.title}</h3>
                <p style={{ color: '#5a6a7e', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 8. HOW IT WORKS */}
      <div style={{ backgroundColor: '#f0f6ff', padding: '80px 40px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ color: '#004481', fontSize: '2rem', fontWeight: 800, marginBottom: '50px', marginTop: 0 }}>
            Flujo de integración
          </h2>

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: '0', position: 'relative' }}>
            {[
              {
                num: '1',
                title: 'Cliente completa onboarding',
                desc: 'App móvil BBVA, sube DNI + selfie + documentación',
              },
              {
                num: '2',
                title: 'Deep-Check analiza en background',
                desc: '8 segundos, invisible para el usuario final',
              },
              {
                num: '3',
                title: 'Score de riesgo al instante',
                desc: 'Verde / amarillo / rojo enviado al motor de decisiones BBVA',
              },
            ].map((step, i) => (
              <React.Fragment key={i}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', flex: 1, maxWidth: '280px' }}>
                  <div style={{ width: '64px', height: '64px', backgroundColor: '#004481', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: '1.5rem', fontWeight: 800, marginBottom: '20px', flexShrink: 0 }}>
                    {step.num}
                  </div>
                  <h3 style={{ color: '#004481', fontSize: '1rem', fontWeight: 700, margin: '0 0 10px 0' }}>{step.title}</h3>
                  <p style={{ color: '#5a6a7e', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>{step.desc}</p>
                </div>
                {i < 2 && (
                  <div style={{ flex: 'none', padding: '0 10px', marginTop: '30px', background: 'linear-gradient(90deg, #004481, #5BC4F5)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontSize: '2rem', fontWeight: 700, alignSelf: 'flex-start' }}>
                    →
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* 9. STATS BAR */}
      <div style={{ backgroundColor: '#004481', padding: '40px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ maxWidth: '1100px', width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '20px', textAlign: 'center' }}>
          {[
            { value: '91%', label: 'fraudes detectados en onboarding' },
            { value: '<8s', label: 'latencia P99' },
            { value: '0 datos', label: 'almacenados' },
            { value: 'API-first', label: 'integración nativa' },
          ].map((stat, i) => (
            <div key={i}>
              <div style={{ color: '#5BC4F5', fontSize: '2.2rem', fontWeight: 800, lineHeight: 1.1 }}>{stat.value}</div>
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', marginTop: '8px', lineHeight: 1.4 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 10. PILOT SECTION */}
      <div style={{ backgroundColor: '#ffffff', padding: '80px 40px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ color: '#004481', fontSize: '2rem', fontWeight: 800, marginBottom: '12px', marginTop: 0 }}>
            Piloto de 60 días con BBVA
          </h2>
          <p style={{ color: '#5a6a7e', fontSize: '1rem', marginBottom: '36px', marginTop: 0 }}>
            Con datos reales en entorno sandbox · Sin coste · Sin permanencia
          </p>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            {[
              {
                phase: 'Fase 1 · Semana 1-2',
                desc: 'Integración técnica, setup en sandbox, formación del equipo',
                highlight: false,
                highlightLabel: null,
              },
              {
                phase: 'Fase 2 · Semana 3-8',
                desc: 'Análisis de documentos reales, calibración de umbrales, reporting semanal',
                highlight: true,
                highlightLabel: 'FASE PRINCIPAL',
              },
              {
                phase: 'Fase 3 · Semana 9+',
                desc: 'Decisión de escalado a producción, negociación de contrato enterprise',
                highlight: false,
                highlightLabel: null,
              },
            ].map((card, i) => (
              <div key={i} style={{
                border: card.highlight ? '2px solid #004481' : '1px solid #d1e3f8',
                borderRadius: '8px',
                padding: '24px',
                flex: 1,
                minWidth: '200px',
                backgroundColor: card.highlight ? '#f0f6ff' : '#ffffff',
              }}>
                {card.highlightLabel && (
                  <div style={{ backgroundColor: '#004481', color: '#ffffff', fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '4px', display: 'inline-block', marginBottom: '12px', letterSpacing: '0.06em' }}>
                    {card.highlightLabel}
                  </div>
                )}
                <h3 style={{ color: '#004481', fontSize: '1rem', fontWeight: 700, margin: '0 0 10px 0' }}>{card.phase}</h3>
                <p style={{ color: '#5a6a7e', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 11. FINAL CTA */}
      <div style={{ background: 'linear-gradient(135deg, #004481 0%, #072146 100%)', padding: '80px 40px', textAlign: 'center' }}>
        <h2 style={{ color: '#ffffff', fontSize: '2.2rem', fontWeight: 800, margin: '0 0 16px 0' }}>
          Iniciemos el piloto
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '1.05rem', margin: '0 0 36px 0' }}>
          Sin lock-in · NDA en el primer día · Respuesta en 24h
        </p>
        <a
          href="mailto:info@hiumsolutions.com?subject=Piloto BBVA"
          style={{ backgroundColor: '#5BC4F5', color: '#004481', padding: '18px 48px', fontSize: '1.1rem', borderRadius: '6px', fontWeight: 700, textDecoration: 'none', display: 'inline-block', cursor: 'pointer' }}
        >
          Contactar con el equipo →
        </a>
        <div style={{ marginTop: '24px', color: 'rgba(255,255,255,0.65)', fontSize: '0.95rem' }}>
          O prueba el producto directamente:{' '}
          <a href="/dashboard" style={{ color: '#5BC4F5', textDecoration: 'underline' }}>
            Ver demo en vivo
          </a>
        </div>
      </div>

      {/* 12. FOOTER */}
      <div style={{ backgroundColor: '#1a2332', padding: '32px', textAlign: 'center', fontSize: '0.85rem', color: '#5a6a7e' }}>
        Esta presentación es confidencial y está preparada exclusivamente para BBVA. Deep-Check · deep-check-two.vercel.app
      </div>

    </div>
  )
}

export default function BBVADemoPage() {
  const [unlocked, setUnlocked] = useState(() => typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1')
  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />
  return <BBVADemoContent />
}
