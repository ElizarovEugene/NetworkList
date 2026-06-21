import { useState, useEffect, type ReactNode } from 'react'
import type { User } from '../types'
import { getMe } from '../api'
import { AuthContext } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  // No token means there's nothing to wait on — start "not loading" instead
  // of flipping to false a tick later from inside the effect below.
  const [loading, setLoading] = useState(() => !!localStorage.getItem('token'))

  useEffect(() => {
    if (!token) return
    getMe()
      .then(setUser)
      .catch(() => { localStorage.removeItem('token'); setToken(null) })
      .finally(() => setLoading(false))
  }, [token])

  const signIn = async (newToken: string) => {
    localStorage.setItem('token', newToken)
    setToken(newToken)
    const me = await getMe()
    setUser(me)
  }

  const signOut = () => {
    localStorage.removeItem('token')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, signIn, signOut, loading }}>
      {children}
    </AuthContext.Provider>
  )
}
