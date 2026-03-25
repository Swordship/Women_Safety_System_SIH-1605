import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Users, UserX, Bell, MapPin, AlertCircle, AlertTriangle, TrendingUp } from 'lucide-react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from 'recharts'
import { getStats, getAlerts } from '../lib/api'
import { useWebSocket } from '../hooks/useWebSocket'
import type { DashboardStats, Alert, WSMessage } from '../types'
import { formatRelativeTime, severityBorder, cn } from '../lib/utils'

// ─── Stat Card ────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string
  value: number | string
  sub: string
  positive?: boolean
  icon: React.ReactNode
  color: string
}

function StatCard({ label, value, sub, positive, icon, color }: StatCardProps) {
  return (
    <div className={cn('rounded-2xl p-5 text-white shadow-sm flex-1 min-w-0', color)}>
      <div className="flex items-start justify-between mb-2">
        <div className="text-sm font-medium opacity-90">{label}</div>
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
      </div>
      <div className="text-3xl font-bold mb-1">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className={cn('text-xs', positive === false ? 'text-red-200' : 'text-white/80')}>
        {sub}
      </div>
    </div>
  )
}

// ─── Alert Item in sidebar ────────────────────────────────────────────────────
function RecentAlertItem({ alert }: { alert: Alert }) {
  const Icon = alert.severity === 'high' ? AlertCircle : AlertTriangle
  return (
    <div className={cn('border-l-4 rounded-r-lg p-3 mb-2', severityBorder(alert.severity))}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon size={14} className={alert.severity === 'high' ? 'text-red-500' : 'text-orange-400'} />
          <span className="text-sm font-semibold text-gray-900">{alert.title}</span>
        </div>
        <span className="text-xs text-gray-400 flex-shrink-0">{formatRelativeTime(alert.timestamp)}</span>
      </div>
      <p className="text-xs text-gray-600 mt-0.5 ml-5">{alert.description}</p>
      <p className={cn('text-xs mt-1 ml-5', alert.severity === 'high' ? 'text-red-500' : 'text-orange-500')}>
        {alert.location}
      </p>
    </div>
  )
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function MetricBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm text-gray-700">{label}</span>
        <span className="text-sm text-gray-500">{value.toLocaleString()} / {total.toLocaleString()}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'analytics' | 'alerts'>('overview')
  const [fps, setFps]                   = useState<number>(0)
  const [modelReady, setModelReady]     = useState(false)
  const fetchData = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        getStats(),
        getAlerts({ limit: 5 }),
      ])
      setStats(s)
      setAlerts(a)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const prevStatsKey = useRef('')
  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type === 'stats_update') {
      // Only re-render when counts actually changed — stops the blink
      const d   = msg.data as any
      const key = `${d.women_monitored}|${d.men_detected}|${d.alerts_today}`
      if (key !== prevStatsKey.current) {
        prevStatsKey.current = key
        setStats(msg.data)
        if (d.fps         !== undefined) setFps(d.fps)
        if (d.model_ready !== undefined) setModelReady(d.model_ready)
      }
      const wsAlerts = (msg as any).alerts
      if (Array.isArray(wsAlerts) && wsAlerts.length > 0) {
        setAlerts(wsAlerts.slice(0, 5))
      }
    }
    if (msg.type === 'new_alert') {
      setAlerts(prev => [msg.alert, ...prev].slice(0, 5))
    }
  }, [])

  useWebSocket(handleWS)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-sm">Loading dashboard…</div>
      </div>
    )
  }

  const sm = stats?.safety_metrics
  const totalW = sm?.total_women || 0

  const pieData = [
    { name: 'Women', value: stats?.women_monitored || 0, color: '#7c3aed' },
    { name: 'Men',   value: stats?.men_detected || 0,    color: '#a78bfa' },
  ]

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Welcome to the EmpowerHer Analytics Dashboard</p>
      </div>

      {/* Stat cards */}
      <div className="px-8 pb-4 flex gap-4">
        <StatCard
          label="Women Monitored"
          value={stats?.women_monitored ?? 0}
          sub="+5.8% from last week"
          positive
          color="bg-primary-600"
          icon={<Users size={20} className="text-white" />}
        />
        <StatCard
          label="Men Detected"
          value={stats?.men_detected ?? 0}
          sub="+2.3% from last week"
          positive
          color="bg-violet-400"
          icon={<UserX size={20} className="text-white" />}
        />
        <StatCard
          label="Alerts Today"
          value={stats?.alerts_today ?? 0}
          sub="-3.6% from last week"
          positive={false}
          color="bg-red-400"
          icon={<Bell size={20} className="text-white" />}
        />
        <StatCard
          label="Hotspot Areas"
          value={stats?.hotspot_areas ?? 0}
          sub="Active monitoring zones"
          color="bg-orange-400"
          icon={<MapPin size={20} className="text-white" />}
        />
      </div>

      {/* Tab bar */}
      <div className="px-8 pb-4">
        <div className="flex gap-1 border-b border-gray-200">
          {(['overview', 'analytics', 'alerts'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
                tab === t
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="px-8 pb-8 flex gap-5 flex-1 min-h-0">
        {/* Left: charts */}
        <div className="flex flex-col gap-5 flex-1 min-w-0">
          {/* Gender Distribution */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Gender Distribution</h3>
            <div className="flex items-center gap-6">
              <div className="w-44 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => v.toLocaleString()} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-8">
                {pieData.map(d => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    <span className="text-sm text-gray-600">{d.name}</span>
                    <span className="text-sm font-semibold text-gray-900">{d.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Safety Metrics */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex-1">
            <h3 className="text-base font-semibold text-gray-900 mb-5">Safety Metrics</h3>
            <MetricBar label="Lone Women"       value={sm?.lone_women || 0}        total={totalW || 1842} color="bg-red-500" />
            <MetricBar label="Surrounded"       value={sm?.surrounded || 0}         total={totalW || 1842} color="bg-purple-500" />
            <MetricBar label="SOS Gestures"     value={sm?.sos_gestures || 0}       total={sm?.sos_gestures ? sm.sos_gestures * 19 : 342} color="bg-yellow-400" />
            <MetricBar label="Safe Interactions" value={sm?.safe_interactions || 0} total={totalW || 1842} color="bg-green-500" />
          </div>
        </div>

        {/* Right: Recent Alerts */}
        <div className="w-72 flex-shrink-0">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-primary-600" />
                <span className="text-base font-semibold text-gray-900">Recent Alerts</span>
              </div>
              <Link to="/alerts" className="text-sm text-primary-600 font-medium hover:underline">
                View All
              </Link>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {alerts.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-8">No recent alerts</div>
              ) : (
                alerts.map(a => <RecentAlertItem key={a.id} alert={a} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}