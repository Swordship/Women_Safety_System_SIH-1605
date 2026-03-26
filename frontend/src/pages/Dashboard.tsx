import { useEffect, useState, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Users, UserX, Bell, MapPin, AlertCircle, AlertTriangle,
  Camera, ChevronRight, Wifi, WifiOff, Activity,
} from 'lucide-react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { getStats, getAlerts } from '../lib/api'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAlertCount } from '../App'
import type { DashboardStats, Alert, WSMessage } from '../types'
import { formatRelativeTime, severityBorder, cn } from '../lib/utils'

function StatCard({ label, value, sub, icon, color, to }: {
  label: string; value: number | string; sub: string
  icon: React.ReactNode; color: string; to?: string
}) {
  const navigate = useNavigate()
  return (
    <div
      onClick={() => to && navigate(to)}
      className={cn(
        'rounded-2xl p-5 text-white shadow-sm flex-1 min-w-0 transition-transform',
        color, to && 'cursor-pointer hover:scale-[1.02] active:scale-[0.98]'
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="text-sm font-medium opacity-90">{label}</div>
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">{icon}</div>
      </div>
      <div className="text-3xl font-bold mb-1">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="flex items-center justify-between">
        <div className="text-xs text-white/80">{sub}</div>
        {to && <ChevronRight size={14} className="text-white/60" />}
      </div>
    </div>
  )
}

function RecentAlertItem({ alert }: { alert: Alert }) {
  const Icon = alert.severity === 'high' ? AlertCircle : AlertTriangle
  return (
    <div className={cn('border-l-4 rounded-r-lg p-3 mb-2', severityBorder(alert.severity))}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon size={14} className={cn('flex-shrink-0', alert.severity === 'high' ? 'text-red-500' : 'text-orange-400')} />
          <span className="text-sm font-semibold text-gray-900 truncate">{alert.title}</span>
        </div>
        <span className="text-xs text-gray-400 flex-shrink-0">{formatRelativeTime(alert.timestamp)}</span>
      </div>
      <p className="text-xs text-gray-600 mt-0.5 ml-5 line-clamp-1">{alert.description}</p>
    </div>
  )
}

function MetricBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm text-gray-700">{label}</span>
        <span className="text-sm font-semibold text-gray-900">{value}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-700', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats]           = useState<DashboardStats | null>(null)
  const [alerts, setAlerts]         = useState<Alert[]>([])
  const [fps, setFps]               = useState(0)
  const [modelReady, setModelReady] = useState(false)
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<'overview' | 'analytics' | 'alerts'>('overview')
  const prevStatsKey                = useRef('')
  const { setUnacknowledged }       = useAlertCount()

  const fetchData = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([getStats(), getAlerts({ limit: 5 })])
      setStats(s); setAlerts(Array.isArray(a) ? a : [])
      const raw = s as any
      if (raw.fps         !== undefined) setFps(raw.fps)
      if (raw.model_ready !== undefined) setModelReady(raw.model_ready)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type === 'stats_update') {
      const d = msg.data as any
      const key = `${d.women_monitored}|${d.men_detected}|${d.alerts_today}`
      if (key !== prevStatsKey.current) {
        prevStatsKey.current = key
        setStats(msg.data)
        if (d.fps         !== undefined) setFps(d.fps)
        if (d.model_ready !== undefined) setModelReady(d.model_ready)
      }
      const wsAlerts = (msg as any).alerts
      if (Array.isArray(wsAlerts) && wsAlerts.length > 0) setAlerts(wsAlerts.slice(0, 5))
    }
    if (msg.type === 'new_alert') {
      setAlerts(prev => [msg.alert, ...prev].slice(0, 5))
      setUnacknowledged(n => n + 1)
    }
  }, [setUnacknowledged])

  const { connected } = useWebSocket(handleWS)

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-gray-400 text-sm">Loading dashboard…</div>
    </div>
  )

  const sm = stats?.safety_metrics
  const totalW = Math.max(sm?.total_women || 1, 1)
  const newAlerts = alerts.filter(a => a.status === 'new').length

  const pieData = [
    { name: 'Women', value: stats?.women_monitored || 0, color: '#7c3aed' },
    { name: 'Men',   value: stats?.men_detected    || 0, color: '#a78bfa' },
  ]

  const barData = [
    { name: 'SOS',       count: sm?.sos_gestures     || 0, fill: '#ef4444' },
    { name: 'Surrounded',count: sm?.surrounded        || 0, fill: '#8b5cf6' },
    { name: 'Proximity', count: Math.max(0, (stats?.alerts_today||0)-(sm?.sos_gestures||0)-(sm?.surrounded||0)), fill: '#f97316' },
    { name: 'Safe',      count: sm?.safe_interactions || 0, fill: '#22c55e' },
  ]

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-8 pt-8 pb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">EmpowerHer — live session data</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold',
            modelReady ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700')}>
            <div className={cn('w-1.5 h-1.5 rounded-full', modelReady ? 'bg-green-500 animate-pulse' : 'bg-yellow-500')} />
            {modelReady ? `${fps} FPS` : 'Loading model…'}
          </div>
          <div className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold',
            connected ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500')}>
            {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {connected ? 'Live' : 'Reconnecting…'}
          </div>
        </div>
      </div>

      <div className="px-8 pb-4 flex gap-4">
        <StatCard label="Women Monitored" value={stats?.women_monitored ?? 0} sub="Unique tracked" color="bg-primary-600" icon={<Users size={20} className="text-white" />} to="/cameras" />
        <StatCard label="Men Detected"    value={stats?.men_detected    ?? 0} sub="Unique tracked" color="bg-violet-400"  icon={<UserX size={20} className="text-white" />} to="/cameras" />
        <StatCard label="Alerts Total"    value={stats?.alerts_today    ?? 0} sub={newAlerts > 0 ? `${newAlerts} need attention` : 'All clear'} color={newAlerts > 0 ? 'bg-red-500' : 'bg-red-400'} icon={<Bell size={20} className="text-white" />} to="/alerts" />
        <StatCard label="Hotspot Areas"   value={stats?.hotspot_areas   ?? 0} sub="View on map"    color="bg-orange-400" icon={<MapPin size={20} className="text-white" />} to="/safety-map" />
      </div>

      <div className="px-8 pb-4">
        <div className="flex gap-1 border-b border-gray-200">
          {(['overview', 'analytics', 'alerts'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
                tab === t ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700')}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="px-8 pb-8 flex gap-5 flex-1 min-h-0">
        <div className="flex flex-col gap-5 flex-1 min-w-0">
          {tab === 'overview' && (
            <>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-base font-semibold text-gray-900 mb-4">Gender Distribution</h3>
                <div className="flex items-center gap-6">
                  <div className="w-44 h-44 flex-shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={48} outerRadius={70} paddingAngle={3} dataKey="value">
                          {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => v.toLocaleString()} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex gap-8">
                    {pieData.map(d => (
                      <div key={d.name} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ background: d.color }} />
                          <span className="text-sm text-gray-500">{d.name}</span>
                        </div>
                        <span className="text-2xl font-bold text-gray-900 ml-5">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex-1">
                <h3 className="text-base font-semibold text-gray-900 mb-5">Safety Metrics</h3>
                <MetricBar label="SOS Gestures"     value={sm?.sos_gestures     ||0} total={Math.max(sm?.sos_gestures||0,1)}     color="bg-red-500" />
                <MetricBar label="Surrounded"        value={sm?.surrounded       ||0} total={Math.max(sm?.surrounded||0,1)}       color="bg-purple-500" />
                <MetricBar label="Safe Interactions" value={sm?.safe_interactions||0} total={totalW}                              color="bg-green-500" />
                <MetricBar label="Total Tracked"     value={sm?.total_women      ||0} total={Math.max(sm?.total_women||0,1)}      color="bg-primary-500" />
              </div>
            </>
          )}

          {tab === 'analytics' && (
            <div className="flex flex-col gap-5 flex-1">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-base font-semibold text-gray-900">Alert Breakdown</h3>
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Activity size={12} /> Session totals
                  </div>
                </div>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} barSize={36}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }} />
                      <Bar dataKey="count" radius={[4,4,0,0]}>
                        {barData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'SOS Confidence Threshold', value: '72%',         note: 'Below this is ignored' },
                  { label: 'Proximity Range',           value: '1.8× height', note: 'Woman ↔ man trigger distance' },
                  { label: 'SOS Cooldown',              value: '3 seconds',   note: 'Min gap between SOS alerts' },
                  { label: 'Consecutive Frames',        value: '2–4 frames',  note: 'Required for confirmation' },
                ].map(({ label, value, note }) => (
                  <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <p className="text-xs text-gray-400">{label}</p>
                    <p className="text-lg font-bold text-gray-900 mt-1">{value}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{note}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'alerts' && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex-1">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Recent Alerts</h3>
                <Link to="/alerts" className="text-sm text-primary-600 hover:underline font-medium flex items-center gap-1">
                  View all <ChevronRight size={14} />
                </Link>
              </div>
              <div className="divide-y divide-gray-50">
                {alerts.length === 0
                  ? <div className="py-12 text-center text-sm text-gray-400">No alerts yet</div>
                  : alerts.map((a, i) => (
                    <div key={a.id||i} className="px-6 py-3 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3">
                        {a.severity === 'high'
                          ? <AlertCircle size={15} className="text-red-500 flex-shrink-0" />
                          : <AlertTriangle size={15} className="text-orange-400 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{a.title}</p>
                          <p className="text-xs text-gray-500 truncate">{a.description}</p>
                        </div>
                        <span className="text-xs text-gray-400">{formatRelativeTime(a.timestamp)}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        <div className="w-72 flex-shrink-0 flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-primary-600" />
                <span className="text-base font-semibold text-gray-900">Recent Alerts</span>
                {newAlerts > 0 && <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{newAlerts}</span>}
              </div>
              <Link to="/alerts" className="text-sm text-primary-600 font-medium hover:underline">View All</Link>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {alerts.length === 0
                ? <div className="flex flex-col items-center justify-center h-full gap-2 py-8 text-center">
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                      <Bell size={18} className="text-green-500" />
                    </div>
                    <p className="text-sm text-gray-400">No alerts yet</p>
                    <p className="text-xs text-gray-300">System monitoring…</p>
                  </div>
                : alerts.map((a, i) => <RecentAlertItem key={a.id||i} alert={a} />)
              }
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</p>
            <div className="space-y-2">
              <Link to="/cameras" className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors text-sm font-medium">
                <Camera size={15} /> Open Live Stream
              </Link>
              <Link to="/alerts" className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition-colors text-sm font-medium">
                <AlertCircle size={15} /> View All Alerts
                {newAlerts > 0 && <span className="ml-auto bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">{newAlerts}</span>}
              </Link>
              <Link to="/safety-map" className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors text-sm font-medium">
                <MapPin size={15} /> Safety Map
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}