import { useState } from 'react'
import { X } from 'lucide-react'
import { createCamera } from '../lib/api'
import type { CameraCreate } from '../types'
import { cn } from '../lib/utils'

interface Props {
  onClose: () => void
  onCreated: () => void
}

const defaultForm: CameraCreate = {
  name: '',
  location: '',
  rtsp_url: 'rtsp://',
  latitude: 0,
  longitude: 0,
  model_desc: '',
  status: true,
}

export default function AddCameraModal({ onClose, onCreated }: Props) {
  const [form, setForm] = useState<CameraCreate>(defaultForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (field: keyof CameraCreate, value: string | number | boolean) =>
    setForm(p => ({ ...p, [field]: value }))

  async function handleSubmit() {
    if (!form.name.trim()) { setError('Camera name is required'); return }
    setLoading(true)
    setError('')
    try {
      await createCamera(form)
      onCreated()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create camera')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 z-10">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Add New Camera</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Enter the details for the new security camera. All fields marked with * are required.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 ml-4 flex-shrink-0">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4 mt-2">
          {/* Camera Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Camera Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. Main Entrance Camera"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location Description</label>
            <input
              type="text"
              value={form.location}
              onChange={e => set('location', e.target.value)}
              placeholder="e.g. Front entrance, north side of building"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* RTSP URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">RTSP URL *</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.rtsp_url}
                onChange={e => set('rtsp_url', e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <button className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 font-medium">
                Test
              </button>
            </div>
          </div>

          {/* Lat / Lng */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Latitude *</label>
              <input
                type="number"
                step="any"
                value={form.latitude}
                onChange={e => set('latitude', parseFloat(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Longitude *</label>
              <input
                type="number"
                step="any"
                value={form.longitude}
                onChange={e => set('longitude', parseFloat(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description / Model Number</label>
            <input
              type="text"
              value={form.model_desc}
              onChange={e => set('model_desc', e.target.value)}
              placeholder="e.g. Hikvision DS-2CD2385G1-I"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Status toggle */}
          <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-700">Camera Status</p>
              <p className="text-xs text-gray-400">Set the initial status of the camera</p>
            </div>
            <button
              type="button"
              onClick={() => set('status', !form.status)}
              className={cn(
                'w-11 h-6 rounded-full transition-colors relative flex-shrink-0',
                form.status ? 'bg-primary-600' : 'bg-gray-300'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                  form.status ? 'translate-x-5' : 'translate-x-0.5'
                )}
              />
            </button>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-60"
            >
              {loading ? 'Adding…' : 'Add Camera'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
