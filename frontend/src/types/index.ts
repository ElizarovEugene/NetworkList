export interface User {
  id: number
  username: string
  is_active: boolean
  language: string
  created_at: string
}

export interface Network {
  id: number
  cidr: string
  name: string
  description?: string
  vlan_id?: number
  site?: string
  gateway?: string
  dns_servers?: string
  created_at: string
  total_hosts: number
  up_hosts: number
  auto_scan_enabled: boolean
  auto_scan_interval_minutes: number
  auto_scan_nmap: boolean
  last_auto_scan_at?: string
}

export interface HostPort {
  port_number: number
  protocol: string
  state: string
  service?: string
  version?: string
}

export interface Host {
  id: number
  ip_address?: string
  network_id?: number
  hostname?: string
  hostname_manual: boolean
  parent_host_id?: number
  virt_type?: string
  virt_id?: string
  virt_ports?: string
  ptr_record?: string
  mac_address?: string
  vendor?: string
  device_type?: string
  os_name?: string
  os_version?: string
  os_accuracy?: number
  os_platform?: string
  snmp_community?: string
  snmp_sysname?: string
  snmp_sysdescr?: string
  snmp_location?: string
  ssh_username?: string
  has_ssh_password: boolean
  is_up?: boolean
  ping_rtt_ms?: number
  is_managed: boolean
  is_gateway: boolean
  notes?: string
  map_x?: number
  map_y?: number
  map_hidden: boolean
  map_hide_virt_children: boolean
  first_seen?: string
  last_seen?: string
  ports: HostPort[]
}

export interface ScanJob {
  id: number
  target: string
  network_id?: number
  scan_types: string
  status: 'pending' | 'running' | 'done' | 'failed'
  progress: number
  total_hosts: number
  found_hosts: number
  new_hosts_count: number
  down_hosts_count: number
  changed_hosts_count: number
  error?: string
  started_at?: string
  finished_at?: string
  created_at: string
}

export interface HostCheck {
  id: number
  check_type: string
  is_success: boolean
  detail?: string
  checked_at: string
}

export interface ScanJobCheck extends HostCheck {
  host_id: number
  host_ip?: string
  host_label?: string
}

export interface ScanJobChange {
  id: number
  host_id: number
  host_ip?: string
  host_label?: string
  change_type: 'new' | 'down' | 'mac_changed'
  detail?: string
  created_at: string
}

export interface TopoNode {
  id: string
  label: string
  ip: string
  type: string
  tier: 'router' | 'physical' | 'virtual'
  depth: number
  virt_type?: string
  parent_host_id?: string
  is_up?: boolean
  os?: string
  vendor?: string
  mac?: string
  network_id?: number
  map_x?: number
  map_y?: number
}

export interface TopoEdge {
  id: string
  source: string
  target: string
  source_iface?: string
  target_iface?: string
  type: string
}

export interface Topology {
  nodes: TopoNode[]
  edges: TopoEdge[]
}
