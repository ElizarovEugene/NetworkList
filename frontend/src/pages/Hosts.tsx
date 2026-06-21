import { useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { getHosts, getNetworks, deleteHost, updateHost, createHost, getHostChecks } from '../api'
import { Wifi, WifiOff, Search, Trash2, Pencil, X, ChevronDown, ChevronUp, Server, Router, Monitor, Printer, ArrowUpDown, Box, Layers, Cpu, Plus, Download } from 'lucide-react'
import type { Host } from '../types'
import { useI18n, ruPlural } from '../i18n/useI18n'
import { translations, type TranslationKey } from '../i18n/translations'
import { downloadCsv } from '../lib/csv'

// Device type labels stay in English everywhere on this page — the Russian
// translations (e.g. "сетевое оборудование") are too long for the table badge.
const deviceTypeLabel = (key: TranslationKey) => translations.en[key]

const DEVICE_ICONS: Record<string, React.ElementType> = {
  network: Router,
  server: Server,
  workstation: Monitor,
  printer: Printer,
}

const DEVICE_TYPE_OPTIONS = ['network', 'server', 'workstation', 'printer', 'unknown']

const OS_PLATFORM_OPTIONS = [
  'Linux (Docker host)',
  'Windows (Hyper-V host)',
  'VMware ESXi',
  'VMware vCenter',
  'Proxmox VE',
]

type SortField = 'ip' | 'hostname'
type SortDir = 'asc' | 'desc'

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (sortField !== field) return <ArrowUpDown size={12} className="text-gray-300 ml-1" />
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="text-blue-500 ml-1" />
    : <ChevronDown size={12} className="text-blue-500 ml-1" />
}

function ipToNum(ip?: string): number {
  if (!ip) return Number.MAX_SAFE_INTEGER
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0)
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/')
  const bits = bitsStr ? Number(bitsStr) : 32
  const blockSize = 2 ** (32 - bits)
  const baseNum = ipToNum(base)
  const networkStart = Math.floor(baseNum / blockSize) * blockSize
  const ipNum = ipToNum(ip)
  return ipNum >= networkStart && ipNum < networkStart + blockSize
}

