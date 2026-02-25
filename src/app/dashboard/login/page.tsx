'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import styles from './page.module.css'

export default function DashboardLoginPage() {
    const [password, setPassword] = useState('')
    const [error, setError]       = useState('')
    const [loading, setLoading]   = useState(false)
    const router       = useRouter()
    const searchParams = useSearchParams()
    const from         = searchParams.get('from') ?? '/dashboard'

    // If already logged in, redirect
    useEffect(() => {
        const cookie = document.cookie
        if (cookie.includes('dc_admin_session=dc_admin_')) {
            router.replace(from)
        }
    }, [from, router])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!password) return
        setLoading(true)
        setError('')

        try {
            const res = await fetch('/api/auth/dashboard', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ password }),
            })

            if (res.ok) {
                router.replace(from)
            } else {
                setError('Contraseña incorrecta')
                setPassword('')
            }
        } catch {
            setError('Error de conexión')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className={styles.page}>
            <div className={styles.card}>
                <div className={styles.logo}>
                    Deep-Check<span className={styles.dot}>.</span>
                </div>
                <h1 className={styles.title}>Acceso al Panel</h1>
                <p className={styles.subtitle}>
                    Área restringida — ENS op.acc.5
                </p>

                <form onSubmit={handleSubmit} className={styles.form}>
                    <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Contraseña de administrador"
                        className={styles.input}
                        autoFocus
                        autoComplete="current-password"
                    />
                    {error && <p className={styles.error}>{error}</p>}
                    <button
                        type="submit"
                        className={styles.btn}
                        disabled={loading || !password}
                    >
                        {loading ? 'Verificando…' : 'Entrar →'}
                    </button>
                </form>

                <p className={styles.note}>
                    Acceso registrado. Los intentos fallidos quedan en el log de auditoría.
                </p>
            </div>
        </div>
    )
}
