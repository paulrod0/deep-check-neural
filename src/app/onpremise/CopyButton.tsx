'use client'

export default function CopyButton({ text }: { text: string }) {
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text) }}
      style={{
        background: 'rgba(0,229,255,0.15)',
        border: '1px solid var(--color-primary)',
        color: 'var(--color-primary)',
        borderRadius: 6,
        padding: '0.35rem 0.75rem',
        fontSize: '0.75rem',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      Copy
    </button>
  )
}
