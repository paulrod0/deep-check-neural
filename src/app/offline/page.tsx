import OfflineReloadButton from './ReloadButton'

export default function OfflinePage() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0f',
      color: '#fff',
      textAlign: 'center',
      padding: '2rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📡</div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.75rem' }}>
        You&apos;re offline
      </h1>
      <p style={{ color: '#888', maxWidth: '360px', lineHeight: 1.6 }}>
        Deep-Check needs a connection for identity verification and document analysis.
        Check your network and try again.
      </p>
      <OfflineReloadButton />
    </main>
  )
}
