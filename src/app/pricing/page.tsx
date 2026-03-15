import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Planes y Precios — Deep-Check',
  description: 'Verificación continua de identidad y forensia documental. Comienza gratis, escala según necesites.',
}

// LemonSqueezy hosted checkout URLs (set in .env.local after LS dashboard setup)
const STARTER_CHECKOUT = process.env.NEXT_PUBLIC_LS_STARTER_CHECKOUT_URL ?? '#'
const PRO_CHECKOUT     = process.env.NEXT_PUBLIC_LS_PRO_CHECKOUT_URL     ?? '#'
const ENTERPRISE_EMAIL = 'pablo@hiumsolutions.com'

const features = {
  free: [
    { label: '10 sesiones de verificación / mes',   ok: true  },
    { label: '5 análisis forenses / mes',            ok: true  },
    { label: 'Dashboard de gestión',                 ok: true  },
    { label: 'Certificados PDF verificables',        ok: true  },
    { label: 'API REST + API key',                   ok: false },
    { label: 'Webhooks',                             ok: false },
    { label: 'Enrollment biométrico',                ok: false },
    { label: 'Soporte prioritario',                  ok: false },
    { label: 'Despliegue on-premise',                ok: false },
  ],
  starter: [
    { label: '50 sesiones de verificación / mes',   ok: true  },
    { label: '20 análisis forenses / mes',           ok: true  },
    { label: 'Dashboard de gestión',                 ok: true  },
    { label: 'Certificados PDF verificables',        ok: true  },
    { label: 'API REST + API key',                   ok: false },
    { label: 'Webhooks',                             ok: false },
    { label: 'Enrollment biométrico',                ok: false },
    { label: 'Soporte por email (72h)',               ok: true  },
    { label: 'Despliegue on-premise',                ok: false },
  ],
  pro: [
    { label: 'Sesiones ilimitadas',                  ok: true  },
    { label: 'Análisis forenses ilimitados',         ok: true  },
    { label: 'Dashboard de gestión',                 ok: true  },
    { label: 'Certificados PDF verificables',        ok: true  },
    { label: 'API REST + API key',                   ok: true  },
    { label: 'Webhooks a tu sistema',                ok: true  },
    { label: 'Enrollment biométrico',                ok: true  },
    { label: 'Soporte por email (48h)',               ok: true  },
    { label: 'Despliegue on-premise',                ok: false },
  ],
  enterprise: [
    { label: 'Sesiones ilimitadas',                  ok: true  },
    { label: 'Análisis forenses ilimitados',         ok: true  },
    { label: 'Dashboard de gestión',                 ok: true  },
    { label: 'Certificados PDF verificables',        ok: true  },
    { label: 'API REST + API key',                   ok: true  },
    { label: 'Webhooks a tu sistema',                ok: true  },
    { label: 'Enrollment biométrico',                ok: true  },
    { label: 'SLA + soporte dedicado',               ok: true  },
    { label: 'Despliegue on-premise (Docker/K8s)',   ok: true  },
    { label: 'SSO / LDAP / Active Directory',        ok: true  },
    { label: 'Código fuente + auditoría',            ok: true  },
    { label: 'ENS / DPIA / compliance AAPP',         ok: true  },
  ],
}

function Check({ ok }: { ok: boolean }) {
  return (
    <span style={{ color: ok ? 'var(--color-primary)' : 'var(--color-text-muted)', marginRight: '0.6rem', flexShrink: 0 }}>
      {ok ? '✓' : '✗'}
    </span>
  )
}

