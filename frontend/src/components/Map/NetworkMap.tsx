import { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { Topology, TopoNode, TopoEdge } from '../../types'
import { DEVICE_COLORS, VIRT_COLORS, INTERNET_COLOR } from '../../lib/deviceColors'

interface Props {
  topology: Topology
  editMode: boolean
  internetLabel: string
  formatVmBadge: (n: number) => string
  onNodeClick?: (node: TopoNode) => void
  onCreateLink?: (sourceId: number, targetId: number) => void
  onDeleteLink?: (linkId: number) => void
  onMoveNode?: (hostId: number, x: number, y: number) => void
  onShowVirtChildren?: (hostId: number) => void
}

function svgUri(svgContent: string): string {
  return `url('data:image/svg+xml,${encodeURIComponent(svgContent)}')`
}

// Same outlines as the lucide-react icons used in the legend and the Hosts
// page (Router/Server/Monitor/Printer/Layers/Box/Globe/CircleQuestionMark) —
// Cytoscape can't render React components, so these are redrawn as raw SVG.
// No background shape behind them — the colored icon glyph IS the node.
const ICON_PATHS: Record<string, string> = {
  network: `<rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6.01 18H6"/><path d="M10.01 18H10"/><path d="M15 10v4"/><path d="M17.84 7.17a4 4 0 0 0-5.66 0"/><path d="M20.66 4.34a8 8 0 0 0-11.31 0"/>`,
  server: `<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>`,
  workstation: `<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>`,
  printer: `<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>`,
  unknown: `<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>`,
  vm: `<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>`,
  container: `<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>`,
  internet: `<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>`,
}

const iconCache = new Map<string, string>()
function coloredIcon(kind: string, color: string): string {
  const key = `${kind}:${color}`
  let uri = iconCache.get(key)
  if (!uri) {
    const body = ICON_PATHS[kind] ?? ICON_PATHS.unknown
    uri = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)
    iconCache.set(key, uri)
  }
  return uri
}

const COLUMN_WIDTH = 260
const ROW_SPACING = 76
const INTERNET_ID = '__internet__'

type LayoutNode = Pick<TopoNode, 'id' | 'depth' | 'parent_host_id' | 'tier' | 'map_x' | 'map_y'>

// Column position is each node's BFS distance ("depth", computed on the
// backend) from the router — not a fixed type-based tier. A VM's containers
// always land one column to its right whether the VM itself is in the
// physical or virtual tier, and a host wired through a switch sits one
// column past the switch. No fixed limit on how many columns exist.
function computeLayout(nodes: LayoutNode[], edges: TopoEdge[]) {
  const positions: Record<string, { x: number; y: number }> = {}
  const nodeDepth = new Map(nodes.map(n => [n.id, n.depth ?? 1]))

  // Generalized "graph parent": any edge (manual link, virt link, or
  // inferred gateway link) to a node exactly one column shallower — not
  // just parent_host_id, which only covers virtualization. Without this, a
  // switch's manually-linked hosts get stacked in arrival order with no
  // relation to the switch's y, and the connecting lines to the ones near
  // it visually vanish under other edges/nodes.
  const bestParent = new Map<string, string>()
  for (const e of edges) {
    const sd = nodeDepth.get(e.source)
    const td = nodeDepth.get(e.target)
    if (sd == null || td == null) continue
    if (td === sd + 1 && !bestParent.has(e.target)) bestParent.set(e.target, e.source)
    else if (sd === td + 1 && !bestParent.has(e.source)) bestParent.set(e.source, e.target)
  }
  for (const n of nodes) {
    if (!bestParent.has(n.id) && n.parent_host_id) bestParent.set(n.id, n.parent_host_id)
  }

  const byDepth = new Map<number, LayoutNode[]>()
  for (const n of nodes) {
    const d = n.depth ?? 1
    const list = byDepth.get(d) ?? []
    list.push(n)
    byDepth.set(d, list)
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b)

  for (const d of depths) {
    const list = byDepth.get(d)!
    const x = (d + 1) * COLUMN_WIDTH // +1 reserves column 0 for Internet

    // Cluster nodes near the y of their graph parent (if it's already
    // placed, in an earlier/shallower column) instead of just listing
    // everything in one long disconnected strip.
    const groups = new Map<string, LayoutNode[]>()
    const ungrouped: LayoutNode[] = []
    for (const n of list) {
      const parentId = bestParent.get(n.id)
      if (parentId && positions[parentId]) {
        const g = groups.get(parentId) ?? []
        g.push(n)
        groups.set(parentId, g)
      } else {
        ungrouped.push(n)
      }
    }

    let cursorY = 0
    for (const [parentId, children] of groups) {
      const parentY = positions[parentId].y
      // Smaller virtual-tier icons can pack tighter; physical nodes are
      // bigger and overlap at the same spacing — give them the full row.
      const spacing = children.every(c => c.tier === 'virtual') ? ROW_SPACING * 0.55 : ROW_SPACING
      children.forEach((n, i) => {
        positions[n.id] = (n.map_x != null && n.map_y != null)
          ? { x: n.map_x, y: n.map_y }
          : { x, y: parentY + (i - (children.length - 1) / 2) * spacing }
      })
      cursorY = Math.max(cursorY, parentY + (children.length / 2) * spacing)
    }
    ungrouped.forEach(n => {
      positions[n.id] = (n.map_x != null && n.map_y != null)
        ? { x: n.map_x, y: n.map_y }
        : { x, y: cursorY += ROW_SPACING }
    })
  }

  // Internet sits fixed at the far left, vertically centered on the routers (depth 0).
  const routerYs = (byDepth.get(0) ?? []).map(n => positions[n.id]?.y ?? 0)
  const internetY = routerYs.length ? (Math.min(...routerYs) + Math.max(...routerYs)) / 2 : 0
  positions[INTERNET_ID] = { x: 0, y: internetY }

  return positions
}

