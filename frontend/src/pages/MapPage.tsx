import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTopology, getNetworks, createLink, deleteLink, updateHost } from '../api'
import NetworkMap from '../components/Map/NetworkMap'
import type { TopoNode } from '../types'
import { X, Wifi, Router, Server, Monitor, Printer, HelpCircle, Layers, Box, Globe, Pencil, ChevronRight, ChevronDown } from 'lucide-react'
import { DEVICE_COLORS, VIRT_COLORS, INTERNET_COLOR } from '../lib/deviceColors'
import { useI18n } from '../i18n/useI18n'
import type { TranslationKey } from '../i18n/translations'

const LEGEND: { icon: React.ElementType; color: string; key: TranslationKey }[] = [
  { icon: Globe,      color: INTERNET_COLOR,             key: 'device.internet' },
  { icon: Router,     color: DEVICE_COLORS.network,      key: 'device.network' },
  { icon: Server,     color: DEVICE_COLORS.server,       key: 'device.server' },
  { icon: Monitor,    color: DEVICE_COLORS.workstation,   key: 'device.workstation' },
  { icon: Printer,    color: DEVICE_COLORS.printer,       key: 'device.printer' },
  { icon: HelpCircle, color: DEVICE_COLORS.unknown,       key: 'device.unknown' },
  { icon: Layers,     color: VIRT_COLORS.vm,              key: 'device.vm' },
  { icon: Box,        color: VIRT_COLORS.container,       key: 'device.container' },
]

export default function MapPage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { data: networks = [] } = useQuery({ queryKey: ['networks'], queryFn: getNetworks })
  const [networkFilter, setNetworkFilter] = useState<number | undefined>()
  const [selected, setSelected] = useState<TopoNode | null>(null)
  const [virtPanelHostId, setVirtPanelHostId] = useState<number | null>(null)
  const [editMode, setEditMode] = useState(false)

  const { data: topology, isLoading } = useQuery({
    queryKey: ['topology', networkFilter],
    queryFn: () => getTopology({ network_id: networkFilter }),
  })

  const invalidateTopology = () => qc.invalidateQueries({ queryKey: ['topology'] })
  const createLinkMut = useMutation({ mutationFn: createLink, onSuccess: invalidateTopology })
  const deleteLinkMut = useMutation({ mutationFn: deleteLink, onSuccess: invalidateTopology })
  const moveMut = useMutation({
    mutationFn: (v: { id: number; x: number; y: number }) => updateHost(v.id, { map_x: v.x, map_y: v.y }),
    onSuccess: invalidateTopology,
  })
  const hideMut = useMutation({
    mutationFn: (id: number) => updateHost(id, { map_hidden: true }),
    onSuccess: () => { invalidateTopology(); setSelected(null) },
  })

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-4 px-4 py-3">
          <h1 className="text-gray-900 font-semibold text-sm">{t('map.title')}</h1>
          <select
            value={networkFilter ?? ''}
            onChange={e => setNetworkFilter(e.target.value ? Number(e.target.value) : undefined)}
            className="bg-white border border-gray-300 text-gray-700 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
          >
            <option value="">{t('map.all_networks')}</option>
            {networks.map(n => <option key={n.id} value={n.id}>{n.name} ({n.cidr})</option>)}
          </select>
          <button
            onClick={() => setEditMode(m => !m)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              editMode ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'
            }`}
          >
            <Pencil size={12} /> {editMode ? t('map.editing_links') : t('map.edit_links')}
          </button>
          {topology && (
            <span className="text-gray-400 text-xs ml-auto">
              {t('map.nodes_links', { nodes: topology.nodes.length, links: topology.edges.length })}
            </span>
          )}
        </div>

        {/* Legend with device icons — own row so it never gets pushed around by
            the ml-auto count above. No flex-wrap: a wrapped second line always
            restarts flush left, which reads as the icons "jumping" there —
            horizontal scroll keeps it a single, stable row instead. */}
        <div className="flex items-center gap-3 px-4 pb-3 overflow-x-auto">
          {LEGEND.map(({ icon: Icon, color, key }) => (
            <div key={key} className="flex items-center gap-1.5 shrink-0">
              <div className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: color }}>
                <Icon size={11} color="white" strokeWidth={2.5} />
              </div>
              <span className="text-gray-500 text-xs whitespace-nowrap">{t(key)}</span>
            </div>
          ))}
        </div>
      </div>

      {editMode && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-700 text-xs shrink-0">
          {t('map.edit_hint')}
        </div>
      )}

      {/* Map area */}
      <div className="flex-1 relative overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
            <p className="text-gray-400">{t('map.loading')}</p>
          </div>
        )}
        {topology && topology.nodes.length === 0 && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <Wifi size={48} className="mx-auto mb-3 opacity-20" />
              <p>{t('map.empty')}</p>
            </div>
          </div>
        )}
        {topology && (
          <NetworkMap
            topology={topology}
            editMode={editMode}
            internetLabel={t('device.internet')}
            formatVmBadge={n => t(n > 1 ? 'map.vm_badge_many' : 'map.vm_badge_one', { n })}
            onNodeClick={(node) => { setVirtPanelHostId(null); setSelected(node) }}
            onCreateLink={(sourceId, targetId) => createLinkMut.mutate({ source_id: sourceId, target_id: targetId })}
            onDeleteLink={(linkId) => deleteLinkMut.mutate(linkId)}
            onMoveNode={(hostId, x, y) => moveMut.mutate({ id: hostId, x, y })}
            onShowVirtChildren={(hostId) => { setSelected(null); setVirtPanelHostId(hostId) }}
          />
        )}

        {/* Virtual children panel */}
        {topology && virtPanelHostId != null && (
          <VirtChildrenPanel
            hostId={virtPanelHostId}
            nodes={topology.nodes}
            onClose={() => setVirtPanelHostId(null)}
          />
        )}

        {/* Node detail panel */}
        {selected && (
          <div className="absolute top-4 right-4 w-72 bg-white border border-gray-200 rounded-xl shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${selected.is_up === true ? 'bg-emerald-500' : selected.is_up === false ? 'bg-red-400' : 'bg-gray-300'}`} />
                <span className="text-gray-900 font-medium text-sm">{selected.ip || selected.label}</span>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700">
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-3 space-y-2 text-sm">
              <Row label={t('map.detail_name')} value={selected.label} />
              <Row label={t('map.detail_type')} value={t(`device.${selected.virt_type || selected.type}` as TranslationKey)} />
              {selected.os && <Row label={t('map.detail_os')} value={selected.os} />}
              {selected.vendor && <Row label={t('map.detail_vendor')} value={selected.vendor} />}
              {selected.mac && <Row label={t('map.detail_mac')} value={selected.mac} />}
              <Row label={t('map.detail_status')} value={selected.is_up === true ? t('map.status_online') : selected.is_up === false ? t('map.status_offline') : t('map.status_unknown')} />
            </div>
            <div className="px-4 py-3 border-t border-gray-100">
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox" checked={false}
                  onChange={() => hideMut.mutate(Number(selected.id))}
                  className="accent-blue-500"
                />
                {t('hosts.map_hide_host')}
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-700 text-right max-w-[60%] truncate" title={value}>{value}</span>
    </div>
  )
}

