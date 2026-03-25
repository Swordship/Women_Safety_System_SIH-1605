import { useEffect, useState, useCallback } from 'react'
import { AlertCircle, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react'
import { getAlerts } from '../lib/api'
import { useWebSocket } from '../hooks/useWebSocket'
import type { Alert, WSMessage } from '../types'
import { cn, formatRelativeTime, severityColor, statusColor } from '../lib/utils'

type AlertTab = 'all' | 'high' | 'medium' | 'settings'

// Local status store — persists ack/resolve within the session without a DB
const localStatus: Record<string, Alert['status']> = {}

const SOS_LABELS: Record<string, string> = {
  hands_up:          'Hands up',
  help_signal:       'Help signal',
  defensive_posture: 'Defensive posture',
  rapid_head:        'Rapid head movement',
}

function alertTypeLabel(a: Alert): string {
  if (a.alert_type === 'sos_gesture') {
    const match = a.description.match(/SOS signal: (\w+)/)
    const sub   = match?.[1] ?? ''
    return SOS_LABELS[sub] ?? 'SOS gesture'
  }
  if (a.alert_type === 'person_surrounded') return 'Surrounded'
  if (a.alert_type === 'proximity_warning')  return 'Proximity'
  return a.alert_type
}

// ── Alert table row ────────────────────────────────────────────────────────────
function AlertRow({ alert, onAck, onResolve }: {
  alert: Alert
  onAck: (id: string) => void
  onResolve: (id: string) => void
}) {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="py-3.5 px-4">
        <p className="text-sm font-semibold text-gray-900">{alert.title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{alertTypeLabel(alert)}</p>
        <p className="text-xs text-gray-400 mt-0.5">{alert.description}</p>
      </td>
      <td className="py-3.5 px-4 text-sm text-gray-600 whitespace-nowrap">{alert.location}</td>
      <td className="py-3.5 px-4 text-xs text-gray-500 whitespace-nowrap">
        {formatRelativeTime(alert.timestamp)}
      </td>
      <td className="py-3.5 px-4">
        <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium capitalize',
          severityColor(alert.severity))}>
          {alert.severity}
        </span>
      </td>
      <td className="py-3.5 px-4">
        <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium capitalize',
          statusColor(alert.status))}>
          {alert.status}
        </span>
      </td>
      <td className="py-3.5 px-4">
        <div className="flex items-center gap-2">
          {alert.status === 'new' && (
            <button
              onClick={() => onAck(alert.id)}
              className="text-xs text-primary-600 hover:text-primary-800 font-medium"
            >
              Acknowledge
            </button>
          )}
          {alert.status !== 'resolved' && (
            <button
              onClick={() => onResolve(alert.id)}
              className="text-xs text-gray-400 hover:text-green-600"
            >
              Resolve
            </button>
          )}
          {alert.status === 'resolved' && (
            <span className="text-xs text-green-500 font-medium">Done</span>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Priority card ──────────────────────────────────────────────────────────────
function PriorityCard({ alert, onAck, onResolve }: {
  alert: Alert
  onAck: (id: string) => void
  onResolve: (id: string) => void
}) {
  const isNew      = alert.status === 'new'
  const isResolved = alert.status === 'resolved'
  const isHigh     = alert.severity === 'high'

  return (
    <div className={cn(
      'border-l-4 rounded-xl p-5 mb-3',
      isResolved ? 'border-l-green-400 bg-green-50'
      : isHigh   ? 'border-l-red-500 bg-red-50'
      :             'border-l-orange-400 bg-orange-50'
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={cn('font-semibold',
              isResolved ? 'text-green-700' : isHigh ? 'text-red-700' : 'text-orange-700')}>
              {alert.title}
            </p>
            <span className="text-xs text-gray-500 bg-white/70 border border-gray-200 px-2 py-0.5 rounded-full">
              {alertTypeLabel(alert)}
            </span>
          </div>
          <p className={cn('text-sm mt-1',
            isResolved ? 'text-green-600' : isHigh ? 'text-red-600' : 'text-orange-600')}>
            {alert.description}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {alert.location} · {formatRelativeTime(alert.timestamp)}
          </p>
        </div>
        <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0',
          statusColor(alert.status))}>
          {alert.status}
        </span>
      </div>

      {!isResolved && (
        <div className="flex gap-2 mt-4">
          {isNew && (
            <button
              onClick={() => onAck(alert.id)}
              className={cn('px-4 py-2 rounded-lg text-sm font-medium text-white',
                isHigh ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-500 hover:bg-orange-600')}
            >
              Acknowledge
            </button>
          )}
          <button
            onClick={() => onResolve(alert.id)}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-100"
          >
            Mark Resolved
          </button>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function Alerts() {
  const [alerts, setAlerts]   = useState<Alert[]>([])
  const [tab, setTab]         = useState<AlertTab>('all')
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(new Date())

  // Apply localStatus on top of incoming data
  function applyLocalStatus(incoming: Alert[]): Alert[] {
    return incoming.map(a => ({
      ...a,
      status: localStatus[a.id] ?? a.status,
    }))
  }

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await getAlerts({ limit: 100 })
      const arr  = Array.isArray(data) ? data : []
      setAlerts(applyLocalStatus(arr))
      setLastUpdated(new Date())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + poll every 5s
  useEffect(() => {
    fetchAlerts()
    const t = setInterval(fetchAlerts, 5000)
    return () => clearInterval(t)
  }, [fetchAlerts])

  // WS: merge new alerts without overwriting local status
  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type === 'new_alert') {
      setAlerts(prev => {
        if (prev.some(a => a.id === msg.alert.id)) return prev
        const merged = [{ ...msg.alert, status: localStatus[msg.alert.id] ?? msg.alert.status }, ...prev]
        return merged.slice(0, 200)
      })
      setLastUpdated(new Date())
    }
    const wsAlerts = (msg as any).alerts as Alert[] | undefined
    if (Array.isArray(wsAlerts) && wsAlerts.length > 0) {
      setAlerts(prev => {
        const existingIds = new Set(prev.map(a => a.id))
        const newOnes = wsAlerts
          .filter(a => !existingIds.has(a.id))
          .map(a => ({ ...a, status: localStatus[a.id] ?? a.status }))
        if (newOnes.length === 0) return prev
        return [...newOnes, ...prev].slice(0, 200)
      })
    }
  }, [])

  useWebSocket(handleWS)

  // Pure local state — no PATCH call needed, works instantly
  function handleAck(id: string) {
    localStatus[id] = 'acknowledged'
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'acknowledged' } : a))
  }

  function handleResolve(id: string) {
    localStatus[id] = 'resolved'
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'resolved' } : a))
  }

  const highAlerts = alerts.filter(a => a.severity === 'high')
  const medAlerts  = alerts.filter(a => a.severity === 'medium')

  const displayedAlerts =
    tab === 'all'    ? alerts :
    tab === 'high'   ? highAlerts :
    tab === 'medium' ? medAlerts : []

  const TABS = [
    { key: 'all',      label: 'All Alerts',      count: alerts.length },
    { key: 'high',     label: 'High Priority',   count: highAlerts.length },
    { key: 'medium',   label: 'Medium Priority', count: medAlerts.length },
    { key: 'settings', label: 'Alert Settings',  count: 0 },
  ] as const

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="px-8 pt-8 pb-4 flex-shrink-0 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Alerts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {alerts.length} total · updated {formatRelativeTime(lastUpdated.toISOString())}
          </p>
        </div>
        <button
          onClick={fetchAlerts}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Tabs with live counts */}
      <div className="px-8 pb-4 flex-shrink-0">
        <div className="flex border-b border-gray-200">
          {TABS.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === key
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {label}
              {count > 0 && (
                <span className={cn(
                  'text-xs px-1.5 py-0.5 rounded-full font-semibold',
                  key === 'high'   ? 'bg-red-100 text-red-700'
                  : key === 'medium' ? 'bg-orange-100 text-orange-700'
                  :                    'bg-gray-100 text-gray-600'
                )}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-8 pb-8 flex-1 overflow-y-auto scrollbar-thin">

        {tab === 'settings' ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 max-w-xl">
            <h3 className="font-semibold text-gray-900 mb-4">Alert Thresholds</h3>
            <div className="space-y-1">
              {[
                { label: 'SOS confidence threshold', value: '65%',        note: 'Minimum to trigger SOS alert' },
                { label: 'Proximity distance',        value: '1.8× height', note: 'Max distance woman ↔ man' },
                { label: 'Surrounded threshold',      value: '2 men',      note: 'Min nearby men for surrounded alert' },
                { label: 'SOS cooldown',              value: '3s / person', note: 'Minimum gap between SOS alerts' },
                { label: 'Surrounded cooldown',       value: '5s / person', note: 'Minimum gap between surrounded alerts' },
                { label: 'Proximity cooldown',        value: '8s / person', note: 'Minimum gap between proximity alerts' },
              ].map(({ label, value, note }) => (
                <div key={label} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{note}</p>
                  </div>
                  <span className="text-sm font-semibold text-primary-600 bg-primary-50 px-3 py-1 rounded-lg ml-4 flex-shrink-0">
                    {value}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-4">
              Edit <code className="bg-gray-100 px-1 rounded">ALERT_COOLDOWN</code> in{' '}
              <code className="bg-gray-100 px-1 rounded">video_processor.py</code> to tune sensitivity.
            </p>
          </div>

        ) : tab === 'all' ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-lg text-gray-900">All Safety Alerts</h2>
                <p className="text-sm text-gray-400 mt-0.5">Real-time detections · auto-refreshes every 5s</p>
              </div>
              {alerts.filter(a => a.status === 'new').length > 0 && (
                <span className="text-xs bg-red-100 text-red-700 px-3 py-1 rounded-full font-semibold">
                  {alerts.filter(a => a.status === 'new').length} unacknowledged
                </span>
              )}
            </div>

            {loading ? (
              <div className="text-sm text-gray-400 py-12 text-center">Loading alerts…</div>
            ) : displayedAlerts.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                  <ShieldCheck size={24} className="text-green-500" />
                </div>
                <p className="text-sm font-medium text-gray-600">No alerts detected</p>
                <p className="text-xs text-gray-400">System is actively monitoring…</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['Alert', 'Location', 'Time', 'Priority', 'Status', 'Action'].map(h => (
                      <th key={h} className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayedAlerts.map((a, i) => (
                    <AlertRow key={a.id || i} alert={a} onAck={handleAck} onResolve={handleResolve} />
                  ))}
                </tbody>
              </table>
            )}
          </div>

        ) : (
          /* High / Medium tabs */
          <div className="max-w-4xl">
            <div className="flex items-center gap-2 mb-2">
              {tab === 'high'
                ? <AlertCircle size={18} className="text-red-500" />
                : <AlertTriangle size={18} className="text-orange-500" />}
              <h2 className={cn('text-lg font-bold',
                tab === 'high' ? 'text-red-600' : 'text-orange-600')}>
                {tab === 'high' ? 'High Priority Alerts' : 'Medium Priority Alerts'}
              </h2>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              {tab === 'high' ? 'Critical — immediate attention required' : 'Requires attention soon'}
            </p>

            {loading ? (
              <div className="text-sm text-gray-400">Loading…</div>
            ) : displayedAlerts.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 bg-white rounded-2xl border border-gray-100">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                  <ShieldCheck size={24} className="text-green-500" />
                </div>
                <p className="text-sm font-medium text-gray-600">No {tab} priority alerts</p>
              </div>
            ) : (
              displayedAlerts.map((a, i) => (
                <PriorityCard key={a.id || i} alert={a} onAck={handleAck} onResolve={handleResolve} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}