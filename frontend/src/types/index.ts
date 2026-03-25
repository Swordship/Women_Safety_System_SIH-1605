export type Severity = 'high' | 'medium' | 'low' | 'safe'
export type AlertStatus = 'new' | 'acknowledged' | 'resolved'
export type AlertType =
  | 'sos_gesture'
  | 'surrounded_high'
  | 'surrounded_medium'
  | 'lone_woman'
  | 'nighttime'
  | 'safe'

export interface Camera {
  id: string
  name: string
  location: string
  rtsp_url: string
  latitude: number
  longitude: number
  model_desc: string
  status: boolean
  last_active?: string
  created_at: string
  alert_count: number
}

export interface CameraCreate {
  name: string
  location: string
  rtsp_url: string
  latitude: number
  longitude: number
  model_desc: string
  status: boolean
}

export interface Alert {
  id: string
  title: string
  description: string
  camera_id: string
  camera_name: string
  location: string
  severity: Severity
  alert_type: AlertType
  status: AlertStatus
  timestamp: string
  latitude?: number
  longitude?: number
}

export interface SafetyMetrics {
  lone_women: number
  surrounded: number
  sos_gestures: number
  safe_interactions: number
  total_women: number
}

export interface DashboardStats {
  women_monitored: number
  men_detected: number
  alerts_today: number
  hotspot_areas: number
  safety_metrics: SafetyMetrics
}

export interface Hotspot {
  camera_id: string
  camera_name: string
  location: string
  latitude: number
  longitude: number
  total_alerts: number
  high_count: number
  medium_count: number
  low_count: number
}

// WebSocket message types
export type WSMessage =
  | { type: 'stats_update'; data: DashboardStats }
  | { type: 'new_alert'; alert: Alert }
  | { type: 'detection_update'; camera_id: string; severity: Severity; frame_women: number; frame_men: number }