const VIRT_BADGE: Record<string, { labelKey: TranslationKey; icon: React.ElementType; cls: string }> = {
  vm: { labelKey: 'device.vm', icon: Layers, cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  container: { labelKey: 'device.container', icon: Box, cls: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  host: { labelKey: 'device.host', icon: Cpu, cls: 'bg-amber-50 text-amber-700 border-amber-200' },
}

function summarizeChildren(children: Host[], lang: 'ru' | 'en'): string {
  const vms = children.filter(c => c.virt_type === 'vm').length
  const containers = children.filter(c => c.virt_type === 'container').length
  const parts = []
  if (vms) parts.push(lang === 'ru' ? `${vms} ВМ` : `${vms} VM${vms > 1 ? 's' : ''}`)
  if (containers) {
    parts.push(lang === 'ru'
      ? `${containers} ${ruPlural(containers, 'контейнер', 'контейнера', 'контейнеров')}`
      : `${containers} container${containers > 1 ? 's' : ''}`)
  }
  return parts.join(' · ')
}

function CheckHistory({ hostId }: { hostId: number }) {
  const { t } = useI18n()
  const { data: checks = [], isLoading } = useQuery({
    queryKey: ['host-checks', hostId],
    queryFn: () => getHostChecks(hostId),
  })

  return (
    <div>
      <p className="text-gray-400 text-xs mb-1">{t('hosts.recent_checks')}</p>
      {isLoading && <p className="text-gray-300 text-xs">{t('common.loading')}</p>}
      {!isLoading && checks.length === 0 && <p className="text-gray-300 text-xs">{t('hosts.none_yet')}</p>}
      <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
        {checks.slice(0, 15).map(c => (
          <div key={c.id} className="flex items-center gap-1.5 text-xs">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.is_success ? 'bg-emerald-500' : 'bg-red-400'}`} />
            <span className="text-gray-600 font-mono shrink-0">{c.check_type}</span>
            <span className="text-gray-400 truncate" title={c.detail || undefined}>{c.detail || '—'}</span>
            <span className="text-gray-300 shrink-0 ml-auto">{new Date(c.checked_at).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HostRow({ host, nested, children: childHosts, guestsExpanded, onToggleGuests, onEdit, onDelete }: {
  host: Host; nested?: boolean; children?: Host[]
  guestsExpanded?: boolean; onToggleGuests?: () => void; onEdit: () => void; onDelete: () => void
}) {
  const { t, lang } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const Icon = DEVICE_ICONS[host.device_type || ''] || Wifi
  const virtBadge = host.virt_type ? VIRT_BADGE[host.virt_type] : undefined
  const hideIp = host.virt_type === 'container'

  return (
    <>
      <tr className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${nested ? 'bg-gray-50/50' : ''}`}>
        <td className={`px-4 py-3 ${nested ? 'pl-9' : ''}`}>
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${host.is_up === true ? 'bg-emerald-500' : host.is_up === false ? 'bg-red-400' : 'bg-gray-300'}`} />
            <Icon size={14} className="text-gray-400 shrink-0" />
            {hideIp
              ? <span className="text-gray-300 text-sm">—</span>
              : <span className="text-gray-900 font-mono text-sm">{host.ip_address || <span className="text-gray-300">—</span>}</span>}
          </div>
        </td>
        <td className="px-4 py-3 text-gray-700 text-sm max-w-[200px]">
          <div className="truncate">
            {host.hostname || host.snmp_sysname || host.ptr_record || <span className="text-gray-300">—</span>}
            {host.hostname_manual && <span title={t('hosts.locked_tooltip')} className="ml-1.5 text-amber-500 text-xs">🔒</span>}
          </div>
          {virtBadge && (
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${virtBadge.cls}`}>
                <virtBadge.icon size={10} /> {t(virtBadge.labelKey)}
              </span>
              {host.virt_ports && (
                <span className="text-xs text-gray-500 font-mono" title={t('hosts.published_ports_tooltip')}>:{host.virt_ports}</span>
              )}
            </div>
          )}
          {!!childHosts?.length && (
            <button onClick={onToggleGuests} className="flex items-center gap-1 mt-0.5 text-xs text-blue-600 hover:text-blue-700">
              {guestsExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {summarizeChildren(childHosts, lang)}
            </button>
          )}
        </td>
        <td className="px-4 py-3 text-gray-500 text-xs">{host.mac_address || '—'}</td>
        <td className="px-4 py-3 text-gray-500 text-xs">{host.vendor || '—'}</td>
        <td className="px-4 py-3">
          {host.device_type && (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-200">
              {deviceTypeLabel(`device.${host.device_type}` as TranslationKey)}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-gray-500 text-xs">
          {host.os_name ? `${host.os_name}${host.os_version ? ` ${host.os_version}` : ''}` : '—'}
          {host.os_platform && <div className="text-gray-400">{host.os_platform}</div>}
        </td>
        <td className="px-4 py-3 text-gray-500 text-xs">
          {host.ping_rtt_ms != null ? `${host.ping_rtt_ms.toFixed(1)} ms` : '—'}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-700 transition-colors">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button onClick={onEdit} className="text-gray-400 hover:text-blue-600 transition-colors" title={t('hosts.edit_tooltip')}>
              <Pencil size={14} />
            </button>
            <button onClick={onDelete} className="text-gray-400 hover:text-red-500 transition-colors">
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-100 bg-gray-50">
          <td colSpan={8} className="px-6 py-4">
            <div className="grid grid-cols-4 gap-6 text-sm">
              <div>
                <p className="text-gray-400 text-xs mb-1">SNMP</p>
                <p className="text-gray-700">{host.snmp_sysname || '—'}</p>
                <p className="text-gray-500 text-xs mt-1">{host.snmp_sysdescr?.slice(0, 100) || ''}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">{t('hosts.open_ports')}</p>
                <div className="flex flex-wrap gap-1">
                  {host.ports.filter(p => p.state === 'open').map(p => (
                    <span key={`${p.port_number}/${p.protocol}`}
                      className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-mono">
                      {p.port_number}/{p.protocol}
                      {p.service && <span className="text-blue-400"> {p.service}</span>}
                    </span>
                  ))}
                  {host.ports.filter(p => p.state === 'open').length === 0 && <span className="text-gray-300 text-xs">{t('hosts.none')}</span>}
                </div>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-1">{t('hosts.details')}</p>
                <p className="text-gray-500 text-xs">{t('hosts.first_seen')}: {host.first_seen ? new Date(host.first_seen).toLocaleString() : '—'}</p>
                <p className="text-gray-500 text-xs">{t('hosts.last_seen')}: {host.last_seen ? new Date(host.last_seen).toLocaleString() : '—'}</p>
                <p className="text-gray-500 text-xs">{t('hosts.ptr')}: {host.ptr_record || '—'}</p>
              </div>
              <CheckHistory hostId={host.id} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function AddHostModal({ networks, onClose }: { networks: { id: number; name: string; cidr: string }[]; onClose: () => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    ip_address: '',
    hostname: '',
    mac_address: '',
    device_type: 'unknown',
    network_id: '',
    notes: '',
  })

  const createMut = useMutation({
    mutationFn: (data: Partial<Host>) => createHost(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hosts'] }); onClose() },
  })

  const handleIpChange = (ip: string) => {
    setForm(f => {
      if (f.network_id) return { ...f, ip_address: ip }
      const match = networks.find(n => ip && ipInCidr(ip, n.cidr))
      return { ...f, ip_address: ip, network_id: match ? String(match.id) : f.network_id }
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMut.mutate({
      ip_address: form.ip_address.trim(),
      hostname: form.hostname.trim() || undefined,
      mac_address: form.mac_address.trim() || undefined,
      device_type: form.device_type,
      network_id: form.network_id ? Number(form.network_id) : undefined,
      notes: form.notes.trim() || undefined,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-gray-900 font-medium">{t('hosts.add_modal_title')}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">{t('hosts.field_ip')}</span>
            <input
              required value={form.ip_address}
              onChange={e => handleIpChange(e.target.value)}
              placeholder="192.168.1.50"
              pattern="^(\d{1,3}\.){3}\d{1,3}$"
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm font-mono placeholder-gray-300 focus:outline-none focus:border-blue-500"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">{t('hosts.field_hostname')}</span>
            <input
              value={form.hostname}
              onChange={e => setForm(f => ({ ...f, hostname: e.target.value }))}
              placeholder={t('common.optional')}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-300 focus:outline-none focus:border-blue-500"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">{t('hosts.field_device_type')}</span>
            <select
              value={form.device_type}
              onChange={e => setForm(f => ({ ...f, device_type: e.target.value }))}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-700 text-sm focus:outline-none focus:border-blue-500"
            >
              {DEVICE_TYPE_OPTIONS.map(dt => <option key={dt} value={dt}>{deviceTypeLabel(`device.${dt}` as TranslationKey)}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">{t('hosts.field_network')}</span>
            <select
              value={form.network_id}
              onChange={e => setForm(f => ({ ...f, network_id: e.target.value }))}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-700 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">{t('common.none_option')}</option>
              {networks.map(n => <option key={n.id} value={n.id}>{n.name} ({n.cidr})</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">{t('hosts.field_mac')}</span>
            <input
              value={form.mac_address}
              onChange={e => setForm(f => ({ ...f, mac_address: e.target.value }))}
              placeholder={t('common.optional')}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm font-mono placeholder-gray-300 focus:outline-none focus:border-blue-500"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">{t('hosts.field_notes')}</span>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-300 focus:outline-none focus:border-blue-500"
            />
          </label>

          {createMut.error && <p className="text-red-500 text-xs">{String((createMut.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || createMut.error)}</p>}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-gray-200">
          <button type="submit" disabled={createMut.isPending}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            {createMut.isPending ? t('hosts.adding') : t('hosts.add')}
          </button>
          <button type="button" onClick={onClose}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-4 py-2 rounded-lg transition-colors">
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </div>
  )
}

function EditHostModal({ host, onClose }: { host: Host; onClose: () => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [form, setForm] = useState({
    hostname: host.hostname || '',
    hostname_manual: host.hostname_manual,
    os_platform: host.os_platform || '',
    snmp_community: host.snmp_community || '',
    ssh_username: host.ssh_username || '',
    ssh_password: '',
    map_hidden: host.map_hidden,
    map_hide_virt_children: host.map_hide_virt_children,
  })
  const [clearPassword, setClearPassword] = useState(false)

  const updateMut = useMutation({
    mutationFn: (data: Partial<Host>) => updateHost(host.id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hosts'] }); onClose() },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Record<string, unknown> = {
      hostname: form.hostname || null,
      hostname_manual: form.hostname_manual,
      os_platform: form.os_platform || null,
      snmp_community: form.snmp_community || null,
      ssh_username: form.ssh_username || null,
      map_hidden: form.map_hidden,
      map_hide_virt_children: form.map_hide_virt_children,
    }
    if (clearPassword) payload.ssh_password = null
    else if (form.ssh_password) payload.ssh_password = form.ssh_password
    updateMut.mutate(payload)
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-gray-900 font-medium">{t('hosts.edit_modal_title', { name: host.ip_address || host.hostname || `#${host.id}` })}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">{t('hosts.field_hostname')}</span>
            <input
              value={form.hostname}
              onChange={e => setForm(f => ({ ...f, hostname: e.target.value, hostname_manual: true }))}
              placeholder={host.snmp_sysname || host.ptr_record || t('hosts.placeholder_auto_detected')}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-300 focus:outline-none focus:border-blue-500"
            />
            <label className="flex items-center gap-2 mt-1 text-xs text-gray-500 cursor-pointer">
              <input
                type="checkbox" checked={form.hostname_manual}
                onChange={e => setForm(f => ({ ...f, hostname_manual: e.target.checked }))}
                className="accent-blue-500"
              />
              {t('hosts.field_lock_label')}
            </label>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">{t('hosts.field_os_platform')}</span>
            <select
              value={form.os_platform}
              onChange={e => setForm(f => ({ ...f, os_platform: e.target.value }))}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-700 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">{t('hosts.not_set_option')}</option>
              {OS_PLATFORM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-gray-500 text-xs">{t('hosts.field_snmp_community')}</span>
            <input
              value={form.snmp_community}
              onChange={e => setForm(f => ({ ...f, snmp_community: e.target.value }))}
              placeholder={t('hosts.placeholder_snmp_default')}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-300 focus:outline-none focus:border-blue-500"
            />
          </label>

          <div className="border-t border-gray-100 pt-3">
            <p className="text-gray-500 text-xs mb-2">{t('hosts.ssh_creds_title')}</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-gray-500 text-xs">{t('hosts.field_username')}</span>
                <input
                  value={form.ssh_username}
                  onChange={e => setForm(f => ({ ...f, ssh_username: e.target.value }))}
                  className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm focus:outline-none focus:border-blue-500"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-gray-500 text-xs">{t('hosts.field_password')}</span>
                <input
                  type="password"
                  value={form.ssh_password}
                  disabled={clearPassword}
                  onChange={e => setForm(f => ({ ...f, ssh_password: e.target.value }))}
                  placeholder={host.has_ssh_password ? t('hosts.password_placeholder_existing') : ''}
                  className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-300 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
              </label>
            </div>
            {host.has_ssh_password && (
              <label className="flex items-center gap-2 mt-2 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox" checked={clearPassword}
                  onChange={e => setClearPassword(e.target.checked)}
                  className="accent-red-500"
                />
                {t('hosts.clear_password')}
              </label>
            )}
          </div>

          <div className="border-t border-gray-100 pt-3 space-y-2">
            <p className="text-gray-500 text-xs mb-1">{t('hosts.map_section_title')}</p>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox" checked={form.map_hidden}
                onChange={e => setForm(f => ({ ...f, map_hidden: e.target.checked }))}
                className="accent-blue-500"
              />
              {t('hosts.map_hide_host')}
            </label>
            {!!form.os_platform && !!form.ssh_username && (form.ssh_password || host.has_ssh_password) && (
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox" checked={form.map_hide_virt_children}
                  onChange={e => setForm(f => ({ ...f, map_hide_virt_children: e.target.checked }))}
                  className="accent-blue-500"
                />
                {t('hosts.map_hide_virt_children')}
              </label>
            )}
          </div>

          {updateMut.error && <p className="text-red-500 text-xs">{String(updateMut.error)}</p>}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-gray-200">
          <button type="submit" disabled={updateMut.isPending}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
            {updateMut.isPending ? t('common.saving') : t('common.save')}
          </button>
          <button type="button" onClick={onClose}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-4 py-2 rounded-lg transition-colors">
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function Hosts() {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterUp, setFilterUp] = useState<string>('')
  const [filterType, setFilterType] = useState<string>('')
  const [sortField, setSortField] = useState<SortField>('ip')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [editingHost, setEditingHost] = useState<Host | null>(null)
  const [showAddHost, setShowAddHost] = useState(false)
  const [expandedGuests, setExpandedGuests] = useState<Set<number>>(new Set())

  const networkId = searchParams.get('network_id') ? Number(searchParams.get('network_id')) : undefined
  const { data: networks = [] } = useQuery({ queryKey: ['networks'], queryFn: getNetworks })
  const { data: hosts = [], isLoading } = useQuery({
    queryKey: ['hosts', networkId, filterUp],
    queryFn: () => getHosts({
      network_id: networkId,
      is_up: filterUp === 'up' ? true : filterUp === 'down' ? false : undefined,
    }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteHost,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hosts'] }),
  })

  const networkName = networks.find(n => n.id === networkId)?.name

  // Only containers nest under their host (they often have no routable IP
  // of their own). VMs and hypervisor hosts (Hyper-V/ESXi/Proxmox/vCenter)
  // are real LAN citizens already discovered independently — show them as
  // regular flat rows with a badge instead of hiding them in a toggle.
  const childrenByParent = new Map<number, Host[]>()
  for (const h of hosts) {
    if (h.parent_host_id && h.virt_type === 'container') {
      const list = childrenByParent.get(h.parent_host_id) ?? []
      list.push(h)
      childrenByParent.set(h.parent_host_id, list)
    }
  }

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const toggleGuests = (hostId: number) => {
    setExpandedGuests(prev => {
      const next = new Set(prev)
      if (next.has(hostId)) next.delete(hostId)
      else next.add(hostId)
      return next
    })
  }

  const filtered = hosts
    .filter(h => !(h.parent_host_id && h.virt_type === 'container'))
    // Powered-off VMs nobody can reach (no IP at all) are just clutter.
    .filter(h => !(h.virt_type === 'vm' && h.is_up === false && !h.ip_address))
    // A VM reporting an address outside every known network (e.g. a stray
    // VPN/internal adapter) isn't one of our LAN devices — don't list it.
    .filter(h => {
      if (h.virt_type !== 'vm' || !h.ip_address || networks.length === 0) return true
      return networks.some(n => ipInCidr(h.ip_address!, n.cidr))
    })
    .filter(h => !filterType || h.device_type === filterType)
    .filter(h => {
      if (!search) return true
      const s = search.toLowerCase()
      return (
        h.ip_address?.includes(s) ||
        h.hostname?.toLowerCase().includes(s) ||
        h.snmp_sysname?.toLowerCase().includes(s) ||
        h.vendor?.toLowerCase().includes(s) ||
        h.mac_address?.toLowerCase().includes(s)
      )
    })
    .sort((a, b) => {
      let cmp: number
      if (sortField === 'ip') cmp = ipToNum(a.ip_address) - ipToNum(b.ip_address)
      else {
        const ha = (a.hostname || a.snmp_sysname || a.ptr_record || '').toLowerCase()
        const hb = (b.hostname || b.snmp_sysname || b.ptr_record || '').toLowerCase()
        cmp = ha.localeCompare(hb)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

  const handleExport = () => {
    const header = [
      t('hosts.col_ip'), t('hosts.col_hostname'), t('hosts.col_mac'), t('hosts.col_vendor'),
      t('hosts.col_type'), t('hosts.col_os'), t('hosts.export_col_status'), t('hosts.field_notes'),
    ]
    const rows = filtered.map(h => [
      h.ip_address ?? '',
      h.hostname ?? h.snmp_sysname ?? h.ptr_record ?? '',
      h.mac_address ?? '',
      h.vendor ?? '',
      h.device_type ? deviceTypeLabel(`device.${h.device_type}` as TranslationKey) : '',
      h.os_name ? `${h.os_name} ${h.os_version ?? ''}`.trim() : '',
      h.is_up === true ? 'up' : h.is_up === false ? 'down' : '',
      h.notes ?? '',
    ])
    downloadCsv('hosts.csv', [header, ...rows])
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {t('hosts.title')} {networkName && <span className="text-gray-400 font-normal text-base">· {networkName}</span>}
          </h1>
          <p className="text-gray-500 text-sm mt-1">{t('hosts.count', { n: hosts.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterUp}
            onChange={e => setFilterUp(e.target.value)}
            className="bg-white border border-gray-300 text-gray-700 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          >
            <option value="">{t('hosts.filter_all')}</option>
            <option value="up">{t('hosts.filter_up')}</option>
            <option value="down">{t('hosts.filter_down')}</option>
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="bg-white border border-gray-300 text-gray-700 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
          >
            <option value="">{t('hosts.filter_all_types')}</option>
            {DEVICE_TYPE_OPTIONS.map(dt => <option key={dt} value={dt}>{deviceTypeLabel(`device.${dt}` as TranslationKey)}</option>)}
          </select>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" placeholder={t('hosts.search_placeholder')} value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-white border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={handleExport}
            title={t('hosts.export')}
            className="flex items-center gap-1.5 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 text-sm px-3 py-2 rounded-lg transition-colors"
          >
            <Download size={14} /> {t('hosts.export')}
          </button>
          <button
            onClick={() => setShowAddHost(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm px-3 py-2 rounded-lg transition-colors"
          >
            <Plus size={14} /> {t('hosts.add')}
          </button>
        </div>
      </div>

      {isLoading && <p className="text-gray-400 text-sm">{t('common.loading')}</p>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <WifiOff size={40} className="mx-auto mb-3 opacity-30" />
          <p>{t('hosts.empty')}</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                  <button onClick={() => toggleSort('ip')} className="flex items-center text-gray-500 hover:text-gray-900 transition-colors">
                    {t('hosts.col_ip')} <SortIcon field="ip" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                  <button onClick={() => toggleSort('hostname')} className="flex items-center text-gray-500 hover:text-gray-900 transition-colors">
                    {t('hosts.col_hostname')} <SortIcon field="hostname" sortField={sortField} sortDir={sortDir} />
                  </button>
                </th>
                {(['hosts.col_mac', 'hosts.col_vendor', 'hosts.col_type', 'hosts.col_os', 'hosts.col_rtt'] as const).map(key => (
                  <th key={key} className="px-4 py-3 text-left text-gray-500 text-xs font-medium uppercase tracking-wider">{t(key)}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(host => {
                const children = childrenByParent.get(host.id)
                const isExpanded = expandedGuests.has(host.id)
                return (
                  <Fragment key={host.id}>
                    <HostRow host={host} children={children}
                      guestsExpanded={isExpanded} onToggleGuests={() => toggleGuests(host.id)}
                      onEdit={() => setEditingHost(host)}
                      onDelete={() => { if (confirm(t('hosts.delete_confirm', { name: host.hostname || host.ip_address || '' }))) deleteMut.mutate(host.id) }}
                    />
                    {isExpanded && children?.map(child => (
                      <HostRow key={child.id} host={child} nested
                        onEdit={() => setEditingHost(child)}
                        onDelete={() => { if (confirm(t('hosts.delete_confirm', { name: child.hostname || child.ip_address || '' }))) deleteMut.mutate(child.id) }}
                      />
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingHost && <EditHostModal host={editingHost} onClose={() => setEditingHost(null)} />}
      {showAddHost && <AddHostModal networks={networks} onClose={() => setShowAddHost(false)} />}
    </div>
  )
}
