'use client'

/**
 * DocumentCapture — Guided ID Document Capture Component
 * =======================================================
 * Displays a live camera feed with a document-shaped overlay.
 * Analyzes each frame for blur and glare in real-time.
 * Captures a high-quality still when the user clicks the button.
 *
 * Also accepts drag-and-drop or file input as fallback.
 */

import { useRef, useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DocumentCaptureProps {
  onCapture: (dataUrl: string) => void
  documentType: 'passport' | 'dni' | 'driving_license'
}

type QualityStatus = 'ok' | 'blur' | 'glare' | 'no_camera'

// ── Quality analysis helpers ──────────────────────────────────────────────────

/** Compute Sobel gradient variance to detect blur */
function computeBlurScore(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const data = ctx.getImageData(0, 0, w, h).data
  let sum = 0, count = 0

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const toGray = (i: number) => {
        const base = (y + i) * w * 4 + x * 4
        return 0.299 * data[base] + 0.587 * data[base + 1] + 0.114 * data[base + 2]
      }
      const gx = -toGray(-1) + toGray(1)
      const gy = -toGray(-w) + toGray(w)
      const mag = Math.sqrt(gx * gx + gy * gy)
      sum += mag * mag
      count++
    }
  }
  // Variance of gradient magnitude — low = blur
  return count > 0 ? sum / count : 0
}