export default function PricingPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>

      {/* ── Nav ── */}
      <nav style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '1.25rem 2rem', borderBottom: '1px solid var(--color-border)',
        maxWidth: '1200px', margin: '0 auto',
      }}>
        <Link href="/" style={{ textDecoration: 'none', fontSize: '1.3rem', fontWeight: 800, color: '#fff' }}>
          Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span>
        </Link>
        <Link href="/auth/login" className="btn btn-outline" style={{ fontSize: '0.9rem' }}>
          Iniciar sesión
        </Link>
      </nav>

      {/* ── Hero ── */}
      <section style={{ textAlign: 'center', padding: '4rem 2rem 3rem' }}>
        <div style={{
          display: 'inline-block',
          background: 'rgba(0,255,157,0.08)',
          border: '1px solid rgba(0,255,157,0.2)',
          borderRadius: '20px',
          padding: '0.3rem 1rem',
          fontSize: '0.8rem',
          color: 'var(--color-primary)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: '1.5rem',
        }}>
          Planes y Precios
        </div>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 800, marginBottom: '1rem', lineHeight: 1.1 }}>
          Verifica identidad.<br />
          <span style={{ background: 'linear-gradient(90deg, var(--color-primary), var(--color-secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Sin comprometer datos.
          </span>
        </h1>
        <p style={{ color: 'var(--color-text-muted)', maxWidth: '560px', margin: '0 auto', fontSize: '1.1rem', lineHeight: 1.6 }}>
          Comienza gratis. Escala cuando lo necesites. Tus datos siempre bajo tu control.
        </p>
      </section>

      {/* ── Pricing cards ── */}
      <section id="planes" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '1.25rem',
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '0 2rem 5rem',
        alignItems: 'start',
      }}>

        {/* FREE */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '16px',
          padding: '2rem',
        }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '0.5rem' }}>Gratis para siempre</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>Free</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 800, color: '#fff' }}>0€</span>
              <span style={{ color: 'var(--color-text-muted)' }}>/mes</span>
            </div>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 2rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            {features.free.map(f => (
              <li key={f.label} style={{ display: 'flex', alignItems: 'center', fontSize: '0.88rem', color: f.ok ? '#fff' : 'var(--color-text-muted)' }}>
                <Check ok={f.ok} />{f.label}
              </li>
            ))}
          </ul>
          <Link href="/auth/login?plan=free" className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', display: 'flex' }}>
            Empezar gratis →
          </Link>
        </div>

        {/* STARTER */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '16px',
          padding: '2rem',
        }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '0.5rem' }}>Para emprender</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>Starter</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 800, color: '#fff' }}>29€</span>
              <span style={{ color: 'var(--color-text-muted)' }}>/mes</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>Facturado mensualmente · IVA incluido</div>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 2rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            {features.starter.map(f => (
              <li key={f.label} style={{ display: 'flex', alignItems: 'center', fontSize: '0.88rem', color: f.ok ? '#fff' : 'var(--color-text-muted)' }}>
                <Check ok={f.ok} />{f.label}
              </li>
            ))}
          </ul>
          <a href={STARTER_CHECKOUT} className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', display: 'flex' }}>
            Suscribirse →
          </a>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', textAlign: 'center', marginTop: '0.75rem' }}>
            Cancela cuando quieras · Pago seguro por Paddle
          </p>
        </div>

        {/* PRO — highlighted */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-primary)',
          borderRadius: '16px',
          padding: '2rem',
          position: 'relative',
          boxShadow: '0 0 40px rgba(0,255,157,0.08)',
        }}>
          <div style={{
            position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)',
            background: 'var(--color-primary)', color: '#000',
            fontSize: '0.7rem', fontWeight: 700, padding: '0.25rem 1rem',
            borderRadius: '20px', textTransform: 'uppercase', letterSpacing: '0.1em', whiteSpace: 'nowrap',
          }}>
            Más popular
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '0.5rem' }}>Para equipos y empresas</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>Pro</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--color-primary)' }}>79€</span>
              <span style={{ color: 'var(--color-text-muted)' }}>/mes</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>Facturado mensualmente · IVA incluido</div>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 2rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            {features.pro.map(f => (
              <li key={f.label} style={{ display: 'flex', alignItems: 'center', fontSize: '0.88rem', color: f.ok ? '#fff' : 'var(--color-text-muted)' }}>
                <Check ok={f.ok} />{f.label}
              </li>
            ))}
          </ul>
          <a href={PRO_CHECKOUT} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', display: 'flex' }}>
            Suscribirse →
          </a>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', textAlign: 'center', marginTop: '0.75rem' }}>
            Cancela cuando quieras · Pago seguro por Paddle
          </p>
        </div>

        {/* ENTERPRISE */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '16px',
          padding: '2rem',
        }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '0.5rem' }}>AAPP · Grandes empresas</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>Enterprise</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 800, color: '#fff' }}>Custom</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>Licencia anual · On-premise disponible</div>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 2rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            {features.enterprise.map(f => (
              <li key={f.label} style={{ display: 'flex', alignItems: 'center', fontSize: '0.88rem', color: f.ok ? '#fff' : 'var(--color-text-muted)' }}>
                <Check ok={f.ok} />{f.label}
              </li>
            ))}
          </ul>
          <a
            href={`mailto:${ENTERPRISE_EMAIL}?subject=Deep-Check Enterprise&body=Hola, me interesa el plan Enterprise para...`}
            className="btn btn-outline"
            style={{ width: '100%', justifyContent: 'center', display: 'flex' }}
          >
            Contactar →
          </a>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section style={{ maxWidth: '720px', margin: '0 auto', padding: '0 2rem 5rem' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '2.5rem', fontSize: '1.5rem', fontWeight: 700 }}>Preguntas frecuentes</h2>
        {[
          {
            q: '¿Los datos biométricos salen de mi servidor?',
            a: 'No. Todo el procesamiento biométrico ocurre en el navegador del candidato. Al servidor solo llegan vectores numéricos derivados, nunca audio ni vídeo.',
          },
          {
            q: '¿Cumple con RGPD y la LOPDGDD?',
            a: 'Sí. Incluimos una DPIA completa (Art. 35 RGPD) y la autodeclaración ENS RD 311/2022. Para el plan Enterprise, el despliegue on-premise garantiza soberanía total del dato.',
          },
          {
            q: '¿Puedo cancelar en cualquier momento?',
            a: 'Sí. Los planes Starter y Pro son mensuales y puedes cancelar desde el portal de facturación. Mantienes el acceso hasta el final del período pagado.',
          },
          {
            q: '¿Qué diferencia hay entre Starter y Pro?',
            a: 'El plan Starter incluye 50 sesiones y 20 análisis documentales por mes, ideal para equipos pequeños. El plan Pro es ilimitado e incluye además API REST, webhooks y enrollment biométrico para integraciones avanzadas.',
          },
          {
            q: '¿Qué es el plan Enterprise on-premise?',
            a: 'Instalas Deep-Check en tus propios servidores (Docker Compose o Kubernetes). Cero dependencias cloud. Incluye código fuente, SLA y soporte para configuración ENS.',
          },
          {
            q: '¿Cómo se integra con mi sistema de RRHH?',
            a: 'Via API REST con autenticación Bearer. Los webhooks notifican tu sistema cuando finaliza una verificación. Compatible con Moodle, Canvas, SAP SuccessFactors y cualquier ATS con API.',
          },
        ].map(({ q, a }) => (
          <div key={q} style={{
            borderBottom: '1px solid var(--color-border)',
            padding: '1.25rem 0',
          }}>
            <div style={{ fontWeight: 600, color: '#fff', marginBottom: '0.5rem' }}>{q}</div>
            <div style={{ color: 'var(--color-text-muted)', lineHeight: 1.6, fontSize: '0.9rem' }}>{a}</div>
          </div>
        ))}
      </section>

      {/* ── Footer CTA ── */}
      <section style={{
        background: 'linear-gradient(135deg, rgba(0,255,157,0.05) 0%, rgba(112,0,255,0.05) 100%)',
        borderTop: '1px solid var(--color-border)',
        padding: '4rem 2rem',
        textAlign: 'center',
      }}>
        <h2 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '1rem' }}>
          Empieza en menos de 2 minutos
        </h2>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
          Sin tarjeta de crédito. Sin instalación. Cancela cuando quieras.
        </p>
        <Link href="/auth/login?plan=free" className="btn btn-primary" style={{ fontSize: '1rem', padding: '0.85rem 2rem' }}>
          Crear cuenta gratis →
        </Link>
      </section>
    </div>
  )
}
