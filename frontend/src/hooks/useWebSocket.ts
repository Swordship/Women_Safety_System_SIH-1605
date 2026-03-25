import { useEffect, useRef, useCallback, useState } from 'react'
import type { WSMessage, DashboardStats } from '../types'

// Always connect to backend on :8000 regardless of frontend port
const WS_URL = `ws://${window.location.hostname}:8000/ws`

export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const wsRef          = useRef<WebSocket | null>(null)
  const onMessageRef   = useRef(onMessage)
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
      console.log('[WS] connected')
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        // main.py sends {type:'stats_update', data: DashboardStats, alerts:[]}
        // We only accept this shaped message — raw video_processor broadcasts
        // are intentionally disabled on the backend to prevent shape mismatch.
        if (msg.type === 'stats_update') {
          onMessageRef.current(msg as WSMessage)
        }
        // new_alert is also supported
        if (msg.type === 'new_alert') {
          onMessageRef.current(msg as WSMessage)
        }
        // Silently drop anything else (legacy 'stats' type etc.)
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

// ── Convenience hook ───────────────────────────────────────────────────────────
export function useLiveStats(initialStats: DashboardStats | null) {
  const [stats, setStats] = useState<DashboardStats | null>(initialStats)

  const { connected } = useWebSocket((msg) => {
    if (msg.type === 'stats_update') {
      setStats(msg.data)
    }
  })

  return { stats, setStats, connected }
}