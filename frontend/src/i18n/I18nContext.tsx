import { type ReactNode } from 'react'
import { translations, type Lang, type TranslationKey } from './translations'
import { useAuth } from '../auth/useAuth'
import { I18nContext } from './context'

const STORAGE_KEY = 'lang'

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  // Language is a per-user setting (managed on the Users page), with a
  // localStorage fallback for the login screen itself (pre-auth). English
  // is the default everywhere — Russian only applies when a user's profile
  // (or the remembered pre-auth choice) explicitly says so.
  const stored = localStorage.getItem(STORAGE_KEY)
  const lang: Lang = (user?.language === 'ru' || (!user && stored === 'ru')) ? 'ru' : 'en'

  const t = (key: TranslationKey, vars?: Record<string, string | number>): string => {
    let str = translations[lang][key] ?? translations.en[key] ?? key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{${k}}`, String(v))
      }
    }
    return str
  }

  return <I18nContext.Provider value={{ t, lang }}>{children}</I18nContext.Provider>
}
