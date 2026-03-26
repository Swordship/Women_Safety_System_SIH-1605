import { useEffect, useState, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import { AlertCircle, AlertTriangle, Info, CheckCircle, RefreshCw } from 'lucide-react'
import { getHotspots } from '../lib/api'
import { useWebSocket } from '../hooks/useWebSocket'
import type { Hotspot, WSMessage } from '../types'
import { cn, formatRelativeTime } from '../lib/utils'

const RISK_COLORS = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
}

function riskLevel(h: Hotspot): 'critical' | 'high' | 'medium' | 'low' {
  if (h.high_count >= 3)   return 'critical'
  if (h.high_count >= 1)   return 'high'
  if (h.medium_count >= 1) return 'medium'
  return 'low'
}

// Fly to updated center when hotspots change — no full remount
function MapUpdater({ center }: { center: [number, number] }) {
  const map      = useMap()
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    map.flyTo(center, map.getZoom(), { animate: true, duration: 1 })
  }, [center, map])
  return null
}

// ── Risk card ──────────────────────────────────────────────────────────────────
function RiskCard({ color, label, count, icon: Icon, bg }: {
  color: string; label: string; count: number; icon: React.ElementType; bg: string
}) {
  return (
    <div className={cn('rounded-xl p-4 mb-3', bg)}>
      <div className="flex items-center gap-2 mb-0.5">
        <Icon size={15} className={color} />
        <span className={cn('text-sm font-semibold', color)}>{label}</span>
      </div>
      <p className="text-xs text-gray-500">
        {count} location{count !== 1 ? 's' : ''} identified
      </p>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function SafetyMap() {
  const [hotspots, setHotspots]     = useState<Hotspot[]>([])
  const [loading, setLoading]       = useState(true)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [tab, setTab] = useState<'heatmap' | 'incident' | 'geo'>('heatmap')

  const fetchHotspots = useCallback(async () => {
    try {
      const data = await getHotspots()
      setHotspots(Array.isArray(data) ? data : [])
      setLastUpdated(new Date())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Load on mount + refresh every 10s
  useEffect(() => {
    fetchHotspots()
    const t = setInterval(fetchHotspots, 10_000)
    return () => clearInterval(t)
  }, [fetchHotspots])

  // Refresh hotspot counts when WS pushes new stats
  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type === 'stats_update') {
      fetchHotspots()
    }
  }, [fetchHotspots])

  useWebSocket(handleWS)

  const counts = {
    critical: hotspots.filter(h => riskLevel(h) === 'critical').length,
    high:     hotspots.filter(h => riskLevel(h) === 'high').length,
    medium:   hotspots.filter(h => riskLevel(h) === 'medium').length,
    low:      hotspots.filter(h => riskLevel(h) === 'low').length,
  }

  // Stable center — only changes when hotspots first load, not every refresh
  const center: [number, number] = hotspots.length > 0 && hotspots[0].latitude
    ? [hotspots[0].latitude, hotspots[0].longitude]
    : [13.1489, 78.1686]   // default: Tamil Nadu / Kallakurichi

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="px-8 pt-8 pb-4 flex-shrink-0 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Safety Heat Map</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Monitor high-risk areas · updated {formatRelativeTime(lastUpdated.toISOString())}
          </p>
        </div>
        <button
          onClick={fetchHotspots}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 mt-1"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Tab bar */}
      <div className="px-8 pb-4 flex-shrink-0">
        <div className="flex gap-1">
          {([
            ['heatmap',  'Heat Map View'],
            ['incident', 'Incident Map'],
            ['geo',      'Geographic Analytics'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                tab === key ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Map + sidebar */}
      <div className="px-8 pb-8 flex gap-5 flex-1 min-h-0">

        {/* Map — position:relative so legend overlay works */}
        <div className="flex-1 rounded-2xl overflow-hidden border border-gray-200 shadow-sm relative">

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-[2000]">
              <p className="text-sm text-gray-400">Loading map…</p>
            </div>
          )}

          <MapContainer
            center={center}
            zoom={11}
            style={{ height: '100%', width: '100%' }}
          >
            <MapUpdater center={center} />

            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {hotspots.map(h => {
              const risk  = riskLevel(h)
              const color = RISK_COLORS[risk]
              if (!h.latitude || !h.longitude) return null

              return (
                <CircleMarker
                  key={h.camera_id}
                  center={[h.latitude, h.longitude]}
                  radius={
                    risk === 'critical' ? 20 :
                    risk === 'high'     ? 14 :
                    risk === 'medium'   ? 10 : 7
                  }
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: 0.45,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <div className="text-sm min-w-[160px]">
                      <p className="font-semibold text-gray-900">{h.camera_name}</p>
                      <p className="text-gray-500 text-xs mt-0.5">{h.location}</p>
                      <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5">
                        <p className="flex justify-between">
                          <span className="text-gray-500">Total alerts</span>
                          <strong>{h.total_alerts}</strong>
                        </p>
                        <p className="flex justify-between">
                          <span className="text-red-500">High</span>
                          <strong>{h.high_count}</strong>
                        </p>
                        <p className="flex justify-between">
                          <span className="text-orange-500">Medium</span>
                          <strong>{h.medium_count}</strong>
                        </p>
                        <p className="flex justify-between">
                          <span className="text-green-500">Low</span>
                          <strong>{h.low_count}</strong>
                        </p>
                      </div>
                      <div
                        className="mt-2 text-xs font-semibold text-center py-1 rounded-md capitalize"
                        style={{ background: color + '22', color }}
                      >
                        {risk} risk
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
              )
            })}
          </MapContainer>

          {/* Legend overlay — works because parent is position:relative */}
          <div className="absolute bottom-4 left-4 bg-white rounded-xl shadow-md border border-gray-200 px-4 py-3 z-[1000]">
            <p className="text-xs font-semibold text-gray-700 mb-2">Risk Level</p>
            <div className="flex flex-col gap-1.5">
              {Object.entries(RISK_COLORS).map(([label, color]) => (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-xs capitalize text-gray-600">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* No hotspots overlay */}
          {!loading && hotspots.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-[1000] pointer-events-none">
              <div className="bg-white/90 rounded-2xl shadow-lg px-6 py-5 text-center">
                <p className="text-sm font-medium text-gray-700">No hotspots yet</p>
                <p className="text-xs text-gray-400 mt-1">Alerts will appear as the system detects incidents</p>
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="w-64 flex-shrink-0 flex flex-col gap-4">

          {/* Risk summary */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Hotspot Details</h3>
            <p className="text-xs text-gray-400 mb-4">Safety risk assessment</p>

            <RiskCard color="text-red-600"    label="Critical Risk" count={counts.critical} icon={AlertCircle}  bg="bg-red-50" />
            <RiskCard color="text-orange-500" label="High Risk"     count={counts.high}     icon={AlertTriangle} bg="bg-orange-50" />
            <RiskCard color="text-yellow-600" label="Medium Risk"   count={counts.medium}   icon={Info}          bg="bg-yellow-50" />
            <RiskCard color="text-green-600"  label="Low Risk"      count={counts.low}      icon={CheckCircle}   bg="bg-green-50" />
          </div>

          {/* Active cameras */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Active Cameras
            </p>

            {hotspots.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">
                No cameras reporting alerts yet
              </p>
            ) : (
              <div className="space-y-3 overflow-y-auto scrollbar-thin">
                {hotspots.map(h => {
                  const risk  = riskLevel(h)
                  const color = RISK_COLORS[risk]
                  return (
                    <div key={h.camera_id} className="flex items-start gap-2.5">
                      <div
                        className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0"
                        style={{ background: color }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">
                          {h.camera_name}
                        </p>
                        <p className="text-xs text-gray-400">{h.location}</p>
                        <div className="flex gap-2 mt-0.5">
                          <span className="text-xs text-red-500">{h.high_count} high</span>
                          <span className="text-xs text-orange-400">{h.medium_count} med</span>
                          <span className="text-xs text-gray-400">{h.total_alerts} total</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}