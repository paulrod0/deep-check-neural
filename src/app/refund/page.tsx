import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Política de Reembolso — Deep-Check',
  description: 'Condiciones de reembolso y cancelación para los planes de suscripción de Deep-Check.',
}

const section: React.CSSProperties = {
  marginBottom: '2.5rem',
}

const h2Style: React.CSSProperties = {
  fontSize: '1.15rem',
  fontWeight: 700,
  color: '#fff',
  marginBottom: '0.75rem',
  paddingBottom: '0.4rem',
  borderBottom: '1px solid var(--color-border)',
}

const pStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  lineHeight: 1.7,
  fontSize: '0.93rem',
  marginBottom: '0.75rem',
}

export default function RefundPolicyPage() {
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
        <div style={{ display: 'flex', gap: '1rem' }}>
          <Link href="/pricing" style={{ color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.9rem' }}>Precios</Link>
          <Link href="/terms"   style={{ color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.9rem' }}>Términos</Link>
          <Link href="/privacy" style={{ color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.9rem' }}>Privacidad</Link>
        </div>
      </nav>

      {/* ── Content ── */}
      <main style={{ maxWidth: '780px', margin: '0 auto', padding: '4rem 2rem 6rem' }}>

        <div style={{
          display: 'inline-block',
          background: 'rgba(0,255,157,0.08)',
          border: '1px solid rgba(0,255,157,0.2)',
          borderRadius: '20px',
          padding: '0.3rem 1rem',
          fontSize: '0.75rem',
          color: 'var(--color-primary)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: '1.5rem',
        }}>
          Legal
        </div>

        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', marginBottom: '0.5rem' }}>
          Política de Reembolso
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '3rem' }}>
          Última actualización: 4 de marzo de 2026
        </p>

        {/* 1 */}
        <section style={section}>
          <h2 style={h2Style}>1. Ámbito de aplicación</h2>
          <p style={pStyle}>
            Esta Política de Reembolso se aplica a todos los planes de suscripción de pago ofrecidos por
            Deep-Check (Hium Solutions, con domicilio en España): <strong>Starter</strong> (29 €/mes) y <strong>Pro</strong> (79 €/mes).
            Los pagos son procesados por <strong>Paddle.com Market Limited</strong>, que actúa como Merchant of Record
            en nombre de Deep-Check.
          </p>
          <p style={pStyle}>
            El plan <strong>Free</strong> no tiene cargo económico alguno y queda excluido de esta política.
            El plan <strong>Enterprise</strong> se rige por el contrato de licencia firmado individualmente.
          </p>
        </section>

        {/* 2 */}
        <section style={section}>
          <h2 style={h2Style}>2. Período de prueba y garantía</h2>
          <p style={pStyle}>
            Deep-Check ofrece un <strong>período de prueba gratuito de 14 días</strong> en los planes Starter y Pro.
            Durante este período puedes cancelar en cualquier momento sin cargo.
          </p>
          <p style={pStyle}>
            Si no estás satisfecho con el servicio, puedes solicitar un reembolso completo dentro de los
            <strong> 14 días naturales siguientes a la primera fecha de facturación</strong> de tu suscripción,
            siempre que el uso acumulado no supere el 20 % de los límites del plan contratado.
          </p>
        </section>

        {/* 3 */}
        <section style={section}>
          <h2 style={h2Style}>3. Cancelación de la suscripción</h2>
          <p style={pStyle}>
            Puedes cancelar tu suscripción en cualquier momento desde el portal de facturación de Paddle,
            accesible desde <em>Dashboard → Configuración → Suscripción → Gestionar</em>.
          </p>
          <p style={pStyle}>
            La cancelación es efectiva al final del período de facturación en curso. Conservarás acceso
            completo al servicio hasta esa fecha. <strong>No se realizan reembolsos prorrateados</strong> por
            los días restantes del período pagado, salvo lo indicado en el apartado 2.
          </p>
          <p style={pStyle}>
            Tras la cancelación, tu cuenta pasará automáticamente al plan <strong>Free</strong> con sus
            límites correspondientes. Los datos y registros históricos se conservan durante 90 días
            adicionales antes de ser eliminados.
          </p>
        </section>

        {/* 4 */}
        <section style={section}>
          <h2 style={h2Style}>4. Renovaciones automáticas</h2>
          <p style={pStyle}>
            Las suscripciones se renuevan automáticamente cada mes en la misma fecha de activación.
            Recibirás un aviso por correo electrónico <strong>7 días antes de cada renovación</strong>.
            Si deseas cancelar, hazlo antes de esa fecha para evitar el cargo del siguiente período.
          </p>
          <p style={pStyle}>
            En caso de fallo en el pago, Paddle reintentará el cargo durante 7 días. Si el pago sigue
            fallando, la cuenta pasará a estado <em>paused</em> y el acceso quedará suspendido temporalmente
            hasta que se regularice la situación o se cancele la suscripción.
          </p>
        </section>

        {/* 5 */}
        <section style={section}>
          <h2 style={h2Style}>5. Excepciones y casos especiales</h2>
          <p style={pStyle}>
            Se tramitarán reembolsos completos sin excepción en los siguientes casos:
          </p>
          <ul style={{ ...pStyle, paddingLeft: '1.5rem' } as React.CSSProperties}>
            <li style={{ marginBottom: '0.5rem' }}>Cargo duplicado o error técnico en el procesamiento del pago.</li>
            <li style={{ marginBottom: '0.5rem' }}>Interrupción del servicio superior a 72 horas consecutivas imputable a Deep-Check.</li>
            <li style={{ marginBottom: '0.5rem' }}>Cambio material en las condiciones del servicio (precio, funcionalidades incluidas) sin previo aviso de 30 días.</li>
          </ul>
          <p style={pStyle}>
            Para estos casos, el reembolso se procesará en un plazo de <strong>5–10 días hábiles</strong>
            al método de pago original, gestionado por Paddle.
          </p>
        </section>

        {/* 6 */}
        <section style={section}>
          <h2 style={h2Style}>6. Cómo solicitar un reembolso</h2>
          <p style={pStyle}>
            Envía un correo a <a href="mailto:pablo@hiumsolutions.com?subject=Solicitud de reembolso Deep-Check"
              style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>pablo@hiumsolutions.com</a> con
            el asunto <em>Solicitud de reembolso</em>, indicando:
          </p>
          <ul style={{ ...pStyle, paddingLeft: '1.5rem' } as React.CSSProperties}>
            <li style={{ marginBottom: '0.5rem' }}>Correo electrónico de la cuenta Deep-Check.</li>
            <li style={{ marginBottom: '0.5rem' }}>Fecha de la factura o ID de transacción de Paddle.</li>
            <li style={{ marginBottom: '0.5rem' }}>Motivo de la solicitud.</li>
          </ul>
          <p style={pStyle}>
            Responderemos en un plazo máximo de <strong>2 días hábiles</strong>.
          </p>
        </section>

        {/* 7 */}
        <section style={section}>
          <h2 style={h2Style}>7. Derecho de desistimiento (UE)</h2>
          <p style={pStyle}>
            De acuerdo con la Directiva 2011/83/UE sobre derechos de los consumidores, los usuarios con
            residencia en la Unión Europea tienen derecho a desistir del contrato en un plazo de
            <strong> 14 días naturales</strong> desde la contratación, sin necesidad de justificación,
            siempre que no hayan comenzado a utilizar el servicio (o hayan renunciado expresamente a este
            derecho para iniciar la prestación inmediata del mismo).
          </p>
          <p style={pStyle}>
            Al activar tu suscripción y acceder al servicio antes del vencimiento del plazo de desistimiento,
            aceptas la prestación inmediata del servicio. En ese caso, el reembolso será proporcional al
            tiempo consumido hasta la solicitud de desistimiento.
          </p>
        </section>

        {/* 8 */}
        <section style={section}>
          <h2 style={h2Style}>8. Ley aplicable</h2>
          <p style={pStyle}>
            Esta política se rige por la legislación española. Los pagos son gestionados por
            Paddle.com Market Limited (27 Old Gloucester Street, Londres, WC1N 3AX, Reino Unido),
            actuando como Merchant of Record, de conformidad con sus propias condiciones de uso.
          </p>
        </section>

        {/* Contact */}
        <div style={{
          background: 'rgba(0,255,157,0.04)',
          border: '1px solid rgba(0,255,157,0.15)',
          borderRadius: '12px',
          padding: '1.5rem',
          marginTop: '2rem',
        }}>
          <p style={{ ...pStyle, marginBottom: 0 }}>
            ¿Tienes alguna duda? Contacta con nosotros en{' '}
            <a href="mailto:pablo@hiumsolutions.com" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
              pablo@hiumsolutions.com
            </a>
            {' '}o visita nuestra{' '}
            <Link href="/pricing" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
              página de precios
            </Link>.
          </p>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer style={{
        borderTop: '1px solid var(--color-border)',
        padding: '2rem',
        textAlign: 'center',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', flexWrap: 'wrap' }}>
          {[
            { label: 'Precios',      href: '/pricing' },
            { label: 'Términos',     href: '/terms'   },
            { label: 'Privacidad',   href: '/privacy'  },
            { label: 'Reembolsos',   href: '/refund'   },
          ].map(l => (
            <Link key={l.href} href={l.href} style={{ color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.85rem' }}>
              {l.label}
            </Link>
          ))}
        </div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginTop: '1rem' }}>
          © {new Date().getFullYear()} Hium Solutions — Deep-Check
        </p>
      </footer>
    </div>
  )
}
