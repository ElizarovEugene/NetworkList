import { createContext } from 'react'
import type { Lang, TranslationKey } from './translations'

export interface I18nContextValue {
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
  lang: Lang
}

export const I18nContext = createContext<I18nContextValue>(null!)
