import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from './i18n/I18nContext'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/useAuth'
import AppLayout from './components/Layout/AppLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Networks from './pages/Networks'
import Hosts from './pages/Hosts'
import MapPage from './pages/MapPage'
import ScanJobs from './pages/ScanJobs'
import Users from './pages/Users'

const qc = new QueryClient({
  defaultOptions: { queries: { refetchInterval: false, staleTime: 10_000 } },
})

function RequireAuth() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

function LoginRoute() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to="/" replace />
  return <Login />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <QueryClientProvider client={qc}>
          <I18nProvider>
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              <Route element={<RequireAuth />}>
                <Route element={<AppLayout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="/networks" element={<Networks />} />
                  <Route path="/hosts" element={<Hosts />} />
                  <Route path="/map" element={<MapPage />} />
                  <Route path="/scan" element={<ScanJobs />} />
                  <Route path="/users" element={<Users />} />
                </Route>
              </Route>
            </Routes>
          </I18nProvider>
        </QueryClientProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
