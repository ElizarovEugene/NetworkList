import api from './client'
import type { Network, Host, ScanJob, Topology, HostCheck, ScanJobCheck, ScanJobChange, User } from '../types'

// Auth
export const login = (username: string, password: string) =>
  api.post<{ access_token: string; token_type: string }>('/auth/login', { username, password }).then(r => r.data)
export const getMe = () => api.get<User>('/auth/me').then(r => r.data)

// Users
export const getUsers = () => api.get<User[]>('/users/').then(r => r.data)
export const createUser = (data: { username: string; password: string; language: string }) =>
  api.post<User>('/users/', data).then(r => r.data)
export const updateUser = (id: number, data: Partial<{ password: string; is_active: boolean; language: string }>) =>
  api.patch<User>(`/users/${id}`, data).then(r => r.data)
export const deleteUser = (id: number) => api.delete(`/users/${id}`)

// Networks
export const getNetworks = () => api.get<Network[]>('/networks/').then(r => r.data)
export const createNetwork = (data: Partial<Network>) => api.post<Network>('/networks/', data).then(r => r.data)
export const updateNetwork = (id: number, data: Partial<Network>) => api.patch<Network>(`/networks/${id}`, data).then(r => r.data)
export const deleteNetwork = (id: number) => api.delete(`/networks/${id}`)

// Hosts
export const getHosts = (params?: Record<string, unknown>) => api.get<Host[]>('/hosts/', { params }).then(r => r.data)
export const createHost = (data: Partial<Host>) => api.post<Host>('/hosts/', data).then(r => r.data)
export const updateHost = (id: number, data: Partial<Host>) => api.patch<Host>(`/hosts/${id}`, data).then(r => r.data)
export const deleteHost = (id: number) => api.delete(`/hosts/${id}`)
export const getHostChecks = (id: number) => api.get<HostCheck[]>(`/hosts/${id}/checks`).then(r => r.data)

// Scan
export const createScanJob = (data: {
  target: string
  network_id?: number
  scan_types: string[]
}) => api.post<ScanJob>('/scan/', data).then(r => r.data)
export const getScanJobs = () => api.get<ScanJob[]>('/scan/').then(r => r.data)
export const getScanJob = (id: number) => api.get<ScanJob>(`/scan/${id}`).then(r => r.data)
export const getScanJobChecks = (id: number) => api.get<ScanJobCheck[]>(`/scan/${id}/checks`).then(r => r.data)
export const getScanJobChanges = (id: number) => api.get<ScanJobChange[]>(`/scan/${id}/changes`).then(r => r.data)

// Topology
export const getTopology = (params?: { network_id?: number }) =>
  api.get<Topology>('/topology/', { params }).then(r => r.data)

// Links
export const createLink = (data: { source_id: number; target_id: number }) =>
  api.post('/links/', data).then(r => r.data)
export const deleteLink = (id: number) => api.delete(`/links/${id}`)
