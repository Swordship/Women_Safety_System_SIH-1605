import { useEffect, useState, useCallback } from 'react'
import { Plus, MapPin, Clock, Camera as CameraIcon, Edit2, Trash2, Search, Play, VideoOff } from 'lucide-react'
import { getCameras, deleteCamera } from '../lib/api'
import type { Camera } from '../types'
import AddCameraModal from '../components/AddCameraModal'
import { cn, formatRelativeTime } from '../lib/utils'

// ─── Camera Card (left panel) ─────────────────────────────────────────────────
interface CameraCardProps {
  cam: Camera
  selected: boolean
  onSelect: () => void
  onDelete: () => void
}

function CameraCard({ cam, selected, onSelect, onDelete }: CameraCardProps) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        'rounded-xl border p-4 cursor-pointer transition-colors mb-2',
        selected
          ? 'border-primary-300 bg-primary-50'
          : 'border-gray-200 bg-white hover:border-gray-300'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CameraIcon size={16} className="text-gray-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-gray-900 truncate">{cam.name}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className={cn('w-2 h-2 rounded-full', cam.status ? 'bg-green-500' : 'bg-gray-400')} />
          <span className={cn('text-xs font-medium', cam.status ? 'text-green-600' : 'text-gray-400')}>
            {cam.status ? 'Online' : 'Offline'}
          </span>
          <span className="text-xs text-gray-400 ml-0.5">0</span>
        </div>
      </div>

      {cam.location && (
        <div className="flex items-center gap-1 mt-1.5 ml-6">
          <MapPin size={11} className="text-gray-400" />
          <span className="text-xs text-gray-500 truncate">{cam.location}</span>
        </div>
      )}

      {cam.last_active && (
        <div className="flex items-center gap-1 mt-0.5 ml-6">
          <Clock size={11} className="text-gray-400" />
          <span className="text-xs text-gray-400">Last active: {new Date(cam.last_active).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}

      {cam.model_desc && (
        <p className="text-xs text-gray-400 mt-0.5 ml-6 truncate">Model: {cam.model_desc}</p>
      )}

      <div className="flex gap-0 mt-3 border-t border-gray-100 pt-2 -mx-1">
        <button
          onClick={e => { e.stopPropagation() }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 flex-1 justify-center"
        >
          <Edit2 size={12} /> Edit
        </button>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-red-600 rounded-lg hover:bg-red-50 flex-1 justify-center"
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  )
}

// ─── Live Video Panel ─────────────────────────────────────────────────────────
function LiveView({ cam }: { cam: Camera }) {
  const [streaming, setStreaming] = useState(false)
  const [streamKey, setStreamKey] = useState(0)   // increment to force img remount + close TCP
  const [streamTab, setStreamTab] = useState<'live' | 'analytics' | 'settings'>('live')

  // Add unique timestamp so browser never reuses a cached connection
  const streamUrl = `http://localhost:8000/api/stream/${cam.id}?k=${streamKey}`

  function startStream() {
    setStreamKey(k => k + 1)   // new URL = browser opens a fresh TCP connection
    setStreaming(true)
  }

  function stopStream() {
    setStreaming(false)
    // No need to set streamKey here — img is removed from DOM which closes the connection
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900">{cam.name}</span>
          <span className={cn(
            'text-xs px-2 py-0.5 rounded-full font-medium',
            cam.status ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          )}>
            {cam.status ? 'Online' : 'Offline'}
          </span>
        </div>
        <button className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
          <Edit2 size={14} /> Edit
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-5 pt-3">
        {(['live', 'analytics', 'settings'] as const).map(t => (
          <button
            key={t}
            onClick={() => setStreamTab(t)}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-medium transition-colors capitalize',
              streamTab === t ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            {t === 'live' ? 'Live View' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Video area */}
      <div className="flex-1 m-5 bg-gray-900 rounded-xl overflow-hidden flex items-center justify-center relative min-h-0">
        {streamTab === 'live' && streaming ? (
          <>
            <img
              src={streamUrl}
              alt="Live stream"
              className="w-full h-full object-contain"
              onError={() => setStreaming(false)}
            />
            <button
              onClick={() => setStreaming(false)}
              className="absolute top-3 right-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-lg hover:bg-black/80"
            >
              Stop
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <VideoOff size={48} className="text-gray-600" />
            <span className="text-sm">Stream not active</span>
            {cam.status && (
              <button
                onClick={startStream}
                className="flex items-center gap-2 bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700"
              >
                <Play size={14} /> Start Stream
              </button>
            )}
          </div>
        )}
      </div>

      {/* Camera info */}
      {streamTab === 'analytics' && (
        <div className="px-5 pb-5 grid grid-cols-2 gap-3">
          {[
            { label: 'Location', value: cam.location || '—' },
            { label: 'Coordinates', value: `${cam.latitude.toFixed(4)}, ${cam.longitude.toFixed(4)}` },
            { label: 'RTSP URL', value: cam.rtsp_url },
            { label: 'Model', value: cam.model_desc || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400">{label}</p>
              <p className="text-sm font-medium text-gray-800 truncate">{value}</p>
            </div>
          ))}
        </div>
      )}

      {streamTab === 'settings' && (
        <div className="px-5 pb-5">
          <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
            <span className="text-sm text-gray-700">Camera Active</span>
            <div className={cn(
              'w-10 h-5 rounded-full transition-colors',
              cam.status ? 'bg-primary-600' : 'bg-gray-300'
            )}>
              <div className={cn(
                'w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform',
                cam.status ? 'translate-x-5' : 'translate-x-0.5'
              )} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Cameras() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [selected, setSelected] = useState<Camera | null>(null)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [tab, setTab] = useState<'cameras' | 'map'>('cameras')
  const [loading, setLoading] = useState(true)

  const fetchCameras = useCallback(async () => {
    try {
      const data = await getCameras()
      setCameras(data)
      if (!selected && data.length > 0) setSelected(data[0])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [selected])

  useEffect(() => { fetchCameras() }, [])

  async function handleDelete(id: string) {
    if (!confirm('Delete this camera?')) return
    await deleteCamera(id)
    if (selected?.id === id) setSelected(null)
    fetchCameras()
  }

  const filtered = cameras.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.location.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4 flex items-start justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cameras</h1>
          <p className="text-sm text-gray-500 mt-0.5">Monitor and manage security cameras</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-primary-700 shadow-sm"
        >
          <Plus size={16} /> Add Camera
        </button>
      </div>

      {/* Tab bar */}
      <div className="px-8 pb-4 flex-shrink-0">
        <div className="flex gap-1">
          {(['cameras', 'map'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                tab === t ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'
              )}
            >
              {t === 'cameras' ? <><CameraIcon size={14} /> Cameras</> : <><MapPin size={14} /> Map View</>}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-8 pb-8 flex gap-5 flex-1 min-h-0">
        {/* Left: camera list */}
        <div className="w-72 flex-shrink-0 flex flex-col">
          {/* Search */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search cameras..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {loading ? (
              <div className="text-sm text-gray-400 text-center py-8">Loading cameras…</div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-8">No cameras found</div>
            ) : (
              filtered.map(cam => (
                <CameraCard
                  key={cam.id}
                  cam={cam}
                  selected={selected?.id === cam.id}
                  onSelect={() => setSelected(cam)}
                  onDelete={() => handleDelete(cam.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: live view */}
        <div className="flex-1 min-w-0">
          {selected ? (
            <LiveView cam={selected} />
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm h-full flex items-center justify-center">
              <div className="text-center text-gray-400">
                <CameraIcon size={48} className="mx-auto mb-3 text-gray-300" />
                <p className="text-sm">Select a camera to view the live feed</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {showAdd && (
        <AddCameraModal
          onClose={() => setShowAdd(false)}
          onCreated={fetchCameras}
        />
      )}
    </div>
  )
}