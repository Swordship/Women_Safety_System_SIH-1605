import { clsx, type ClassValue } from 'clsx'
import type { Severity, AlertStatus } from '../types'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatRelativeTime(isoString: string): string {
  const now = new Date()
  const then = new Date(isoString)
  const diffMs = now.getTime() - then.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
  if (diffHr < 24) return `about ${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`
}

export function severityColor(severity: Severity): string {
  switch (severity) {
    case 'high':   return 'bg-red-100 text-red-700 border border-red-200'
    case 'medium': return 'bg-orange-100 text-orange-700 border border-orange-200'
    case 'low':    return 'bg-blue-100 text-blue-700 border border-blue-200'
    case 'safe':   return 'bg-green-100 text-green-700 border border-green-200'
  }
}

export function severityDot(severity: Severity): string {
  switch (severity) {
    case 'high':   return 'bg-red-500'
    case 'medium': return 'bg-orange-400'
    case 'low':    return 'bg-blue-400'
    case 'safe':   return 'bg-green-500'
  }
}

export function severityBorder(severity: Severity): string {
  switch (severity) {
    case 'high':   return 'border-l-red-500 bg-red-50'
    case 'medium': return 'border-l-orange-400 bg-orange-50'
    case 'low':    return 'border-l-blue-400 bg-blue-50'
    case 'safe':   return 'border-l-green-500 bg-green-50'
  }
}

export function statusColor(status: AlertStatus): string {
  switch (status) {
    case 'new':          return 'bg-primary-600 text-white'
    case 'acknowledged': return 'bg-yellow-100 text-yellow-700 border border-yellow-300'
    case 'resolved':     return 'bg-green-100 text-green-700 border border-green-300'
  }
}

export function formatNumber(n: number): string {
  return n.toLocaleString()
}
