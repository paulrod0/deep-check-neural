'use client'

/**
 * MLFeedbackWidget — User feedback component for ML continuous learning
 * =====================================================================
 *
 * Shown after document verification results. Allows users to confirm
 * or correct the model's prediction, feeding data back into the
 * continuous learning pipeline.
 *
 * This is the key differentiator: every verification improves the next one.
 */

import { useState, useCallback } from 'react'

interface MLFeedbackWidgetProps {
  analysisId: string
  predictedLabel: 'genuine' | 'suspicious' | 'tampered'
  predictedScore: number
  documentType?: string
  /** Called after successful submission */
  onSubmitted?: () => void
}

type FeedbackState = 'idle' | 'submitting' | 'success' | 'error'

export default function MLFeedbackWidget({
  analysisId,
  predictedLabel,
  predictedScore,
  documentType,
  onSubmitted,
}: MLFeedbackWidgetProps) {
  const [state, setState]       = useState<FeedbackState>('idle')
  const [selected, setSelected] = useState<'genuine' | 'tampered' | null>(null)
  const [notes, setNotes]       = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const submit = useCallback(async () => {
    if (!selected) return
    setState('submitting')
    setErrorMsg('')

    try {
      const res = await fetch('/api/ml/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis_id: analysisId,
          predicted_label: predictedLabel,
          predicted_score: predictedScore,
          actual_label: selected,
          document_type: documentType || 'unknown',
          notes: notes.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      setState('success')
      onSubmitted?.()
    } catch (err) {
      setState('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit feedback')
    }
  }, [selected, analysisId, predictedLabel, predictedScore, documentType, notes, onSubmitted])

  // Success state
  if (state === 'success') {
    return (
      <div style={{
        background: 'rgba(34,197,94,0.08)',
        border: '1px solid rgba(34,197,94,0.3)',
        borderRadius: 12,
        padding: '1.25rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
      }}>
        <span style={{ fontSize: '1.5rem' }}>🧠</span>
        <div>
          <p style={{ fontWeight: 600, color: '#22c55e', fontSize: '0.9rem', marginBottom: '0.2rem' }}>
            Thank you! Feedback recorded.
          </p>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
            Your correction helps train a more accurate model. The system improves with every verification.
          </p>
        </div>
      </div>
    )
  }

  const isCorrect = selected === (predictedLabel === 'genuine' ? 'genuine' : 'tampered')

  return (
    <div style={{
      background: 'rgba(0,229,255,0.04)',
      border: '1px solid rgba(0,229,255,0.15)',
      borderRadius: 12,
      padding: '1.25rem 1.5rem',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <span style={{ fontSize: '1.2rem' }}>🧠</span>
        <div>
          <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>Help improve our AI</p>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
            Was the model&apos;s prediction correct? Your feedback trains a better model.
          </p>
        </div>
      </div>

      {/* Model prediction display */}
      <div style={{
        background: 'rgba(0,0,0,0.2)',
        borderRadius: 8,
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
      }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Model predicted:</span>
        <span style={{
          padding: '3px 12px',
          borderRadius: 20,
          fontSize: '0.8rem',
          fontWeight: 600,
          background: predictedLabel === 'genuine'
            ? 'rgba(0,229,255,0.15)' : predictedLabel === 'suspicious'
            ? 'rgba(255,215,0,0.15)' : 'rgba(255,77,77,0.15)',
          color: predictedLabel === 'genuine'
            ? 'var(--color-primary)' : predictedLabel === 'suspicious'
            ? '#ffd700' : '#ff4d4d',
        }}>
          {predictedLabel.toUpperCase()}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-dim)' }}>
          ({Math.round(predictedScore)}% confidence)
        </span>
      </div>

      {/* Feedback buttons */}
      <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.6rem' }}>
        What is the actual status of this document?
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <button
          onClick={() => setSelected('genuine')}
          style={{
            flex: 1,
            padding: '0.65rem',
            borderRadius: 8,
            border: `2px solid ${selected === 'genuine' ? '#22c55e' : 'var(--color-border)'}`,
            background: selected === 'genuine' ? 'rgba(34,197,94,0.1)' : 'transparent',
            color: selected === 'genuine' ? '#22c55e' : 'var(--color-text-muted)',
            cursor: 'pointer',
            fontWeight: selected === 'genuine' ? 700 : 400,
            fontSize: '0.88rem',
            transition: 'all 0.2s',
          }}
        >
          ✅ Genuine
        </button>
        <button
          onClick={() => setSelected('tampered')}
          style={{
            flex: 1,
            padding: '0.65rem',
            borderRadius: 8,
            border: `2px solid ${selected === 'tampered' ? '#ff4d4d' : 'var(--color-border)'}`,
            background: selected === 'tampered' ? 'rgba(255,77,77,0.1)' : 'transparent',
            color: selected === 'tampered' ? '#ff4d4d' : 'var(--color-text-muted)',
            cursor: 'pointer',
            fontWeight: selected === 'tampered' ? 700 : 400,
            fontSize: '0.88rem',
            transition: 'all 0.2s',
          }}
        >
          ❌ Tampered / Fake
        </button>
      </div>

      {/* Show correction notice if user disagrees with model */}
      {selected && !isCorrect && (
        <div style={{
          background: 'rgba(255,215,0,0.08)',
          border: '1px solid rgba(255,215,0,0.2)',
          borderRadius: 8,
          padding: '0.6rem 0.9rem',
          marginBottom: '0.75rem',
          fontSize: '0.78rem',
          color: '#ffd700',
        }}>
          ⚡ Your correction will help retrain the model to avoid this mistake in the future.
        </div>
      )}

      {/* Optional notes */}
      {selected && (
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Optional: describe why you think this is genuine/tampered…"
          style={{
            width: '100%',
            minHeight: 60,
            padding: '0.6rem 0.9rem',
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            background: 'rgba(0,0,0,0.2)',
            color: 'var(--color-text)',
            fontSize: '0.82rem',
            resize: 'vertical',
            fontFamily: 'inherit',
            marginBottom: '0.75rem',
          }}
        />
      )}

      {/* Error message */}
      {state === 'error' && errorMsg && (
        <p style={{ color: '#ff4d4d', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
          ⚠️ {errorMsg}
        </p>
      )}

      {/* Submit button */}
      {selected && (
        <button
          onClick={submit}
          disabled={state === 'submitting'}
          className="btn btn-primary"
          style={{
            width: '100%',
            opacity: state === 'submitting' ? 0.6 : 1,
            fontSize: '0.88rem',
          }}
        >
          {state === 'submitting' ? 'Submitting…' : 'Submit Feedback →'}
        </button>
      )}
    </div>
  )
}
