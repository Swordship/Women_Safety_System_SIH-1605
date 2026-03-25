import { useEffect, useRef, useCallback, useState } from 'react'
import type { WSMessage, DashboardStats } from '../types'

// Connect to backend WS on port 8000 (even if frontend is on :5173)
const WS_URL = `ws://${window.location.hostname}:8000/ws`

export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const wsRef         = useRef<WebSocket | null>(null)
  const onMessageRef  = useRef(onMessage)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const [connected, setConnected] = useState(false)

  // Keep ref fresh so the callback inside ws.onmessage always has the latest version
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      console.log('[WS] connected to', WS_URL)
    }

    ws.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data)

        // Backend sends {type:"stats", stats:{...}, alerts:[...]}  (legacy)
        // AND {type:"stats_update", data:{...}, alerts:[...]}      (new)
        // Normalise both into the WSMessage union the frontend expects.
        if (raw.type === 'stats' && raw.stats) {
          onMessageRef.current({
            type: 'stats_update',
            data: raw.stats as DashboardStats,
            ...(raw.alerts ? { alerts: raw.alerts } : {}),
          } as WSMessage)
          return
        }

        onMessageRef.current(raw as WSMessage)
      } catch {
        // ignore unparseable frames
      }
    }

    ws.onclose = () => {
      setConnected(false)
      console.log('[WS] disconnected — retrying in 3s')
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { connected }
}

// ─── Convenience hook: subscribe to live stats only ───────────────────────────
export function useLiveStats(initialStats: DashboardStats | null) {
  const [stats, setStats] = useState<DashboardStats | null>(initialStats)

  const { connected } = useWebSocket((msg) => {
    if (msg.type === 'stats_update') {
      setStats(msg.data)
    }
  })

  return { stats, setStats, connected }
}