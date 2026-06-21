// Single source of truth for device-type colors — shared by the map canvas
// (NetworkMap), the map legend, and the virtual-children panel (MapPage) so
// the same device type always renders in the same color everywhere.
export const DEVICE_COLORS: Record<string, string> = {
  network: '#3b82f6',
  server: '#10b981',
  workstation: '#f59e0b',
  printer: '#ec4899',
  unknown: '#94a3b8',
}

export const VIRT_COLORS: Record<string, string> = {
  vm: '#8b5cf6',
  container: '#06b6d4',
}

export const INTERNET_COLOR = '#0f172a'
