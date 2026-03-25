import { useEffect, useRef, useCallback, useState } from 'react'
import type { WSMessage, DashboardStats } from '../types'

const WS_URL = `ws://${window.location.hostname}:8000/ws`

export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()
  const [connected, setConnected] = useState(false)

  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }

    ws.onmessage = (e) => {
      try {
        const msg: WSMessage = JSON.parse(e.data)
        onMessageRef.current(msg)
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      setConnected(false)
      // Reconnect after 3s
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

// ─── Global stats hook with WebSocket ────────────────────────────────────────
export function useLiveStats(initialStats: DashboardStats | null) {
  const [stats, setStats] = useState<DashboardStats | null>(initialStats)

  const { connected } = useWebSocket((msg) => {
    if (msg.type === 'stats_update') {
      setStats(msg.data)
    }
  })

  return { stats, setStats, connected }
}
