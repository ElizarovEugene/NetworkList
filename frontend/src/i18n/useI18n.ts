import { useContext } from 'react'
import { I18nContext } from './context'

export const useI18n = () => useContext(I18nContext)

/** Picks the grammatically correct Russian plural form for a count (e.g.
 * контейнер/контейнера/контейнеров) — English only ever needs one/many. */
export function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few
  return many
}
