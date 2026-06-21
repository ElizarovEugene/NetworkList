import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getNetworks, createNetwork, updateNetwork, deleteNetwork } from '../api'
import { Plus, Trash2, Pencil, Network as NetworkIcon, ChevronRight, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Network } from '../types'
import { useI18n } from '../i18n/useI18n'

type IntervalUnit = 'minutes' | 'hours' | 'days'

const UNIT_MINUTES: Record<IntervalUnit, number> = { minutes: 1, hours: 60, days: 1440 }
const UNIT_LABEL_KEY = {
  minutes: 'networks.unit_minutes', hours: 'networks.unit_hours', days: 'networks.unit_days',
} as const satisfies Record<IntervalUnit, 'networks.unit_minutes' | 'networks.unit_hours' | 'networks.unit_days'>

// Picks the largest unit that divides evenly, so e.g. 1440 round-trips as "1 day" not "1440 min".
function minutesToInterval(minutes: number): { value: string; unit: IntervalUnit } {
  if (minutes % 1440 === 0) return { value: String(minutes / 1440), unit: 'days' }
  if (minutes % 60 === 0) return { value: String(minutes / 60), unit: 'hours' }
  return { value: String(minutes), unit: 'minutes' }
}

const EMPTY_FORM = {
  cidr: '', name: '', description: '', gateway: '', vlan_id: '', site: '',
  auto_scan_enabled: false, auto_scan_interval_value: '24', auto_scan_interval_unit: 'hours' as IntervalUnit,
  auto_scan_nmap: true,
}

