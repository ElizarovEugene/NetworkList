import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../api'
import { useAuth } from '../auth/useAuth'
import { useI18n } from '../i18n/useI18n'
import { Network } from 'lucide-react'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    setLoading(true)
    setError('')
    try {
      const { access_token } = await login(username, password)
      await signIn(access_token)
      navigate('/')
    } catch {
      setError(t('login.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl shadow-sm w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 bg-blue-600 rounded-md flex items-center justify-center">
            <Network size={18} className="text-white" />
          </div>
          <span className="font-semibold text-gray-900 text-lg">NetworkList</span>
        </div>

        <label className="flex flex-col gap-1 mb-4">
          <span className="text-gray-500 text-xs">{t('login.username')}</span>
          <input
            autoFocus autoComplete="username" value={username}
            onChange={e => setUsername(e.target.value)}
            className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-blue-500"
          />
        </label>

        <label className="flex flex-col gap-1 mb-4">
          <span className="text-gray-500 text-xs">{t('login.password')}</span>
          <input
            type="password" autoComplete="current-password" value={password}
            onChange={e => setPassword(e.target.value)}
            className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-blue-500"
          />
        </label>

        {error && <p className="text-red-500 text-xs mb-4">{error}</p>}

        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
          {loading ? t('login.signing_in') : t('login.submit')}
        </button>
      </form>
    </div>
  )
}
