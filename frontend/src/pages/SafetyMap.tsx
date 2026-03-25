import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import { AlertCircle, AlertTriangle, Info, CheckCircle } from 'lucide-react'
import { getHotspots } from '../lib/api'
import type { Hotspot } from '../types'
import { cn } from '../lib/utils'

const RISK_COLORS = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
}

function riskLevel(h: Hotspot): 'critical' | 'high' | 'medium' | 'low' {
  if (h.high_count >= 3)  return 'critical'
  if (h.high_count >= 1)  return 'high'
  if (h.medium_count >= 1) return 'medium'
  return 'low'
}

function RiskCard({
  color, label, count, icon: Icon, bg
}: {
  color: string; label: string; count: number; icon: React.ElementType; bg: string
}) {
  return (
    <div className={cn('rounded-xl p-4 mb-3', bg)}>
      <div className="flex items-center gap-2 mb-0.5">
        <Icon size={15} className={color} />
        <span className={cn('text-sm font-semibold', color)}>{label}</span>
      </div>
      <p className="text-xs text-gray-500">{count} location{count !== 1 ? 's' : ''} identified</p>
    </div>
  )
}

export default function SafetyMap() {
  const [hotspots, setHotspots] = useState<Hotspot[]>([])
  const [tab, setTab] = useState<'heatmap' | 'incident' | 'geo'>('heatmap')

  useEffect(() => {
    getHotspots().then(setHotspots).catch(console.error)
  }, [])

  const counts = {
    critical: hotspots.filter(h => riskLevel(h) === 'critical').length,
    high:     hotspots.filter(h => riskLevel(h) === 'high').length,
    medium:   hotspots.filter(h => riskLevel(h) === 'medium').length,
    low:      hotspots.filter(h => riskLevel(h) === 'low').length,
  }

  // Default center — Tamil Nadu
  const center: [number, number] = hotspots.length > 0
    ? [hotspots[0].latitude || 12.9, hotspots[0].longitude || 79.1]
    : [12.9, 79.1]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Safety Heat Map</h1>
        <p className="text-sm text-gray-500 mt-0.5">Monitor high-risk areas and safety hotspots</p>
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
                tab === key
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Map + sidebar */}
      <div className="px-8 pb-8 flex gap-5 flex-1 min-h-0">
        {/* Map */}
        <div className="flex-1 rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
          <MapContainer
            center={center}
            zoom={11}
            style={{ height: '100%', width: '100%' }}
            key={center.join(',')}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {hotspots.map(h => {
              const risk = riskLevel(h)
              const color = RISK_COLORS[risk]
              const lat = h.latitude || 0
              const lng = h.longitude || 0
              if (!lat && !lng) return null

              return (
                <CircleMarker
                  key={h.camera_id}
                  center={[lat, lng]}
                  radius={risk === 'critical' ? 16 : risk === 'high' ? 12 : 9}
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: 0.5,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <div className="text-sm">
                      <p className="font-semibold">{h.camera_name}</p>
                      <p className="text-gray-500">{h.location}</p>
                      <p className="mt-1">Total alerts: <strong>{h.total_alerts}</strong></p>
                      <p>High: {h.high_count} · Medium: {h.medium_count} · Low: {h.low_count}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              )
            })}
          </MapContainer>

          {/* Legend overlay */}
          <div className="absolute bottom-10 right-10 bg-white rounded-xl shadow-lg border border-gray-200 px-4 py-3 z-[1000]">
            <p className="text-xs font-semibold text-gray-700 mb-2">Risk Level</p>
            <div className="flex gap-3">
              {Object.entries(RISK_COLORS).map(([label, color]) => (
                <div key={label} className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                  <span className="text-xs capitalize text-gray-600">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 h-full">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Hotspot Details</h3>
            <p className="text-xs text-gray-400 mb-5">Safety risk assessment</p>

            <RiskCard
              color="text-red-600"
              label="Critical Risk Areas"
              count={counts.critical}
              icon={AlertCircle}
              bg="bg-red-50"
            />
            <RiskCard
              color="text-orange-500"
              label="High Risk Areas"
              count={counts.high}
              icon={AlertTriangle}
              bg="bg-orange-50"
            />
            <RiskCard
              color="text-yellow-600"
              label="Medium Risk Areas"
              count={counts.medium}
              icon={Info}
              bg="bg-yellow-50"
            />
            <RiskCard
              color="text-green-600"
              label="Low Risk Areas"
              count={counts.low}
              icon={CheckCircle}
              bg="bg-green-50"
            />

            {/* Camera list */}
            {hotspots.length > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Active Cameras</p>
                <div className="space-y-2 overflow-y-auto scrollbar-thin max-h-48">
                  {hotspots.map(h => (
                    <div key={h.camera_id} className="flex items-start gap-2">
                      <div
                        className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: RISK_COLORS[riskLevel(h)] }}
                      />
                      <div>
                        <p className="text-xs font-medium text-gray-800 leading-tight">{h.camera_name}</p>
                        <p className="text-xs text-gray-400">{h.total_alerts} alerts</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
