'use client'

import { useState } from 'react'
import { createClient } from '@insforge/sdk'
import Link from 'next/link'

const insforge = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
})

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [sent, setSent]         = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: authError } = await insforge.auth.signInWithOAuth({
      provider: 'google',
      redirectTo: `${window.location.origin}/auth/callback`,
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '420px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '16px',
        padding: '2.5rem',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <Link href="/" style={{ textDecoration: 'none' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>
              Deep-Check<span style={{ color: 'var(--color-primary)' }}>.</span>
            </div>
          </Link>
          <div style={{ color: 'var(--color-text-muted)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
            Accede a tu cuenta
          </div>
        </div>

        {!sent ? (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{
                display: 'block',
                color: 'var(--color-text-muted)',
                fontSize: '0.8rem',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: '0.5rem',
              }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@empresa.com"
                required
                style={{
                  width: '100%',
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  padding: '0.75rem 1rem',
                  color: '#fff',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>

            {error && (
              <div style={{
                background: 'rgba(255,77,77,0.1)',
                border: '1px solid rgba(255,77,77,0.3)',
                borderRadius: '8px',
                padding: '0.75rem',
                color: '#ff4d4d',
                fontSize: '0.85rem',
                marginBottom: '1rem',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              {loading ? 'Enviando enlace…' : 'Enviar magic link →'}
            </button>

            <p style={{
              color: 'var(--color-text-muted)',
              fontSize: '0.8rem',
              textAlign: 'center',
              marginTop: '1.5rem',
            }}>
              Te enviaremos un enlace seguro. Sin contraseña.
            </p>
          </form>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📬</div>
            <h2 style={{ color: 'var(--color-primary)', marginBottom: '0.75rem' }}>
              Revisa tu email
            </h2>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
              Hemos enviado un enlace de acceso a <strong style={{ color: '#fff' }}>{email}</strong>.
              Caduca en 10 minutos.
            </p>
            <button
              onClick={() => { setSent(false); setEmail('') }}
              className="btn btn-outline"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Usar otro email
            </button>
          </div>
        )}

        <div style={{
          borderTop: '1px solid var(--color-border)',
          marginTop: '2rem',
          paddingTop: '1.5rem',
          textAlign: 'center',
        }}>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            ¿No tienes cuenta?{' '}
          </span>
          <Link href="/pricing" style={{ color: 'var(--color-primary)', fontSize: '0.85rem' }}>
            Ver planes →
          </Link>
        </div>
      </div>
    </div>
  )
}
