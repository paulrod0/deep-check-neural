'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import en from './translations/en.json'
import es from './translations/es.json'

export type Language = 'en' | 'es'

const translations: Record<Language, Record<string, unknown>> = { en, es }

const STORAGE_KEY = 'deep-check-lang'

interface LanguageContextValue {
  lang: Language
  setLang: (l: Language) => void
  t: (key: string) => string
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en',
  setLang: () => {},
  t: (key: string) => key,
})

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return path
    }
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : path
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>('en')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'es' || stored === 'en') {
      setLangState(stored)
    }
    setMounted(true)
  }, [])

  const setLang = useCallback((l: Language) => {
    setLangState(l)
    localStorage.setItem(STORAGE_KEY, l)
    document.documentElement.lang = l
  }, [])

  const t = useCallback((key: string): string => {
    return getNestedValue(translations[lang], key)
  }, [lang])

  // Prevent hydration mismatch: render children immediately but with
  // default 'en' until mounted. The effect will update lang from localStorage.
  if (!mounted) {
    return (
      <LanguageContext.Provider value={{ lang: 'en', setLang, t: (key: string) => getNestedValue(translations['en'], key) }}>
        {children}
      </LanguageContext.Provider>
    )
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

export function LanguageToggle() {
  const { lang, setLang } = useLanguage()

  return (
    <button
      onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
      aria-label={lang === 'en' ? 'Cambiar a espanol' : 'Switch to English'}
      style={{
        background: 'none',
        border: '1px solid rgba(255,255,255,0.15)',
        color: '#fff',
        fontSize: '0.78rem',
        padding: '5px 10px',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: 600,
        letterSpacing: '0.03em',
        transition: 'border-color 0.2s, background 0.2s',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      <span style={{ opacity: lang === 'en' ? 1 : 0.45, transition: 'opacity 0.2s' }}>EN</span>
      <span style={{ opacity: 0.3 }}>|</span>
      <span style={{ opacity: lang === 'es' ? 1 : 0.45, transition: 'opacity 0.2s' }}>ES</span>
    </button>
  )
}
