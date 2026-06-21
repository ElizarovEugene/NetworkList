import { createContext } from 'react'
import type { User } from '../types'

export interface AuthContextValue {
  user: User | null
  signIn: (token: string) => Promise<void>
  signOut: () => void
  loading: boolean
}

export const AuthContext = createContext<AuthContextValue>(null!)
