import type { Alert, Camera, CameraCreate, DashboardStats, Hotspot } from '../types'

const BASE = '/api'

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// ─── Stats ────────────────────────────────────────────────────────────────────
export const getStats = () => req<DashboardStats>('/stats')

// ─── Cameras ──────────────────────────────────────────────────────────────────
export const getCameras = () => req<Camera[]>('/cameras')
export const getCamera = (id: string) => req<Camera>(`/cameras/${id}`)
export const createCamera = (data: CameraCreate) =>
  req<Camera>('/cameras', { method: 'POST', body: JSON.stringify(data) })
export const updateCamera = (id: string, data: Partial<CameraCreate>) =>
  req<Camera>(`/cameras/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteCamera = (id: string) =>
  req<void>(`/cameras/${id}`, { method: 'DELETE' })

// ─── Alerts ───────────────────────────────────────────────────────────────────
export const getAlerts = (params?: { severity?: string; status?: string; limit?: number }) => {
  const qs = new URLSearchParams()
  if (params?.severity) qs.set('severity', params.severity)
  if (params?.status) qs.set('status', params.status)
  if (params?.limit) qs.set('limit', String(params.limit))
  return req<Alert[]>(`/alerts${qs.toString() ? '?' + qs : ''}`)
}
export const acknowledgeAlert = (id: string) =>
  req<Alert>(`/alerts/${id}/acknowledge`, { method: 'PATCH' })
export const resolveAlert = (id: string) =>
  req<Alert>(`/alerts/${id}/resolve`, { method: 'PATCH' })

// ─── Hotspots ─────────────────────────────────────────────────────────────────
export const getHotspots = () => req<Hotspot[]>('/hotspots')