/** Fraction of overexposed (glare) pixels */
function glareScore(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const data = ctx.getImageData(0, 0, w, h).data
  let bright = 0
  const total = w * h
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    if (lum > 250) bright++
  }
  return bright / total
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DocumentCapture({ onCapture, documentType }: DocumentCaptureProps) {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const overlayRef  = useRef<HTMLCanvasElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const rafRef      = useRef<number>(0)
  const fileRef     = useRef<HTMLInputElement>(null)

  const [quality, setQuality]    = useState<QualityStatus>('ok')
  const [preview, setPreview]    = useState<string | null>(null)
  const [cameraError, setCameraError] = useState(false)

  // ── Document overlay shape ──────────────────────────────────────────────────

  const drawOverlay = useCallback((canvas: HTMLCanvasElement, status: QualityStatus) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { width: W, height: H } = canvas

    ctx.clearRect(0, 0, W, H)

    // Semi-dark background outside the document region
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, 0, W, H)

    // Document rect — different aspect ratios per type
    const isPassport = documentType === 'passport'
    const boxW = W * 0.84
    const boxH = isPassport ? boxW * 0.71 : boxW * 0.63  // passport vs ID card ratio
    const bx   = (W - boxW) / 2
    const by   = (H - boxH) / 2
    const r    = 14  // corner radius

    // Cut out the document area (show through to camera)
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(bx + r, by)
    ctx.lineTo(bx + boxW - r, by)
    ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r)
    ctx.lineTo(bx + boxW, by + boxH - r)
    ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH)
    ctx.lineTo(bx + r, by + boxH)
    ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r)
    ctx.lineTo(bx, by + r)
    ctx.quadraticCurveTo(bx, by, bx + r, by)
    ctx.closePath()
    ctx.clip()
    ctx.clearRect(0, 0, W, H)
    ctx.restore()

    // Border color based on quality
    const borderColor = status === 'ok' ? '#00e5ff'
                      : status === 'blur' ? '#ffd700'
                      : status === 'glare' ? '#ff4444'
                      : '#666'
    ctx.strokeStyle = borderColor
    ctx.lineWidth   = 3
    ctx.shadowColor = borderColor
    ctx.shadowBlur  = 8
    ctx.beginPath()
    ctx.moveTo(bx + r, by)
    ctx.lineTo(bx + boxW - r, by)
    ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r)
    ctx.lineTo(bx + boxW, by + boxH - r)
    ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH)
    ctx.lineTo(bx + r, by + boxH)
    ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r)
    ctx.lineTo(bx, by + r)
    ctx.quadraticCurveTo(bx, by, bx + r, by)
    ctx.closePath()
    ctx.stroke()
  }, [documentType])

  // ── Frame analysis loop ─────────────────────────────────────────────────────

  const analyzeFrame = useCallback(() => {
    const video   = videoRef.current
    const canvas  = canvasRef.current
    const overlay = overlayRef.current
    if (!video || !canvas || !overlay || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(analyzeFrame)
      return
    }

    const W = video.videoWidth  || 640
    const H = video.videoHeight || 480
    canvas.width  = W
    canvas.height = H
    overlay.width  = W
    overlay.height = H

    const ctx = canvas.getContext('2d')
    if (!ctx) { rafRef.current = requestAnimationFrame(analyzeFrame); return }

    // Draw video frame to hidden canvas for analysis
    ctx.drawImage(video, 0, 0, W, H)

    // Analyse quality at 10fps (skip frames for perf)
    const blur  = computeBlurScore(ctx, W, H)
    const glare = glareScore(ctx, W, H)

    let status: QualityStatus = 'ok'
    if (blur < 80)    status = 'blur'
    if (glare > 0.06) status = 'glare'

    setQuality(status)
    drawOverlay(overlay, status)

    rafRef.current = requestAnimationFrame(analyzeFrame)
  }, [drawOverlay])

  // ── Camera init ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        })
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          rafRef.current = requestAnimationFrame(analyzeFrame)
        }
      } catch {
        if (mounted) setCameraError(true)
      }
    }
    startCamera()
    return () => {
      mounted = false
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [analyzeFrame])

  // ── Capture ─────────────────────────────────────────────────────────────────

  const handleCapture = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setPreview(dataUrl)
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    onCapture(dataUrl)
  }, [onCapture])

  // ── File input ──────────────────────────────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const dataUrl = e.target?.result as string
      setPreview(dataUrl)
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      onCapture(dataUrl)
    }
    reader.readAsDataURL(file)
  }, [onCapture])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('image/')) handleFile(file)
  }, [handleFile])

  // ── Quality message ─────────────────────────────────────────────────────────

  const qualityMsg = quality === 'blur'  ? '⚠️ Image blurry — hold the document steady'
                   : quality === 'glare' ? '⚠️ Glare detected — angle the document away from light'
                   : '✓ Good — press Capture when ready'

  const docLabel = documentType === 'passport'       ? 'Passport'
                 : documentType === 'dni'            ? 'National ID (DNI)'
                 : 'Driving Licence'

  if (preview) {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ position: 'relative', display: 'inline-block', borderRadius: 12, overflow: 'hidden', border: '2px solid var(--color-primary)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Captured document" style={{ maxWidth: '100%', maxHeight: 340, display: 'block' }} />
        </div>
        <p style={{ color: 'var(--color-primary)', marginTop: '0.75rem', fontWeight: 600 }}>✓ Document captured</p>
      </div>
    )
  }

  if (cameraError) {
    return (
      <div
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
        style={{
          border: '2px dashed var(--color-border)',
          borderRadius: 12,
          padding: '3rem 2rem',
          textAlign: 'center',
          cursor: 'pointer',
          background: 'rgba(255,255,255,0.02)',
        }}
        onClick={() => fileRef.current?.click()}
      >
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📎</div>
        <p style={{ color: 'var(--color-text-muted)' }}>Camera unavailable</p>
        <p style={{ color: 'var(--color-text-dim)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
          Drop a {docLabel} photo here or click to browse
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
      {/* Live video */}
      <video
        ref={videoRef}
        muted
        playsInline
        style={{ display: 'block', width: '100%', maxHeight: 380, objectFit: 'cover' }}
      />

      {/* Quality analysis canvas (hidden) */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Overlay canvas (document shape + border) */}
      <canvas
        ref={overlayRef}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
        }}
      />

      {/* Quality message */}
      <div style={{
        position: 'absolute', bottom: 70, left: 0, right: 0,
        textAlign: 'center',
      }}>
        <span style={{
          background: 'rgba(0,0,0,0.7)',
          color: quality === 'ok' ? 'var(--color-primary)' : '#ffd700',
          fontSize: '0.82rem',
          padding: '0.35rem 1rem',
          borderRadius: 20,
          backdropFilter: 'blur(4px)',
        }}>
          {qualityMsg}
        </span>
      </div>

      {/* Capture button */}
      <div style={{
        position: 'absolute', bottom: 16, left: 0, right: 0,
        display: 'flex', justifyContent: 'center', gap: '1rem',
      }}>
        <button
          className="btn btn-primary"
          onClick={handleCapture}
          style={{ minWidth: 140 }}
        >
          📷 Capture
        </button>
        <button
          className="btn btn-outline"
          onClick={() => fileRef.current?.click()}
          style={{ fontSize: '0.8rem', padding: '0.5rem 1rem' }}
        >
          Upload file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
      </div>
    </div>
  )
}
