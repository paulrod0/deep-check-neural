'use client'
import React, { useState } from 'react'

const DEMO_PASSWORD = 'san2026'
const STORAGE_KEY = 'dc_demo_san'

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)
  const submit = () => {
    if (input === DEMO_PASSWORD) { localStorage.setItem(STORAGE_KEY, '1'); onUnlock() }
    else { setError(true); setShake(true); setTimeout(() => setShake(false), 500) }
  }
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter','Segoe UI',Arial,sans-serif" }}>
      <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', padding: '48px 40px', width: '100%', maxWidth: '400px', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', textAlign: 'center', animation: shake ? 'shake 0.4s' : 'none' }}>
        <div style={{ width: '56px', height: '56px', backgroundColor: '#EC0000', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: '1.8rem' }}>🔒</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1a1a1a', margin: '0 0 8px' }}>Deep-Check</h1>
        <p style={{ color: '#666666', fontSize: '0.9rem', margin: '0 0 32px' }}>Demo confidencial · Banco Santander</p>
        <input type="password" placeholder="Clave de acceso" value={input} onChange={e => { setInput(e.target.value); setError(false) }} onKeyDown={e => e.key === 'Enter' && submit()}
          style={{ width: '100%', padding: '12px 16px', border: `1.5px solid ${error ? '#ef4444' : '#d1d5db'}`, borderRadius: '8px', fontSize: '1rem', outline: 'none', boxSizing: 'border-box', marginBottom: '8px' }} autoFocus />
        {error && <p style={{ color: '#ef4444', fontSize: '0.85rem', margin: '0 0 12px' }}>Clave incorrecta</p>}
        <button onClick={submit} style={{ width: '100%', backgroundColor: '#EC0000', color: '#ffffff', border: 'none', padding: '13px', borderRadius: '8px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', marginTop: error ? '0' : '12px' }}>Acceder</button>
        <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '24px' }}>Acceso restringido · No compartir</p>
      </div>
      <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }`}</style>
    </div>
  )
}

function SantanderDemoContent() {
  return (
    <div style={{ fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif", margin: 0, padding: 0, backgroundColor: '#ffffff' }}>

      {/* TOP BAR */}
      <div style={{
        backgroundColor: '#EC0000',
        padding: '12px 40px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ color: '#ffffff', fontWeight: 700, fontSize: '1rem' }}>
          Deep-Check × Banco Santander
        </span>
        <span style={{
          backgroundColor: '#c00000',
          color: '#ffffff',
          padding: '4px 12px',
          borderRadius: '4px',
          fontSize: '0.8rem',
          fontWeight: 500,
        }}>
          🔒 Demo confidencial · NDA
        </span>
      </div>

      {/* HERO */}
      <div style={{ backgroundColor: '#1a1a1a', padding: '100px 40px' }}>
        <div style={{
          maxWidth: '1100px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'row',
          gap: '60px',
          alignItems: 'center',
        }}>
          {/* Hero Left */}
          <div style={{ flex: 1 }}>
            <div style={{
              color: '#EC0000',
              fontSize: '0.75rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              marginBottom: '20px',
            }}>
              PREVENCIÓN DE FRAUDE · KYC · AML
            </div>
            <h1 style={{ margin: 0, lineHeight: 1.15 }}>
              <span style={{ fontSize: '3.2rem', color: '#ffffff', fontWeight: 800, display: 'block' }}>
                Fraud documental zero.
              </span>
              <span style={{ fontSize: '3.2rem', color: '#EC0000', fontWeight: 800, display: 'block' }}>
                KYC sin fisuras.
              </span>
            </h1>
            <p style={{
              color: '#aaaaaa',
              fontSize: '1.1rem',
              marginTop: '20px',
              lineHeight: 1.7,
              maxWidth: '520px',
            }}>
              Deep-Check verifica la autenticidad de documentos de identidad, nóminas y extractos bancarios en tiempo real — reduciendo el fraude en onboarding hasta un 87% y acelerando el KYC de días a segundos.
            </p>
            <div style={{ marginTop: '32px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <a href="/dashboard" style={{
                display: 'inline-block',
                backgroundColor: '#EC0000',
                color: '#ffffff',
                padding: '14px 32px',
                borderRadius: '6px',
                border: 'none',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'none',
              }}>
                Ver demo en vivo
              </a>
              <a href="mailto:info@hiumsolutions.com?subject=Piloto Santander" style={{
                display: 'inline-block',
                backgroundColor: 'transparent',
                color: '#ffffff',
                padding: '14px 32px',
                borderRadius: '6px',
                border: '1.5px solid #ffffff',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'none',
              }}>
                Solicitar POC
              </a>
            </div>
          </div>

          {/* Hero Right: KYC Dashboard Card */}
          <div style={{
            backgroundColor: '#2a2a2a',
            borderRadius: '12px',
            padding: '24px',
            minWidth: '340px',
            flexShrink: 0,
          }}>
            <div style={{ color: '#888888', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em', marginBottom: '20px' }}>
              KYC VERIFICATION DASHBOARD
            </div>

            {/* Row 1 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              backgroundColor: '#333333',
              borderRadius: '8px',
              marginBottom: '10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.2rem' }}>📋</span>
                <span style={{ color: '#ffffff', fontSize: '0.9rem', fontWeight: 500 }}>DNI Español</span>
              </div>
              <span style={{
                backgroundColor: '#14532d',
                color: '#4ade80',
                padding: '3px 10px',
                borderRadius: '20px',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}>
                ✅ Auténtico
              </span>
            </div>

            {/* Row 2 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              backgroundColor: '#333333',
              borderRadius: '8px',
              marginBottom: '10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.2rem' }}>💰</span>
                <span style={{ color: '#ffffff', fontSize: '0.9rem', fontWeight: 500 }}>Nómina Feb 2025</span>
              </div>
              <span style={{
                backgroundColor: '#451a03',
                color: '#fb923c',
                padding: '3px 10px',
                borderRadius: '20px',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}>
                ⚠️ Sospechosa
              </span>
            </div>

            {/* Row 3 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              backgroundColor: '#333333',
              borderRadius: '8px',
              marginBottom: '16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.2rem' }}>🏦</span>
                <span style={{ color: '#ffffff', fontSize: '0.9rem', fontWeight: 500 }}>Extracto IBAN</span>
              </div>
              <span style={{
                backgroundColor: '#450a0a',
                color: '#f87171',
                padding: '3px 10px',
                borderRadius: '20px',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}>
                ❌ Fraudulento
              </span>
            </div>

            <div style={{ color: '#666666', fontSize: '0.78rem', textAlign: 'center' }}>
              Procesado en 7.3 segundos
            </div>
          </div>
        </div>
      </div>

      {/* PROBLEM SECTION */}
      <div style={{ backgroundColor: '#f8f8f8', padding: '80px 40px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ color: '#1a1a1a', fontSize: '2.2rem', fontWeight: 800, marginBottom: '40px', marginTop: 0 }}>
            El coste real del fraude documental en banca
          </h2>

          {/* Big Stat Cards */}
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {[
              {
                value: '€4.2B',
                label: 'pérdidas anuales por fraude documental en la banca europea',
                source: '(Fuente: EBA 2024)',
              },
              {
                value: '73%',
                label: 'de los fraudes de onboarding usan documentos alterados digitalmente',
                source: '',
              },
              {
                value: '18 días',
                label: 'tiempo medio de detección de un documento falso con procesos manuales',
                source: '',
              },
            ].map((stat, i) => (
              <div key={i} style={{
                flex: 1,
                minWidth: '220px',
                backgroundColor: '#ffffff',
                borderTop: '4px solid #EC0000',
                padding: '32px',
                borderRadius: '8px',
                textAlign: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}>
                <div style={{ fontSize: '3.5rem', color: '#EC0000', fontWeight: 800, lineHeight: 1.1 }}>
                  {stat.value}
                </div>
                <div style={{ color: '#1a1a1a', fontSize: '0.95rem', marginTop: '12px', lineHeight: 1.5 }}>
                  {stat.label}
                </div>
                {stat.source && (
                  <div style={{ color: '#999999', fontSize: '0.78rem', marginTop: '8px' }}>
                    {stat.source}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pain Point Cards */}
          <div style={{ display: 'flex', gap: '24px', marginTop: '48px', flexWrap: 'wrap' }}>
            {[
              'DNIs y pasaportes alterados en apertura de cuentas',
              'Nóminas e IRPF falsificados para acceder a préstamos e hipotecas',
              'Extractos bancarios manipulados en financiación empresarial',
            ].map((text, i) => (
              <div key={i} style={{
                flex: 1,
                minWidth: '220px',
                backgroundColor: '#ffffff',
                borderLeft: '4px solid #EC0000',
                padding: '24px',
                borderRadius: '0 8px 8px 0',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}>
                <p style={{ margin: 0, color: '#1a1a1a', fontSize: '0.95rem', lineHeight: 1.6 }}>
                  {text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SOLUTION SECTION */}
      <div style={{ backgroundColor: '#ffffff', padding: '80px 40px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ color: '#1a1a1a', fontSize: '2.2rem', fontWeight: 800, marginBottom: '40px', marginTop: 0 }}>
            Deep-Check integrado en el flujo Santander
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '24px',
          }}>
            {[
              {
                icon: '⚡',
                title: 'API REST lista para integrar en minutos',
                points: ['Documentación OpenAPI completa', 'SDKs para Java / .NET', 'Tiempo de integración <1 día'],
              },
              {
                icon: '🔬',
                title: 'Análisis ELA + metadatos + fuentes',
                points: ['Detecta manipulaciones pixel a pixel', 'Sin base de datos de documentos conocidos', 'Inteligencia artificial propia'],
              },
              {
                icon: '🛡️',
                title: 'Cumplimiento PSD2, AML y GDPR',
                points: ['On-premise disponible', 'Los datos no salen de tu infraestructura', 'Auditoría regulatoria incluida'],
              },
              {
                icon: '📊',
                title: 'Auditoría completa exportable',
                points: ['Cada análisis queda registrado', 'Trazabilidad regulatoria full', 'Exportación PDF / CSV / API'],
              },
            ].map((card, i) => (
              <div key={i} style={{
                backgroundColor: '#f8f8f8',
                borderRadius: '10px',
                padding: '32px',
                borderTop: '3px solid #EC0000',
              }}>
                <div style={{ fontSize: '2rem', marginBottom: '14px' }}>{card.icon}</div>
                <h3 style={{ color: '#1a1a1a', fontSize: '1.05rem', fontWeight: 700, margin: '0 0 14px 0' }}>
                  {card.title}
                </h3>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {card.points.map((pt, j) => (
                    <li key={j} style={{ color: '#444444', fontSize: '0.9rem', marginBottom: '6px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <span style={{ color: '#EC0000', fontWeight: 700, flexShrink: 0 }}>—</span>
                      {pt}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* API INTEGRATION SECTION */}
      <div style={{ backgroundColor: '#1a1a1a', padding: '80px 40px' }}>
        <div style={{
          maxWidth: '1100px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'row',
          gap: '60px',
          alignItems: 'flex-start',
        }}>
          {/* Left */}
          <div style={{ flex: 1 }}>
            <h2 style={{ color: '#ffffff', fontSize: '2.2rem', fontWeight: 800, marginTop: 0, marginBottom: '32px' }}>
              Integración sin fricción
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {[
                'SDK disponible para Java, .NET, Python, Node.js',
                'Webhooks en tiempo real al sistema de riesgos',
                'Tiempo de respuesta <8 segundos P99',
                'SLA 99.9% con soporte 24/7',
              ].map((item, i) => (
                <li key={i} style={{
                  color: '#cccccc',
                  fontSize: '1rem',
                  marginBottom: '18px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  lineHeight: 1.5,
                }}>
                  <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '1.1rem', flexShrink: 0 }}>✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Right: Code Block */}
          <div style={{ flex: 1 }}>
            <div style={{
              backgroundColor: '#0d0d0d',
              borderRadius: '8px',
              padding: '24px',
              fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
              fontSize: '0.85rem',
              lineHeight: 1.8,
              border: '1px solid #2a2a2a',
            }}>
              <div>
                <span style={{ color: '#a78bfa' }}>POST</span>
                <span style={{ color: '#ffffff' }}> /api/v1/analyze</span>
              </div>
              <div style={{ color: '#ffffff' }}>{'{'}</div>
              <div style={{ paddingLeft: '16px' }}>
                <span style={{ color: '#a78bfa' }}>&quot;document&quot;</span>
                <span style={{ color: '#ffffff' }}>: </span>
                <span style={{ color: '#34d399' }}>&quot;base64...&quot;</span>
                <span style={{ color: '#ffffff' }}>,</span>
              </div>
              <div style={{ paddingLeft: '16px' }}>
                <span style={{ color: '#a78bfa' }}>&quot;type&quot;</span>
                <span style={{ color: '#ffffff' }}>: </span>
                <span style={{ color: '#34d399' }}>&quot;nomina&quot;</span>
                <span style={{ color: '#ffffff' }}>,</span>
              </div>
              <div style={{ paddingLeft: '16px' }}>
                <span style={{ color: '#a78bfa' }}>&quot;org_id&quot;</span>
                <span style={{ color: '#ffffff' }}>: </span>
                <span style={{ color: '#34d399' }}>&quot;santander-es&quot;</span>
              </div>
              <div style={{ color: '#ffffff' }}>{'}'}</div>
              <div style={{ marginTop: '16px' }}>
                <span style={{ color: '#6b7280' }}>{'// Respuesta en <8s:'}</span>
              </div>
              <div style={{ color: '#ffffff' }}>{'{'}</div>
              <div style={{ paddingLeft: '16px' }}>
                <span style={{ color: '#a78bfa' }}>&quot;verdict&quot;</span>
                <span style={{ color: '#ffffff' }}>: </span>
                <span style={{ color: '#34d399' }}>&quot;suspicious&quot;</span>
                <span style={{ color: '#ffffff' }}>,</span>
              </div>
              <div style={{ paddingLeft: '16px' }}>
                <span style={{ color: '#a78bfa' }}>&quot;confidence&quot;</span>
                <span style={{ color: '#ffffff' }}>: </span>
                <span style={{ color: '#fb923c' }}>0.83</span>
                <span style={{ color: '#ffffff' }}>,</span>
              </div>
              <div style={{ paddingLeft: '16px' }}>
                <span style={{ color: '#a78bfa' }}>&quot;anomalies&quot;</span>
                <span style={{ color: '#ffffff' }}>: [</span>
              </div>
              <div style={{ paddingLeft: '32px' }}>
                <span style={{ color: '#34d399' }}>&quot;Fuente tipográfica no coincide&quot;</span>
                <span style={{ color: '#ffffff' }}>,</span>
              </div>
              <div style={{ paddingLeft: '32px' }}>
                <span style={{ color: '#34d399' }}>&quot;Metadatos alterados&quot;</span>
              </div>
              <div style={{ paddingLeft: '16px' }}>
                <span style={{ color: '#ffffff' }}>]</span>
              </div>
              <div style={{ color: '#ffffff' }}>{'}'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* STATS BAR */}
      <div style={{ backgroundColor: '#EC0000', padding: '40px' }}>
        <div style={{
          maxWidth: '1100px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '24px',
          textAlign: 'center',
        }}>
          {[
            { value: '87%', label: 'reducción de fraude' },
            { value: '8 seg', label: 'por documento' },
            { value: '99.9%', label: 'uptime SLA' },
            { value: 'On-premise', label: 'disponible' },
          ].map((stat, i) => (
            <div key={i}>
              <div style={{ color: '#ffffff', fontSize: '2.4rem', fontWeight: 800, lineHeight: 1.1 }}>
                {stat.value}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', marginTop: '6px' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* DEPLOYMENT OPTIONS */}
      <div style={{ backgroundColor: '#f8f8f8', padding: '80px 40px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ color: '#1a1a1a', fontSize: '2.2rem', fontWeight: 800, marginBottom: '40px', marginTop: 0 }}>
            Opciones de despliegue
          </h2>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {/* Cloud SaaS */}
            <div style={{
              flex: 1,
              minWidth: '260px',
              backgroundColor: '#ffffff',
              border: '1px solid #e0e0e0',
              padding: '32px',
              borderRadius: '10px',
            }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '12px' }}>☁️</div>
              <h3 style={{ color: '#1a1a1a', fontSize: '1.2rem', fontWeight: 700, margin: '0 0 10px 0' }}>
                Cloud SaaS
              </h3>
              <p style={{ color: '#666666', fontSize: '0.9rem', marginBottom: '20px', lineHeight: 1.6 }}>
                Datos procesados en infraestructura EU · ISO 27001 · SOC 2 Type II
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {[
                  'Sin infraestructura que mantener',
                  'Actualizaciones automáticas',
                  'Desde 29€/mes',
                ].map((item, i) => (
                  <li key={i} style={{ color: '#444444', fontSize: '0.9rem', marginBottom: '8px', display: 'flex', gap: '8px' }}>
                    <span style={{ color: '#EC0000' }}>✓</span> {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* On-Premise */}
            <div style={{
              flex: 1,
              minWidth: '260px',
              backgroundColor: '#ffffff',
              border: '2px solid #EC0000',
              padding: '32px',
              borderRadius: '10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.8rem' }}>🏦</span>
                <span style={{
                  backgroundColor: '#EC0000',
                  color: '#ffffff',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: '4px',
                  letterSpacing: '0.05em',
                }}>
                  RECOMENDADO BANCA
                </span>
              </div>
              <h3 style={{ color: '#1a1a1a', fontSize: '1.2rem', fontWeight: 700, margin: '0 0 10px 0' }}>
                On-Premise
              </h3>
              <p style={{ color: '#666666', fontSize: '0.9rem', marginBottom: '20px', lineHeight: 1.6 }}>
                Desplegado en los servidores del Santander · Datos nunca salen
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {[
                  'Control total de datos',
                  'Cumplimiento regulatorio total',
                  'Precio personalizado',
                ].map((item, i) => (
                  <li key={i} style={{ color: '#444444', fontSize: '0.9rem', marginBottom: '8px', display: 'flex', gap: '8px' }}>
                    <span style={{ color: '#EC0000', fontWeight: 700 }}>✓</span> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* FINAL CTA */}
      <div style={{ backgroundColor: '#EC0000', padding: '80px 40px', textAlign: 'center' }}>
        <h2 style={{ color: '#ffffff', fontSize: '2.4rem', fontWeight: 800, margin: '0 0 16px 0' }}>
          Propón un piloto de 30 días
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.88)', fontSize: '1.1rem', marginBottom: '36px', lineHeight: 1.6 }}>
          Sin coste. Sin compromiso. Con datos reales del Santander en entorno sandbox.
        </p>
        <a
          href="mailto:info@hiumsolutions.com?subject=Piloto Santander"
          style={{
            display: 'inline-block',
            backgroundColor: '#ffffff',
            color: '#EC0000',
            padding: '18px 48px',
            fontSize: '1.1rem',
            fontWeight: 700,
            borderRadius: '6px',
            textDecoration: 'none',
          }}
        >
          Iniciar conversación →
        </a>
      </div>

      {/* FOOTER */}
      <div style={{ backgroundColor: '#1a1a1a', padding: '32px', textAlign: 'center' }}>
        <p style={{ color: '#666666', fontSize: '0.82rem', margin: 0, lineHeight: 1.6 }}>
          Esta presentación es confidencial y está preparada exclusivamente para Banco Santander.
          Deep-Check · deep-check-two.vercel.app
        </p>
      </div>

    </div>
  )
}

export default function SantanderDemoPage() {
  const [unlocked, setUnlocked] = useState(() => localStorage.getItem(STORAGE_KEY) === '1')
  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />
  return <SantanderDemoContent />
}