function VirtChildrenPanel({ hostId, nodes, onClose }: { hostId: number; nodes: TopoNode[]; onClose: () => void }) {
  const { t } = useI18n()
  const host = nodes.find(n => n.id === String(hostId))
  const directChildren = nodes.filter(n => n.parent_host_id === String(hostId))

  return (
    <div className="absolute top-4 right-4 w-80 max-h-[calc(100%-2rem)] flex flex-col bg-white border border-gray-200 rounded-xl shadow-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
        <div className="min-w-0">
          <p className="text-gray-900 font-medium text-sm truncate">{host?.label ?? t('map.virt_panel_default_title')}</p>
          <p className="text-gray-400 text-xs">{t('map.virt_panel_count', { n: directChildren.length })}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 shrink-0">
          <X size={16} />
        </button>
      </div>
      <div className="overflow-y-auto px-2 py-2">
        <VirtNodeList nodes={nodes} parentId={String(hostId)} />
      </div>
    </div>
  )
}

function VirtNodeList({ nodes, parentId }: { nodes: TopoNode[]; parentId: string }) {
  const children = nodes
    .filter(n => n.parent_host_id === parentId)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }))
  if (children.length === 0) return null
  return (
    <ul className="space-y-0.5">
      {children.map(c => <VirtNodeItem key={c.id} node={c} nodes={nodes} />)}
    </ul>
  )
}

function VirtNodeItem({ node, nodes }: { node: TopoNode; nodes: TopoNode[] }) {
  const [open, setOpen] = useState(false)
  const grandchildren = nodes.filter(n => n.parent_host_id === node.id)
  const Icon = node.virt_type === 'container' ? Box : Layers
  const color = VIRT_COLORS[node.virt_type || ''] || VIRT_COLORS.vm

  return (
    <li>
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 text-sm">
        {grandchildren.length > 0 ? (
          <button onClick={() => setOpen(o => !o)} className="text-gray-400 hover:text-gray-700 shrink-0">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <div className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: color }}>
          <Icon size={11} color="white" strokeWidth={2.5} />
        </div>
        <span className={`truncate ${node.is_up === false ? 'text-gray-400' : 'text-gray-700'}`} title={node.label}>
          {node.label}
        </span>
        {grandchildren.length > 0 && (
          <span className="text-gray-400 text-xs shrink-0">{grandchildren.length}</span>
        )}
        <span className="text-gray-400 text-xs ml-auto shrink-0 truncate max-w-[5rem]" title={node.ip}>{node.ip}</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          node.is_up === true ? 'bg-emerald-500' : node.is_up === false ? 'bg-red-400' : 'bg-gray-300'
        }`} />
      </div>
      {open && grandchildren.length > 0 && (
        <div className="ml-[13px] pl-2 border-l border-gray-100">
          <VirtNodeList nodes={nodes} parentId={node.id} />
        </div>
      )}
    </li>
  )
}
