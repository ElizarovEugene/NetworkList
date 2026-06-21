import { useQuery } from '@tanstack/react-query'
import { getNetworks, getHosts, getScanJobs } from '../api'
import { Network, Wifi, CheckCircle, XCircle, Clock } from 'lucide-react'
import type { ScanJob } from '../types'
import { scanStatusBadgeClass } from '../lib/scanStatus'
import { useI18n } from '../i18n/useI18n'
import type { TranslationKey } from '../i18n/translations'

const isActive = (j: ScanJob) => j.status === 'running' || j.status === 'pending'

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`
}

function ScanTiming({ job }: { job: ScanJob }) {
  const { t } = useI18n()
  if (!job.started_at) return null
  const started = new Date(job.started_at)
  const startedLabel = started.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  if (job.finished_at) {
    const duration = formatDuration(new Date(job.finished_at).getTime() - started.getTime())
    return <span>{startedLabel} · {duration}</span>
  }
  if (job.status === 'running' || job.status === 'pending') {
    return <span>{startedLabel} · {t('dashboard.running_word')}</span>
  }
  return <span>{startedLabel}</span>
}

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: number | string; sub?: string
  icon: React.ElementType; color: string
}) {
  return (
    <div className="bg-white rounded-xl p-5 border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-500 text-sm">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={16} className="text-white" />
        </div>
      </div>
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-gray-400 text-xs mt-1">{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const { t } = useI18n()
  const { data: jobs = [] } = useQuery({
    queryKey: ['scan-jobs'],
    queryFn: getScanJobs,
    refetchInterval: query => (query.state.data ?? []).some(isActive) ? 2000 : false,
  })
  const hasActiveScan = jobs.some(isActive)

  const { data: networks = [] } = useQuery({
    queryKey: ['networks'], queryFn: getNetworks,
    refetchInterval: hasActiveScan ? 3000 : false,
  })
  const { data: hosts = [] } = useQuery({
    queryKey: ['hosts'], queryFn: () => getHosts(),
    refetchInterval: hasActiveScan ? 3000 : false,
  })

  // Powered-off VM templates/guests with no IP are vCenter inventory
  // clutter, not real network devices — excluded the same way the Hosts
  // list and the map already hide them.
  const realHosts = hosts.filter(h => !(h.virt_type === 'vm' && h.is_up === false && !h.ip_address))
  const upHosts = realHosts.filter(h => h.is_up === true).length
  const downHosts = realHosts.filter(h => h.is_up === false).length
  const runningJob = jobs.find(j => j.status === 'running')

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">{t('dashboard.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('dashboard.subtitle')}</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard label={t('dashboard.stat_networks')} value={networks.length} icon={Network} color="bg-blue-600" />
        <StatCard label={t('dashboard.stat_total_hosts')} value={realHosts.length}
          sub={t('dashboard.up_down_sub', { up: upHosts, down: downHosts })} icon={Wifi} color="bg-violet-600" />
        <StatCard label={t('dashboard.stat_hosts_up')} value={upHosts} icon={CheckCircle} color="bg-emerald-600" />
        <StatCard label={t('dashboard.stat_hosts_down')} value={downHosts} icon={XCircle} color="bg-red-500" />
      </div>

      {runningJob && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={16} className="text-blue-500 animate-pulse" />
            <span className="text-blue-700 font-medium text-sm">
              {t('dashboard.scan_running', { target: runningJob.target })}
            </span>
          </div>
          <div className="w-full bg-blue-100 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${runningJob.progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-blue-400 text-xs">{runningJob.progress}%</span>
            <span className="text-blue-400 text-xs">{t('dashboard.hosts_found', { n: runningJob.found_hosts })}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Recent networks */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900">{t('dashboard.networks_panel')}</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {networks.length === 0 && (
              <p className="px-5 py-8 text-gray-400 text-sm text-center">{t('dashboard.no_networks')}</p>
            )}
            {networks.map(n => (
              <div key={n.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-gray-900 text-sm font-medium">{n.name}</div>
                  <div className="text-gray-400 text-xs font-mono">{n.cidr}</div>
                </div>
                <div className="text-right">
                  <div className="text-emerald-600 text-sm">{n.up_hosts} {t('common.up')}</div>
                  <div className="text-gray-400 text-xs">{n.total_hosts} {t('common.total')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent scan jobs */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900">{t('dashboard.recent_scans')}</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {jobs.length === 0 && (
              <p className="px-5 py-8 text-gray-400 text-sm text-center">{t('dashboard.no_scans')}</p>
            )}
            {jobs.slice(0, 8).map(j => (
              <div key={j.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="text-gray-900 text-sm font-mono">{j.target}</div>
                  <div className="text-gray-400 text-xs">
                    {j.scan_types}
                    {j.started_at && <span className="mx-1.5">·</span>}
                    <ScanTiming job={j} />
                  </div>
                </div>
                <StatusBadge status={j.status} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n()
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${scanStatusBadgeClass(status)}`}>
      {t(`status.${status}` as TranslationKey)}
    </span>
  )
}