export default function Networks() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { data: networks = [], isLoading } = useQuery({ queryKey: ['networks'], queryFn: getNetworks })
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM) }

  const createMut = useMutation({
    mutationFn: createNetwork,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['networks'] }); closeForm() },
  })
  const updateMut = useMutation({
    mutationFn: (vars: { id: number; data: Record<string, unknown> }) => updateNetwork(vars.id, vars.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['networks'] }); closeForm() },
  })
  const deleteMut = useMutation({
    mutationFn: deleteNetwork,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['networks'] }),
  })

  const saveMut = editingId ? updateMut : createMut

  const startEdit = (n: Network) => {
    setEditingId(n.id)
    const interval = minutesToInterval(n.auto_scan_interval_minutes)
    setForm({
      cidr: n.cidr, name: n.name, description: n.description ?? '',
      gateway: n.gateway ?? '', vlan_id: n.vlan_id ? String(n.vlan_id) : '', site: n.site ?? '',
      auto_scan_enabled: n.auto_scan_enabled, auto_scan_interval_value: interval.value, auto_scan_interval_unit: interval.unit,
      auto_scan_nmap: n.auto_scan_nmap,
    })
    setShowForm(true)
  }

  const startCreate = () => {
    if (showForm && !editingId) { closeForm(); return }
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const autoScan = {
      auto_scan_enabled: form.auto_scan_enabled,
      auto_scan_interval_minutes: (Number(form.auto_scan_interval_value) || 24) * UNIT_MINUTES[form.auto_scan_interval_unit],
      auto_scan_nmap: form.auto_scan_nmap,
    }
    if (editingId) {
      // Explicit null (not undefined) so clearing the field actually clears
      // it on the backend, which only applies keys present in the request.
      updateMut.mutate({ id: editingId, data: { ...form, ...autoScan, vlan_id: form.vlan_id ? Number(form.vlan_id) : null } })
    } else {
      createMut.mutate({ ...form, ...autoScan, vlan_id: form.vlan_id ? Number(form.vlan_id) : undefined })
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('networks.title')}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('networks.subtitle')}</p>
        </div>
        <button
          onClick={startCreate}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} /> {t('networks.add')}
        </button>
      </div>

      {isLoading && <p className="text-gray-400 text-sm">{t('common.loading')}</p>}

      <div className="space-y-2">
        {networks.map(n => (
          <div key={n.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between hover:border-gray-300 transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center border border-blue-100">
                <NetworkIcon size={16} className="text-blue-600" />
              </div>
              <div>
                <div className="text-gray-900 font-medium">{n.name}</div>
                <div className="text-gray-400 text-xs font-mono mt-0.5">{n.cidr}
                  {n.vlan_id && <span className="ml-2 text-gray-400">{t('networks.vlan_prefix', { n: n.vlan_id })}</span>}
                  {n.site && <span className="ml-2 text-gray-400">· {n.site}</span>}
                </div>
                {n.auto_scan_enabled && (
                  <div className="flex items-center gap-1 mt-1 text-xs text-blue-600">
                    <Clock size={11} />
                    {(() => {
                      const interval = minutesToInterval(n.auto_scan_interval_minutes)
                      return t('networks.auto_scan_badge', { value: interval.value, unit: t(UNIT_LABEL_KEY[interval.unit]) })
                    })()}
                    {n.last_auto_scan_at && ` · ${t('networks.last_auto_scan', { date: new Date(n.last_auto_scan_at).toLocaleString() })}`}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-emerald-600 text-sm font-medium">{n.up_hosts} {t('common.up')}</div>
                <div className="text-gray-400 text-xs">{n.total_hosts} {t('common.hosts')}</div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/hosts?network_id=${n.id}`}
                  className="text-gray-400 hover:text-gray-700 transition-colors"
                  title={t('networks.view_hosts')}
                >
                  <ChevronRight size={18} />
                </Link>
                <button
                  onClick={() => startEdit(n)}
                  className="text-gray-400 hover:text-blue-600 transition-colors"
                  title={t('networks.edit_tooltip')}
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => { if (confirm(t('networks.delete_confirm', { cidr: n.cidr }))) deleteMut.mutate(n.id) }}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                  title={t('networks.delete_tooltip')}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {!isLoading && networks.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <NetworkIcon size={40} className="mx-auto mb-3 opacity-30" />
            <p>{t('networks.empty')}</p>
          </div>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-5 mt-6">
          <h2 className="text-gray-900 font-medium mb-4">{editingId ? t('networks.edit_title') : t('networks.new_title')}</h2>
          <div className="grid grid-cols-3 gap-3">
            {editingId ? (
              <label className="flex flex-col gap-1">
                <span className="text-gray-500 text-xs">{t('networks.field_cidr')}</span>
                <input value={form.cidr} disabled
                  className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-400 text-sm" />
              </label>
            ) : (
              <Field label={t('networks.field_cidr')} value={form.cidr} onChange={v => setForm(f => ({ ...f, cidr: v }))} placeholder="192.168.1.0/24" />
            )}
            <Field label={t('networks.field_name')} value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="LAN" />
            <Field label={t('networks.field_gateway')} value={form.gateway} onChange={v => setForm(f => ({ ...f, gateway: v }))} placeholder="192.168.1.1" />
            <Field label={t('networks.field_vlan')} value={form.vlan_id} onChange={v => setForm(f => ({ ...f, vlan_id: v }))} placeholder="100" />
            <Field label={t('networks.field_site')} value={form.site} onChange={v => setForm(f => ({ ...f, site: v }))} placeholder="Home" />
            <Field label={t('networks.field_description')} value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="..." />
          </div>

          <div className="border-t border-gray-100 mt-4 pt-3">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.auto_scan_enabled}
                onChange={e => setForm(f => ({ ...f, auto_scan_enabled: e.target.checked }))}
                className="accent-blue-500" />
              {t('networks.auto_scan_enable')}
            </label>
            {form.auto_scan_enabled && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                <label className="flex flex-col gap-1">
                  <span className="text-gray-500 text-xs">{t('networks.auto_scan_interval')}</span>
                  <div className="flex gap-2">
                    <input type="text" value={form.auto_scan_interval_value} placeholder="24"
                      onChange={e => setForm(f => ({ ...f, auto_scan_interval_value: e.target.value }))}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-300 focus:outline-none focus:border-blue-500" />
                    <select value={form.auto_scan_interval_unit}
                      onChange={e => setForm(f => ({ ...f, auto_scan_interval_unit: e.target.value as IntervalUnit }))}
                      className="bg-white border border-gray-300 rounded-lg px-2 py-2 text-gray-900 text-sm focus:outline-none focus:border-blue-500">
                      <option value="minutes">{t('networks.unit_minutes')}</option>
                      <option value="hours">{t('networks.unit_hours')}</option>
                      <option value="days">{t('networks.unit_days')}</option>
                    </select>
                  </div>
                </label>
                <label className="flex flex-col gap-1 justify-end pb-2">
                  <span className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={form.auto_scan_nmap}
                      onChange={e => setForm(f => ({ ...f, auto_scan_nmap: e.target.checked }))}
                      className="accent-blue-500" />
                    {t('scan.include_nmap_short')}
                  </span>
                </label>
              </div>
            )}
          </div>

          {saveMut.error && (
            <p className="text-red-500 text-xs mt-2">{String(saveMut.error)}</p>
          )}
          <div className="flex gap-2 mt-4">
            <button type="submit" disabled={saveMut.isPending}
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
              {saveMut.isPending ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" onClick={closeForm}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-4 py-2 rounded-lg transition-colors">
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-gray-500 text-xs">{label}</span>
      <input
        type="text" value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 text-sm placeholder-gray-300 focus:outline-none focus:border-blue-500"
      />
    </label>
  )
}
