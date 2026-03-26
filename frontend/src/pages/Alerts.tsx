import { useEffect, useState, useCallback } from 'react'
import {
  AlertCircle, AlertTriangle, ShieldCheck,
  RefreshCw, CheckCheck, ChevronDown, ChevronRight,
} from 'lucide-react'
import { getAlerts } from '../lib/api'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAlertCount } from '../App'
import type { Alert, WSMessage } from '../types'
import { cn, formatRelativeTime, severityColor, statusColor } from '../lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────
type AlertTab  = 'incidents' | 'raw' | 'settings'
type GroupStatus = Alert['status']

interface IncidentGroup {
  key:          string            // `${camera_id}:${alert_type}`
  camera_id:    string
  camera_name:  string
  location:     string
  alert_type:   string
  severity:     Alert['severity']
  title:        string
  description:  string            // from most recent alert
  first_seen:   string            // oldest timestamp
  last_seen:    string            // newest timestamp
  count:        number
  alerts:       Alert[]           // all detections in this group
  status:       GroupStatus       // local override
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const TYPE_ICONS: Record<string, string> = {
  sos_gesture: '🆘', person_surrounded: '👥', proximity_warning: '⚠️',
}

const TYPE_LABEL: Record<string, string> = {
  sos_gesture: 'SOS Gesture', person_surrounded: 'Person Surrounded', proximity_warning: 'Proximity Warning',
}

function groupAlerts(alerts: Alert[]): IncidentGroup[] {
  const map = new Map<string, IncidentGroup>()

  for (const a of alerts) {
    const key = `${a.camera_id}:${a.alert_type}`
    if (!map.has(key)) {
      map.set(key, {
        key, camera_id: a.camera_id, camera_name: a.camera_name,
        location: a.location, alert_type: a.alert_type,
        severity: a.severity, title: a.title,
        description: a.description,
        first_seen: a.timestamp, last_seen: a.timestamp,
        count: 0, alerts: [], status: 'new',
      })
    }
    const g = map.get(key)!
    g.alerts.push(a)
    g.count++
    // Keep most recent description (most specific confidence etc.)
    if (a.timestamp > g.last_seen) {
      g.last_seen   = a.timestamp
      g.description = a.description
    }
    if (a.timestamp < g.first_seen) {
      g.first_seen = a.timestamp
    }
  }

  // Sort: high severity first, then by last_seen desc
  return Array.from(map.values()).sort((a, b) => {
    const sv = (s: string) => s === 'high' ? 0 : s === 'medium' ? 1 : 2
    if (sv(a.severity) !== sv(b.severity)) return sv(a.severity) - sv(b.severity)
    return b.last_seen.localeCompare(a.last_seen)
  })
}

// ── Local status store ────────────────────────────────────────────────────────
const groupStatus: Record<string, GroupStatus> = {}

// ── Incident card ─────────────────────────────────────────────────────────────
function IncidentCard({ group, onAck, onResolve }: {
  group: IncidentGroup
  onAck: (key: string) => void
  onResolve: (key: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const status   = group.status
  const isNew    = status === 'new'
  const isHigh   = group.severity === 'high'
  const isCritical = group.count >= 5 && isHigh

  return (
    <div className={cn(
      'rounded-2xl border mb-3 overflow-hidden transition-all',
      status === 'resolved' ? 'border-gray-200 bg-gray-50'
      : isCritical           ? 'border-red-300 bg-red-50 shadow-sm'
      : isHigh               ? 'border-red-200 bg-red-50'
      : group.severity === 'medium' ? 'border-orange-200 bg-orange-50'
      :                        'border-gray-200 bg-white'
    )}>
      {/* Main row */}
      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Icon + count badge */}
          <div className="relative flex-shrink-0">
            <div className={cn(
              'w-12 h-12 rounded-xl flex items-center justify-center text-2xl',
              status === 'resolved' ? 'bg-gray-100'
              : isHigh ? 'bg-red-100' : 'bg-orange-100'
            )}>
              {TYPE_ICONS[group.alert_type] ?? '🔔'}
            </div>
            {group.count > 1 && (
              <span className={cn(
                'absolute -top-1.5 -right-1.5 text-xs font-bold text-white rounded-full px-1.5 py-0.5 min-w-[22px] text-center leading-none',
                isHigh ? 'bg-red-500' : 'bg-orange-500'
              )}>
                ×{group.count}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className={cn(
                    'font-semibold text-base',
                    status==='resolved' ? 'text-gray-500' : isHigh ? 'text-red-800' : 'text-orange-800'
                  )}>
                    {group.title}
                  </h3>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', severityColor(group.severity))}>
                    {group.severity}
                  </span>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', statusColor(status))}>
                    {status}
                  </span>
                </div>
                <p className={cn('text-sm mt-0.5', status==='resolved'?'text-gray-400':isHigh?'text-red-600':'text-orange-600')}>
                  {group.description}
                </p>
              </div>
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="text-xs text-gray-500 font-medium">{group.camera_name}</span>
              <span className="text-gray-300 text-xs">·</span>
              <span className="text-xs text-gray-400">{group.location}</span>
              <span className="text-gray-300 text-xs">·</span>
              <span className="text-xs text-gray-400">
                First: {formatRelativeTime(group.first_seen)}
              </span>
              <span className="text-gray-300 text-xs">·</span>
              <span className="text-xs text-gray-400">
                Last: {formatRelativeTime(group.last_seen)}
              </span>
              {group.count > 1 && (
                <>
                  <span className="text-gray-300 text-xs">·</span>
                  <span className={cn('text-xs font-semibold', isHigh?'text-red-600':'text-orange-600')}>
                    {group.count} detections
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        {status !== 'resolved' && (
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-black/5">
            {isNew && (
              <button
                onClick={() => onAck(group.key)}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors',
                  isHigh ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-500 hover:bg-orange-600'
                )}
              >
                Acknowledge
              </button>
            )}
            <button
              onClick={() => onResolve(group.key)}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-white transition-colors"
            >
              Mark Resolved
            </button>
            {group.count > 1 && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="ml-auto flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {expanded ? 'Hide' : `Show ${group.count} detections`}
              </button>
            )}
          </div>
        )}
        {status === 'resolved' && group.count > 1 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-3 flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {expanded ? 'Hide' : `Show ${group.count} detections`}
          </button>
        )}
      </div>

      {/* Expandable detection list */}
      {expanded && (
        <div className="border-t border-black/5 bg-black/[0.02] px-5 py-3 space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            All detections — {group.camera_name}
          </p>
          {[...group.alerts].reverse().map((a, i) => (
            <div key={i} className="flex items-center gap-3 text-xs text-gray-600 py-1 border-b border-gray-100 last:border-0">
              <span className="text-gray-400 w-4 text-right flex-shrink-0">{i+1}</span>
              <span className="flex-1">{a.description}</span>
              <span className="text-gray-400 flex-shrink-0">{formatRelativeTime(a.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Raw alert table row (used in Raw tab) ──────────────────────────────────────
function RawRow({ alert, onAck, onResolve }: {
  alert: Alert
  onAck: (id: string) => void
  onResolve: (id: string) => void
}) {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="py-3 px-4 text-sm font-medium text-gray-800">
        {TYPE_ICONS[alert.alert_type]} {alert.title}
      </td>
      <td className="py-3 px-4 text-xs text-gray-500">{alert.camera_name}</td>
      <td className="py-3 px-4 text-xs text-gray-400">{formatRelativeTime(alert.timestamp)}</td>
      <td className="py-3 px-4">
        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', severityColor(alert.severity))}>
          {alert.severity}
        </span>
      </td>
      <td className="py-3 px-4">
        <div className="flex gap-2">
          {alert.status === 'new' && (
            <button onClick={() => onAck(alert.id)} className="text-xs text-primary-600 hover:text-primary-800 font-medium">Ack</button>
          )}
          {alert.status !== 'resolved' && (
            <button onClick={() => onResolve(alert.id)} className="text-xs text-gray-400 hover:text-green-600">Resolve</button>
          )}
          {alert.status === 'resolved' && <span className="text-xs text-green-500">✓</span>}
        </div>
      </td>
    </tr>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function Alerts() {
  const [alerts, setAlerts]           = useState<Alert[]>([])
  const [tab, setTab]                 = useState<AlertTab>('incidents')
  const [loading, setLoading]         = useState(true)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const { setUnacknowledged }         = useAlertCount()

  // Local raw-alert status
  const [rawStatus, setRawStatus] = useState<Record<string, Alert['status']>>({})

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await getAlerts({ limit: 200 })
      setAlerts(Array.isArray(data) ? data : [])
      setLastUpdated(new Date())
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchAlerts()
    const t = setInterval(fetchAlerts, 5000)
    return () => clearInterval(t)
  }, [fetchAlerts])

  const handleWS = useCallback((msg: WSMessage) => {
    const wsAlerts = (msg as any).alerts as Alert[] | undefined
    if (Array.isArray(wsAlerts) && wsAlerts.length > 0) {
      setAlerts(prev => {
        const ids = new Set(prev.map(a => a.id))
        const newOnes = wsAlerts.filter(a => !ids.has(a.id))
        return newOnes.length ? [...newOnes, ...prev].slice(0, 500) : prev
      })
      setLastUpdated(new Date())
    }
    if (msg.type === 'new_alert') {
      setAlerts(prev => {
        if (prev.some(a => a.id === msg.alert.id)) return prev
        return [msg.alert, ...prev].slice(0, 500)
      })
    }
  }, [])

  useWebSocket(handleWS)

  // Group-level actions
  function handleGroupAck(key: string) {
    groupStatus[key] = 'acknowledged'
    setAlerts(a => [...a])   // force re-render
    setUnacknowledged(n => Math.max(0, n - 1))
  }

  function handleGroupResolve(key: string) {
    groupStatus[key] = 'resolved'
    setAlerts(a => [...a])
    setUnacknowledged(n => Math.max(0, n - 1))
  }

  function handleAckAll() {
    groups.forEach(g => { if (g.status === 'new') groupStatus[g.key] = 'acknowledged' })
    setAlerts(a => [...a])
    setUnacknowledged(0)
  }

  // Raw-level actions
  function handleRawAck(id: string) {
    setRawStatus(s => ({ ...s, [id]: 'acknowledged' }))
  }
  function handleRawResolve(id: string) {
    setRawStatus(s => ({ ...s, [id]: 'resolved' }))
  }

  // Build groups with local status applied
  const rawGroups = groupAlerts(alerts)
  const groups    = rawGroups.map(g => ({ ...g, status: (groupStatus[g.key] ?? 'new') as GroupStatus }))

  const alertsWithStatus = alerts.map(a => ({ ...a, status: rawStatus[a.id] ?? a.status }))

  const newGroupCount  = groups.filter(g => g.status === 'new').length
  const highGroups     = groups.filter(g => g.severity === 'high')
  const medGroups      = groups.filter(g => g.severity === 'medium')

  const TABS = [
    { key: 'incidents', label: 'Incidents',    count: groups.length,    badge: newGroupCount > 0 ? newGroupCount : 0 },
    { key: 'raw',       label: 'Raw Log',      count: alerts.length,    badge: 0 },
    { key: 'settings',  label: 'Settings',     count: 0,                badge: 0 },
  ] as const

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="px-8 pt-8 pb-4 flex-shrink-0 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Alerts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            <span className="font-medium text-gray-700">{groups.length} incidents</span>
            {' · '}
            {newGroupCount > 0
              ? <span className="text-red-600 font-semibold">{newGroupCount} need attention</span>
              : <span className="text-green-600 font-medium">all acknowledged</span>}
            {' · '}
            {alerts.length} total detections
            {' · updated '}
            {formatRelativeTime(lastUpdated.toISOString())}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {newGroupCount > 0 && (
            <button
              onClick={handleAckAll}
              className="flex items-center gap-1.5 text-sm text-white bg-primary-600 hover:bg-primary-700 px-3 py-2 rounded-lg font-medium"
            >
              <CheckCheck size={14} /> Acknowledge All
            </button>
          )}
          <button
            onClick={fetchAlerts}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary stats */}
      {groups.length > 0 && (
        <div className="px-8 pb-4 flex-shrink-0 flex gap-3">
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <AlertCircle size={14} className="text-red-500" />
            <span className="text-sm font-semibold text-red-700">{highGroups.length} high</span>
          </div>
          <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <AlertTriangle size={14} className="text-orange-500" />
            <span className="text-sm font-semibold text-orange-700">{medGroups.length} medium</span>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <span className="text-sm text-gray-500">{alerts.length} raw detections across {groups.length} incident types</span>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="px-8 pb-4 flex-shrink-0">
        <div className="flex border-b border-gray-200">
          {TABS.map(({ key, label, count, badge }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === key ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {label}
              {count > 0 && (
                <span className={cn(
                  'text-xs px-1.5 py-0.5 rounded-full font-semibold',
                  badge > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                )}>
                  {count}
                </span>
              )}
              {badge > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-8 pb-8 flex-1 overflow-y-auto scrollbar-thin">

        {/* ── INCIDENTS tab ── */}
        {tab === 'incidents' && (
          loading ? (
            <div className="text-sm text-gray-400 py-12 text-center">Loading incidents…</div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <ShieldCheck size={28} className="text-green-500" />
              </div>
              <p className="text-base font-semibold text-gray-600">No incidents detected</p>
              <p className="text-sm text-gray-400">System is actively monitoring all cameras</p>
            </div>
          ) : (
            <div className="max-w-4xl">
              {/* High priority section */}
              {highGroups.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle size={16} className="text-red-500" />
                    <h2 className="text-sm font-bold text-red-600 uppercase tracking-wide">
                      High Priority — {highGroups.length} incident{highGroups.length !== 1 ? 's' : ''}
                    </h2>
                  </div>
                  {highGroups.map(g => (
                    <IncidentCard key={g.key} group={g} onAck={handleGroupAck} onResolve={handleGroupResolve} />
                  ))}
                </div>
              )}

              {/* Medium priority section */}
              {medGroups.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={16} className="text-orange-500" />
                    <h2 className="text-sm font-bold text-orange-600 uppercase tracking-wide">
                      Medium Priority — {medGroups.length} incident{medGroups.length !== 1 ? 's' : ''}
                    </h2>
                  </div>
                  {medGroups.map(g => (
                    <IncidentCard key={g.key} group={g} onAck={handleGroupAck} onResolve={handleGroupResolve} />
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {/* ── RAW LOG tab ── */}
        {tab === 'raw' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Raw Detection Log</h2>
                <p className="text-xs text-gray-400 mt-0.5">Every individual detection — for debugging and auditing</p>
              </div>
              <span className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full font-medium">
                {alerts.length} entries
              </span>
            </div>
            {alerts.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No detections yet</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['Alert', 'Camera', 'Time', 'Priority', 'Action'].map(h => (
                      <th key={h} className="py-3 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {alertsWithStatus.map((a, i) => (
                    <RawRow key={a.id || i} alert={a} onAck={handleRawAck} onResolve={handleRawResolve} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── SETTINGS tab ── */}
        {tab === 'settings' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 max-w-xl">
            <h3 className="font-semibold text-gray-900 mb-4">Alert Thresholds</h3>
            <div className="space-y-1">
              {[
                { label: 'SOS confidence threshold', value: '72%',         note: 'Minimum to trigger SOS alert' },
                { label: 'Proximity distance',        value: '1.8× height', note: 'Max distance woman ↔ man' },
                { label: 'Surrounded threshold',      value: '2 men',       note: 'Min nearby men for surrounded' },
                { label: 'SOS cooldown',              value: '3s / person', note: 'Min gap between SOS alerts' },
                { label: 'Surrounded cooldown',       value: '5s / person', note: 'Min gap between surrounded' },
                { label: 'Proximity cooldown',        value: '8s / person', note: 'Min gap between proximity' },
              ].map(({ label, value, note }) => (
                <div key={label} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{note}</p>
                  </div>
                  <span className="text-sm font-semibold text-primary-600 bg-primary-50 px-3 py-1 rounded-lg ml-4 flex-shrink-0">{value}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-4">
              Edit <code className="bg-gray-100 px-1 rounded">ALERT_COOLDOWN</code> in{' '}
              <code className="bg-gray-100 px-1 rounded">video_processor.py</code> to tune sensitivity.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}