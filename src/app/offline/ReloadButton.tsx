'use client'

export default function OfflineReloadButton() {
  return (
    <button
      onClick={() => window.location.reload()}
      style={{
        marginTop: '2rem',
        padding: '0.75rem 2rem',
        background: '#00e5ff',
        color: '#000',
        border: 'none',
        borderRadius: '6px',
        fontWeight: 600,
        cursor: 'pointer',
        fontSize: '1rem',
      }}
    >
      Try again
    </button>
  )
}
