import { useEffect, useState, useCallback } from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { getAlerts, acknowledgeAlert, resolveAlert } from '../lib/api'
import { useWebSocket } from '../hooks/useWebSocket'
import type { Alert, WSMessage } from '../types'
import { cn, formatRelativeTime, severityColor, statusColor } from '../lib/utils'

type AlertTab = 'all' | 'high' | 'medium' | 'settings'

// ─── All Alerts table row ─────────────────────────────────────────────────────
function AlertRow({ alert, onAcknowledge, onResolve }: {
  alert: Alert
  onAcknowledge: (id: string) => void
  onResolve: (id: string) => void
}) {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="py-4 px-4">
        <p className="text-sm font-semibold text-gray-900">{alert.title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{alert.description}</p>
      </td>
      <td className="py-4 px-4 text-sm text-gray-600 whitespace-nowrap">{alert.location}</td>
      <td className="py-4 px-4 text-sm text-gray-500 whitespace-nowrap">{formatRelativeTime(alert.timestamp)}</td>
      <td className="py-4 px-4">
        <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium capitalize', severityColor(alert.severity))}>
          {alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}
        </span>
      </td>
      <td className="py-4 px-4">
        <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium capitalize', statusColor(alert.status))}>
          {alert.status.charAt(0).toUpperCase() + alert.status.slice(1)}
        </span>
      </td>
      <td className="py-4 px-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onAcknowledge(alert.id)}
            className="text-sm text-primary-600 hover:text-primary-800 font-medium"
          >
            View
          </button>
          {alert.status === 'new' && (
            <button
              onClick={() => onResolve(alert.id)}
              className="text-xs text-gray-400 hover:text-green-600"
            >
              Resolve
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── High Priority card ───────────────────────────────────────────────────────
function HighPriorityCard({ alert, onAcknowledge }: {
  alert: Alert
  onAcknowledge: (id: string) => void
}) {
  const isNew = alert.status === 'new'
  return (
    <div className={cn(
      'border-l-4 rounded-xl p-5 mb-3',
      isNew ? 'border-l-red-500 bg-red-50' : 'border-l-gray-300 bg-gray-50'
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className={cn('font-semibold text-base', isNew ? 'text-red-700' : 'text-gray-700')}>{alert.title}</p>
          <p className={cn('text-sm mt-0.5', isNew ? 'text-red-600' : 'text-gray-500')}>{alert.description}</p>
          <p className="text-xs text-gray-400 mt-1">{alert.location} • {formatRelativeTime(alert.timestamp)}</p>
        </div>
        <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium ml-4 flex-shrink-0', statusColor(alert.status))}>
          {alert.status.charAt(0).toUpperCase() + alert.status.slice(1)}
        </span>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => onAcknowledge(alert.id)}
          className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700"
        >
          View Details
        </button>
        {isNew && (
          <button
            onClick={() => onAcknowledge(alert.id)}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-100"
          >
            Acknowledge
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [tab, setTab] = useState<AlertTab>('all')
  const [loading, setLoading] = useState(true)

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await getAlerts({ limit: 100 })
      setAlerts(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAlerts() }, [fetchAlerts])

  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type === 'new_alert') {
      setAlerts(prev => [msg.alert, ...prev])
    }
  }, [])

  useWebSocket(handleWS)

  async function handleAcknowledge(id: string) {
    try {
      const updated = await acknowledgeAlert(id)
      setAlerts(prev => prev.map(a => a.id === id ? updated : a))
    } catch (e) { console.error(e) }
  }

  async function handleResolve(id: string) {
    try {
      const updated = await resolveAlert(id)
      setAlerts(prev => prev.map(a => a.id === id ? updated : a))
    } catch (e) { console.error(e) }
  }

  const displayedAlerts =
    tab === 'all'    ? alerts :
    tab === 'high'   ? alerts.filter(a => a.severity === 'high') :
    tab === 'medium' ? alerts.filter(a => a.severity === 'medium') :
    []

  const TABS = [
    { key: 'all',      label: 'All Alerts' },
    { key: 'high',     label: 'High Priority' },
    { key: 'medium',   label: 'Medium Priority' },
    { key: 'settings', label: 'Alert Settings' },
  ] as const

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Alerts</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage and respond to safety alerts</p>
      </div>

      {/* Tab bar */}
      <div className="px-8 pb-4 flex-shrink-0">
        <div className="flex gap-0 border-b border-gray-200">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === key
                  ? 'border-gray-900 text-gray-900 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-8 pb-8 flex-1 overflow-y-auto scrollbar-thin">
        {tab === 'settings' ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-2">Alert Notification Settings</h3>
            <p className="text-sm text-gray-400">Configure your alert thresholds and notification preferences.</p>
          </div>
        ) : tab === 'high' ? (
          <div className="max-w-4xl">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle size={18} className="text-red-500" />
              <h2 className="text-lg font-bold text-red-600">High Priority Alerts</h2>
            </div>
            <p className="text-sm text-gray-500 mb-5">Critical alerts requiring immediate attention</p>
            {loading ? (
              <div className="text-sm text-gray-400">Loading…</div>
            ) : displayedAlerts.length === 0 ? (
              <div className="text-sm text-gray-400 py-8 text-center">No high priority alerts</div>
            ) : (
              displayedAlerts.map(a => (
                <HighPriorityCard key={a.id} alert={a} onAcknowledge={handleAcknowledge} />
              ))
            )}
          </div>
        ) : tab === 'medium' ? (
          <div className="max-w-4xl">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={18} className="text-orange-500" />
              <h2 className="text-lg font-bold text-orange-600">Medium Priority Alerts</h2>
            </div>
            <p className="text-sm text-gray-500 mb-5">Alerts requiring attention</p>
            {loading ? (
              <div className="text-sm text-gray-400">Loading…</div>
            ) : displayedAlerts.length === 0 ? (
              <div className="text-sm text-gray-400 py-8 text-center">No medium priority alerts</div>
            ) : (
              displayedAlerts.map(a => (
                <HighPriorityCard key={a.id} alert={a} onAcknowledge={handleAcknowledge} />
              ))
            )}
          </div>
        ) : (
          /* All Alerts Table */
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="font-semibold text-lg text-gray-900">All Safety Alerts</h2>
              <p className="text-sm text-gray-400 mt-0.5">View and respond to detected safety incidents</p>
            </div>
            {loading ? (
              <div className="text-sm text-gray-400 py-8 text-center">Loading alerts…</div>
            ) : displayedAlerts.length === 0 ? (
              <div className="text-sm text-gray-400 py-12 text-center">No alerts yet. System is monitoring…</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Alert', 'Location', 'Time', 'Priority', 'Status', 'Action'].map(h => (
                      <th key={h} className="py-3 px-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayedAlerts.map(a => (
                    <AlertRow
                      key={a.id}
                      alert={a}
                      onAcknowledge={handleAcknowledge}
                      onResolve={handleResolve}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
