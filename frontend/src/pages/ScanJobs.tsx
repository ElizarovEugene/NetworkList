import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createScanJob, getScanJobs, getNetworks, getScanJob, getScanJobChecks, getScanJobChanges } from '../api'
import { Search, Play, Clock, CheckCircle, XCircle, Loader, ChevronDown, ChevronUp, PlusCircle, ArrowDownCircle, Fingerprint } from 'lucide-react'
import type { ScanJob, ScanJobChange } from '../types'
import { scanStatusBadgeClass } from '../lib/scanStatus'
import { useI18n } from '../i18n/useI18n'
import type { TranslationKey } from '../i18n/translations'

function JobLog({ jobId }: { jobId: number }) {
  const { t } = useI18n()
  const { data: checks = [], isLoading } = useQuery({
    queryKey: ['scan-job-checks', jobId],
    queryFn: () => getScanJobChecks(jobId),
  })

  if (isLoading) return <p className="text-gray-400 text-xs mt-2">{t('common.loading')}</p>
  if (checks.length === 0) return <p className="text-gray-300 text-xs mt-2">{t('scan.no_checks')}</p>

  return (
    <div className="mt-3 border-t border-gray-100 pt-2 max-h-64 overflow-y-auto space-y-1">
      {checks.map(c => (
        <div key={c.id} className="flex items-center gap-2 text-xs">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.is_success ? 'bg-emerald-500' : 'bg-red-400'}`} />
          <span className="text-gray-700 font-mono shrink-0">{c.host_label || c.host_ip}</span>
          <span className="text-gray-500 shrink-0">{c.check_type}</span>
          <span className="text-gray-400 truncate" title={c.detail || undefined}>{c.detail || '—'}</span>
          <span className="text-gray-300 shrink-0 ml-auto">{new Date(c.checked_at).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  )
}

const CHANGE_ICON: Record<ScanJobChange['change_type'], React.ElementType> = {
  new: PlusCircle, down: ArrowDownCircle, mac_changed: Fingerprint,
}
const CHANGE_COLOR: Record<ScanJobChange['change_type'], string> = {
  new: 'text-emerald-600', down: 'text-red-500', mac_changed: 'text-amber-600',
}

function JobChanges({ jobId }: { jobId: number }) {
  const { t } = useI18n()
  const { data: changes = [], isLoading } = useQuery({
    queryKey: ['scan-job-changes', jobId],
    queryFn: () => getScanJobChanges(jobId),
  })

  if (isLoading) return null
  if (changes.length === 0) return null

  return (
    <div className="mt-3 border-t border-gray-100 pt-2 space-y-1">
      {changes.map(c => {
        const Icon = CHANGE_ICON[c.change_type]
        return (
          <div key={c.id} className="flex items-center gap-2 text-xs">
            <Icon size={12} className={`shrink-0 ${CHANGE_COLOR[c.change_type]}`} />
            <span className="text-gray-700 font-mono shrink-0">{c.host_label || c.host_ip}</span>
            <span className="text-gray-500 shrink-0">{t(`scan.change_${c.change_type}` as TranslationKey)}</span>
            {c.detail && <span className="text-gray-400 truncate">{c.detail}</span>}
          </div>
        )
      })}
    </div>
  )
}

function ChangesSummary({ job }: { job: ScanJob }) {
  const { t } = useI18n()
  if (job.status !== 'done') return null
  const parts: { icon: React.ElementType; cls: string; label: string }[] = []
  if (job.new_hosts_count > 0) {
    parts.push({ icon: PlusCircle, cls: 'text-emerald-600', label: t('scan.change_new_n', { n: job.new_hosts_count }) })
  }
  if (job.down_hosts_count > 0) {
    parts.push({ icon: ArrowDownCircle, cls: 'text-red-500', label: t('scan.change_down_n', { n: job.down_hosts_count }) })
  }
  if (job.changed_hosts_count > 0) {
    parts.push({ icon: Fingerprint, cls: 'text-amber-600', label: t('scan.change_mac_changed_n', { n: job.changed_hosts_count }) })
  }
  if (parts.length === 0) return null
  return (
    <div className="flex items-center gap-3 mt-2 text-xs">
      {parts.map((p, i) => (
        <span key={i} className={`flex items-center gap-1 ${p.cls}`}>
          <p.icon size={12} /> {p.label}
        </span>
      ))}
    </div>
  )
}

function JobRow({ job }: { job: ScanJob }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [showLog, setShowLog] = useState(false)

  useEffect(() => {
    if (job.status !== 'running' && job.status !== 'pending') return
    const timer = setInterval(async () => {
      const updated = await getScanJob(job.id)
      qc.setQueryData<ScanJob[]>(['scan-jobs'], (old = []) =>
        old.map(j => j.id === updated.id ? updated : j)
      )
      if (updated.status === 'done' || updated.status === 'failed') {
        clearInterval(timer)
        qc.invalidateQueries({ queryKey: ['hosts'] })
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [job.status, job.id, qc])

  const StatusIcon = { done: CheckCircle, failed: XCircle, running: Loader, pending: Clock }[job.status] || Clock
  const statusColor = {
    done: 'text-emerald-600',
    failed: 'text-red-500',
    running: 'text-blue-500',
    pending: 'text-gray-400',
  }[job.status] || 'text-gray-400'

  const badgeCls = scanStatusBadgeClass(job.status)

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <StatusIcon size={16} className={`${statusColor} ${job.status === 'running' ? 'animate-spin' : ''}`} />
          <span className="text-gray-900 font-mono font-medium">{job.target}</span>
          <span className="text-gray-400 text-xs">{job.scan_types}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded border ${badgeCls}`}>{t(`status.${job.status}` as TranslationKey)}</span>
          <button onClick={() => setShowLog(s => !s)} className="text-gray-400 hover:text-gray-700 transition-colors">
            {showLog ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {(job.status === 'running' || job.status === 'done') && (
        <div className="mt-2">
          <div className="w-full bg-gray-100 rounded-full h-1.5 mb-1">
            <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${job.progress}%` }} />
          </div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>{job.progress}%</span>
            <span>{t('scan.found_of', { found: job.found_hosts, total: job.total_hosts || '?' })}</span>
          </div>
        </div>
      )}

      {job.error && <p className="text-red-500 text-xs mt-2">{job.error}</p>}

      <div className="flex gap-4 mt-2 text-xs text-gray-400">
        {job.started_at && <span>{t('scan.started', { date: new Date(job.started_at).toLocaleString() })}</span>}
        {job.finished_at && <span>{t('scan.done', { date: new Date(job.finished_at).toLocaleString() })}</span>}
      </div>

      <ChangesSummary job={job} />

      {showLog && <JobChanges jobId={job.id} />}
      {showLog && <JobLog jobId={job.id} />}
    </div>
  )
}

export default function ScanJobs() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { data: networks = [] } = useQuery({ queryKey: ['networks'], queryFn: getNetworks })
  const { data: jobs = [], isLoading } = useQuery({ queryKey: ['scan-jobs'], queryFn: getScanJobs })

  const [target, setTarget] = useState('')
  const [networkId, setNetworkId] = useState('')
  const [includeNmap, setIncludeNmap] = useState(true)

  const createMut = useMutation({
    mutationFn: createScanJob,
    onSuccess: (job) => {
      qc.setQueryData<ScanJob[]>(['scan-jobs'], (old = []) => [job, ...old])
      setTarget('')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!target.trim()) return
    const scanTypes = ['ping', 'dns', 'snmp', 'ssh']
    if (includeNmap) scanTypes.push('nmap')
    createMut.mutate({
      target: target.trim(),
      network_id: networkId ? Number(networkId) : undefined,
      scan_types: scanTypes,
    })
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">{t('scan.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('scan.subtitle')}</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-gray-900 font-medium mb-4">{t('scan.new_scan')}</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">{t('scan.field_target')}</span>
            <input
              type="text" value={target} onChange={e => setTarget(e.target.value)}
              placeholder="192.168.1.0/24"
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-300 focus:outline-none focus:border-blue-500"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">{t('scan.field_network')}</span>
            <select value={networkId} onChange={e => {
              const id = e.target.value
              setNetworkId(id)
              const net = networks.find(n => n.id === Number(id))
              if (net) setTarget(net.cidr)
            }}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-700 text-sm focus:outline-none focus:border-blue-500">
              <option value="">{t('common.none_option')}</option>
              {networks.map(n => <option key={n.id} value={n.id}>{n.name} ({n.cidr})</option>)}
            </select>
          </label>
        </div>
        <div className="mb-4">
          <p className="text-gray-500 text-xs mb-2">
            {t('scan.always_run_note')}
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={includeNmap} onChange={e => setIncludeNmap(e.target.checked)}
              className="accent-blue-500" />
            {t('scan.include_nmap')}
          </label>
        </div>
        <button type="submit" disabled={createMut.isPending || !target.trim()}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
          <Play size={14} />
          {createMut.isPending ? t('scan.starting') : t('scan.start')}
        </button>
        {createMut.error && <p className="text-red-500 text-xs mt-2">{String(createMut.error)}</p>}
      </form>

      {isLoading && <p className="text-gray-400 text-sm">{t('common.loading')}</p>}

      <div className="space-y-3">
        {jobs.map(j => <JobRow key={j.id} job={j} />)}
        {!isLoading && jobs.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <Search size={40} className="mx-auto mb-3 opacity-30" />
            <p>{t('scan.no_scans')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