export default function NetworkMap({ topology, editMode, internetLabel, formatVmBadge, onNodeClick, onCreateLink, onDeleteLink, onMoveNode, onShowVirtChildren }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const linkSourceRef = useRef<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Hosts with many VMs/containers (vCenter clusters especially) make the
    // map unreadably tall if drawn inline — always collapse a host's
    // virtual children behind a single badge; clicking it opens a side
    // panel (see MapPage) instead of expanding more nodes onto the canvas.
    const virtChildrenByParent = new Map<string, TopoNode[]>()
    for (const n of topology.nodes) {
      if (n.tier === 'virtual' && n.parent_host_id) {
        const list = virtChildrenByParent.get(n.parent_host_id) ?? []
        list.push(n)
        virtChildrenByParent.set(n.parent_host_id, list)
      }
    }
    const parentsWithChildren = [...virtChildrenByParent.keys()]
    const hiddenChildIds = new Set<string>()
    for (const pid of parentsWithChildren) {
      for (const c of virtChildrenByParent.get(pid)!) hiddenChildIds.add(c.id)
    }

    const visibleNodes = topology.nodes.filter(n => !hiddenChildIds.has(n.id))
    // A parent can itself be hidden (nested virtualization, e.g. vCenter VM ->
    // docker VM -> containers) — skip its badge too, it would otherwise
    // dangle off a node that doesn't exist on the map.
    const visibleParentsWithChildren = parentsWithChildren.filter(pid => !hiddenChildIds.has(pid))
    const toggleNodes = visibleParentsWithChildren.map(pid => {
      const children = virtChildrenByParent.get(pid)!
      return {
        id: `vtoggle-${pid}`,
        depth: children[0].depth,
        parent_host_id: pid,
        tier: 'virtual' as const,
        label: formatVmBadge(children.length),
      }
    })
    const layoutNodes: LayoutNode[] = [...toggleNodes, ...visibleNodes]

    const visibleEdges = topology.edges.filter(e => !hiddenChildIds.has(e.source) && !hiddenChildIds.has(e.target))
    const toggleEdges: TopoEdge[] = visibleParentsWithChildren.map(pid => ({
      id: `vtoggle-edge-${pid}`, source: pid, target: `vtoggle-${pid}`, type: 'virt',
    }))
    const layoutEdges = [...visibleEdges, ...toggleEdges]

    const positions = computeLayout(layoutNodes, layoutEdges)
    const routers = topology.nodes.filter(n => n.tier === 'router')

    const elements: cytoscape.ElementDefinition[] = [
      {
        data: { id: INTERNET_ID, label: internetLabel, icon: coloredIcon('internet', INTERNET_COLOR), draggable: false },
        position: positions[INTERNET_ID],
        group: 'nodes',
      },
      ...visibleNodes.map(n => {
        const isVirtual = n.tier === 'virtual'
        const kind = isVirtual ? (n.virt_type || 'vm') : (n.type || 'unknown')
        const color = isVirtual ? (VIRT_COLORS[n.virt_type || ''] || VIRT_COLORS.vm) : (DEVICE_COLORS[n.type] || DEVICE_COLORS.unknown)
        return {
          data: {
            id: n.id,
            label: n.label.length > 20 ? n.label.slice(0, 18) + '…' : n.label,
            ip: n.ip,
            type: n.type,
            tier: n.tier,
            // Cytoscape's `[is_up = false]` selector matches truthy values
            // too (boolean-literal equality is unreliable in its selector
            // grammar) — encode status as a plain string instead.
            status: n.is_up === false ? 'down' : n.is_up === true ? 'up' : 'unknown',
            icon: coloredIcon(kind, color),
            draggable: n.tier !== 'virtual',
            _raw: n,
          },
          position: positions[n.id],
          group: 'nodes' as const,
        }
      }),
      ...toggleNodes.map(t => ({
        data: {
          id: t.id,
          label: t.label,
          type: 'toggle',
          tier: 'virtual',
          draggable: false,
          _toggleFor: t.parent_host_id,
        },
        position: positions[t.id],
        group: 'nodes' as const,
      })),
      ...routers.map(r => ({
        data: { id: `internet-${r.id}`, source: INTERNET_ID, target: r.id, type: 'internet' },
        group: 'edges' as const,
      })),
      ...layoutEdges.map(e => ({
        data: { id: e.id, source: e.source, target: e.target, type: e.type },
        group: 'edges' as const,
      })),
    ]

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          // No background shape at all — the colored icon glyph is the
          // entire visual. Type is conveyed by the icon + color only.
          selector: 'node',
          style: {
            'background-opacity': 0,
            'background-image': 'data(icon)',
            'background-fit': 'contain',
            'background-clip': 'none',
            'background-width': '100%',
            'background-height': '100%',
            'border-width': 0,
            'label': 'data(label)',
            'color': '#1e293b',
            'font-size': '10px',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            'text-outline-color': '#ffffff',
            'text-outline-width': 2,
            'width': 48,
            'height': 48,
          },
        },
        {
          selector: `node[id = "${INTERNET_ID}"]`,
          style: { 'width': 58, 'height': 58 },
        },
        {
          selector: 'node[type = "network"]',
          style: { 'width': 58, 'height': 58 },
        },
        {
          selector: 'node[tier = "virtual"]',
          style: { 'width': 36, 'height': 36, 'font-size': '9px' },
        },
        {
          selector: 'node[type = "toggle"]',
          style: {
            'shape': 'round-rectangle',
            'background-opacity': 1,
            'background-image': 'none',
            'background-color': '#f5f3ff',
            'border-width': 1.5,
            'border-color': '#a78bfa',
            'width': 58,
            'height': 22,
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-margin-y': 0,
            'font-size': '9px',
            'font-weight': 600,
            'color': '#7c3aed',
            'text-outline-width': 0,
          },
        },
        {
          selector: 'node[status = "down"]',
          style: { 'opacity': 0.45 },
        },
        {
          selector: 'node:selected',
          style: { 'border-width': 3.5, 'border-color': '#3b82f6' },
        },
        {
          selector: 'node.link-source',
          style: { 'border-width': 4, 'border-color': '#f59e0b', 'border-style': 'dashed' },
        },
        {
          // All edge types (manual/inferred/virt/internet/lldp/cdp) render
          // identically — the type still rides along in `data(type)` for
          // edit-mode logic (e.g. only "manual" edges are deletable), it
          // just isn't expressed visually anymore.
          selector: 'edge',
          style: {
            'line-color': '#cbd5e1',
            'width': 1.5,
            'curve-style': 'bezier',
            'target-arrow-shape': 'none',
          },
        },
      ],
      layout: { name: 'preset' },
      autoungrabify: false,
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 2.5,
    })

    cy.nodes().forEach(n => {
      if (n.data('draggable') === false) n.lock()
    })
    cy.fit(undefined, 50)

    cy.on('tap', 'node', (evt) => {
      const node = evt.target
      if (node.id() === INTERNET_ID) return

      if (node.data('type') === 'toggle') {
        onShowVirtChildren?.(Number(node.data('_toggleFor')))
        return
      }

      if (editMode && onCreateLink) {
        const prev = linkSourceRef.current
        if (!prev) {
          linkSourceRef.current = node.id()
          node.addClass('link-source')
        } else if (prev === node.id()) {
          node.removeClass('link-source')
          linkSourceRef.current = null
        } else {
          cy.getElementById(prev).removeClass('link-source')
          linkSourceRef.current = null
          onCreateLink(Number(prev), Number(node.id()))
        }
        return
      }
      onNodeClick?.(node.data('_raw') as TopoNode)
    })

    cy.on('cxttap', 'edge', (evt) => {
      if (!editMode || !onDeleteLink) return
      const edge = evt.target
      if (edge.data('type') !== 'manual') return
      onDeleteLink(Number(edge.id().replace('link-', '')))
    })

    cy.on('dragfree', 'node', (evt) => {
      const node = evt.target
      if (node.id() === INTERNET_ID || node.data('draggable') === false) return
      const pos = node.position()
      onMoveNode?.(Number(node.id()), pos.x, pos.y)
    })

    return () => cy.destroy()
    // The on* callbacks are deliberately excluded: MapPage passes them as
    // fresh inline closures every render, but they only ever close over
    // stable setters/mutate functions — including them would tear down and
    // rebuild the whole cytoscape graph (with its drag positions and pan/
    // zoom state) on every unrelated parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topology, editMode, internetLabel, formatVmBadge])

  return (
    <div ref={containerRef} className="w-full h-full bg-white" />
  )
}
