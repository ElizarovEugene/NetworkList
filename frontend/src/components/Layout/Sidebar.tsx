import { NavLink, useNavigate } from 'react-router-dom'
import { Network, Monitor, Map, Search, Wifi, Users, LogOut } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'
import { useAuth } from '../../auth/useAuth'
import type { TranslationKey } from '../../i18n/translations'

const navItems: { to: string; icon: React.ElementType; key: TranslationKey }[] = [
  { to: '/', icon: Monitor, key: 'nav.dashboard' },
  { to: '/networks', icon: Network, key: 'nav.networks' },
  { to: '/hosts', icon: Wifi, key: 'nav.hosts' },
  { to: '/map', icon: Map, key: 'nav.map' },
  { to: '/scan', icon: Search, key: 'nav.scan' },
  { to: '/users', icon: Users, key: 'nav.users' },
]

export default function Sidebar() {
  const { t } = useI18n()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => { signOut(); navigate('/login') }

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
      <div className="px-4 py-5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center">
            <Network size={16} className="text-white" />
          </div>
          <span className="font-semibold text-gray-900 text-base">NetworkList</span>
        </div>
        <p className="text-gray-400 text-xs mt-1">{t('app.tagline')}</p>
      </div>

      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map(({ to, icon: Icon, key }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`
            }
          >
            <Icon size={16} />
            {t(key)}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <span className="text-gray-700 text-sm font-medium truncate">{user?.username}</span>
          <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 transition-colors shrink-0" title={t('nav.logout')}>
            <LogOut size={15} />
          </button>
        </div>
        <p className="text-gray-400 text-xs mt-1">NetworkList v0.1</p>
      </div>
    </aside>
  )
}
