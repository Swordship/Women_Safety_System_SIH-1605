import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { AlertCircle, AlertTriangle, X, CheckCircle } from 'lucide-react'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import SafetyMap from './pages/SafetyMap'
import Cameras from './pages/Cameras'
import Alerts from './pages/Alerts'
import Settings from './pages/Settings'
import { useWebSocket } from './hooks/useWebSocket'
import type { WSMessage, Alert } from './types'
import { cn } from './lib/utils'

// ── Global alert count context ─────────────────────────────────────────────────
interface AlertCtx {
  unacknowledged: number
  setUnacknowledged: React.Dispatch<React.SetStateAction<number>>
}
export const AlertContext = createContext<AlertCtx>({
  unacknowledged: 0,
  setUnacknowledged: () => {},
})
export function useAlertCount() { return useContext(AlertContext) }

// ── Toast system ───────────────────────────────────────────────────────────────
interface Toast {
  id: number
  title: string
  description: string
  severity: 'high' | 'medium' | 'info'
}

interface ToastCtx {
  push: (t: Omit<Toast, 'id'>) => void
}
export const ToastContext = createContext<ToastCtx>({ push: () => {} })
export function useToast() { return useContext(ToastContext) }

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [onDismiss])

  const Icon = toast.severity === 'high'
    ? AlertCircle
    : toast.severity === 'medium'
    ? AlertTriangle
    : CheckCircle

  return (
    <div className={cn(
      'flex items-start gap-3 w-80 rounded-xl shadow-lg border p-4 mb-2',
      'bg-white animate-in slide-in-from-right-4 duration-300',
      toast.severity === 'high'   ? 'border-l-4 border-l-red-500 border-gray-100'
      : toast.severity === 'medium' ? 'border-l-4 border-l-orange-400 border-gray-100'
      :                               'border-l-4 border-l-green-400 border-gray-100'
    )}>
      <Icon
        size={18}
        className={cn('flex-shrink-0 mt-0.5',
          toast.severity === 'high'   ? 'text-red-500'
          : toast.severity === 'medium' ? 'text-orange-400'
          :                               'text-green-500'
        )}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{toast.title}</p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{toast.description}</p>
      </div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-gray-300 hover:text-gray-500 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  )
}

// ── Root app ───────────────────────────────────────────────────────────────────
export default function App() {
  const [toasts, setToasts]                 = useState<Toast[]>([])
  const [unacknowledged, setUnacknowledged] = useState(0)
  const nextId = useRef(1)

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId.current++
    setToasts(prev => [...prev.slice(-3), { ...t, id }]) // max 4 toasts
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // Global WS listener — drives badge + toasts without re-rendering pages
  const handleWS = useCallback((msg: WSMessage) => {
    if (msg.type === 'new_alert') {
      const a = msg.alert as Alert
      pushToast({
        title:       a.title,
        description: a.description,
        severity:    a.severity === 'high' ? 'high' : 'medium',
      })
      setUnacknowledged(n => n + 1)
    }
    if (msg.type === 'stats_update') {
      const wsAlerts = (msg as any).alerts as Alert[] | undefined
      if (Array.isArray(wsAlerts) && wsAlerts.length > 0) {
        wsAlerts.forEach(a => {
          if (a.severity === 'high') {
            pushToast({
              title:       a.title,
              description: a.description,
              severity:    'high',
            })
            setUnacknowledged(n => n + 1)
          }
        })
      }
    }
  }, [pushToast])

  useWebSocket(handleWS)

  return (
    <AlertContext.Provider value={{ unacknowledged, setUnacknowledged }}>
      <ToastContext.Provider value={{ push: pushToast }}>
        <BrowserRouter>
          <div className="flex h-screen overflow-hidden bg-gray-50">
            <Sidebar />
            <main className="flex-1 overflow-hidden">
              <Routes>
                <Route path="/"           element={<Dashboard />} />
                <Route path="/safety-map" element={<SafetyMap />} />
                <Route path="/cameras"    element={<Cameras />} />
                <Route path="/alerts"     element={<Alerts />} />
                <Route path="/settings"   element={<Settings />} />
              </Routes>
            </main>
          </div>

          {/* Toast container — fixed top-right */}
          {toasts.length > 0 && (
            <div className="fixed top-4 right-4 z-[9999] flex flex-col items-end pointer-events-none">
              {toasts.map(t => (
                <div key={t.id} className="pointer-events-auto">
                  <ToastItem
                    toast={t}
                    onDismiss={() => dismissToast(t.id)}
                  />
                </div>
              ))}
            </div>
          )}
        </BrowserRouter>
      </ToastContext.Provider>
    </AlertContext.Provider>
  )
}