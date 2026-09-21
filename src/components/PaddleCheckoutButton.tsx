'use client'

import { useEffect, useState } from 'react'
import { initializePaddle, type Paddle } from '@paddle/paddle-js'

interface Props {
  priceId: string
  label?: string
  className?: string
  style?: React.CSSProperties
}

export default function PaddleCheckoutButton({ priceId, label = 'Suscribirse →', className, style }: Props) {
  const [paddle, setPaddle] = useState<Paddle | null>(null)

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
    if (!token) return
    initializePaddle({
      token,
      environment: (process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT as 'sandbox' | 'production') || 'production',
    }).then(p => { if (p) setPaddle(p) })
  }, [])

  const handleClick = () => {
    if (!paddle) {
      // Fallback: no Paddle loaded
      window.location.href = '/auth/login'
      return
    }
    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      settings: {
        displayMode: 'overlay',
        theme: 'dark',
        locale: 'es',
        successUrl: `${window.location.origin}/dashboard?welcome=1`,
      },
    })
  }

  return (
    <button onClick={handleClick} className={className} style={style}>
      {label}
    </button>
  )
}
