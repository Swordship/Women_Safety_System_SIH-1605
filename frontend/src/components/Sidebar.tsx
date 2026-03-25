import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Map,
  Camera,
  Bell,
  Settings,
  Shield,
  LogOut,
} from 'lucide-react'
import { cn } from '../lib/utils'

const NAV_ITEMS = [
  { to: '/',            icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/safety-map',  icon: Map,             label: 'Safety Map' },
  { to: '/cameras',     icon: Camera,          label: 'Cameras'    },
  { to: '/alerts',      icon: Bell,            label: 'Alerts'     },
  { to: '/settings',    icon: Settings,        label: 'Settings'   },
]

export default function Sidebar() {
  return (
    <aside className="w-60 h-screen flex flex-col bg-white border-r border-gray-200 flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-gray-100">
        <div className="w-9 h-9 bg-primary-600 rounded-xl flex items-center justify-center shadow-sm">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold text-lg text-gray-900 tracking-tight">EmpowerHer</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn('w-4.5 h-4.5 flex-shrink-0', isActive ? 'text-white' : 'text-gray-500')} size={18} />
                <span>{label}</span>
                {isActive && (
                  <span className="ml-auto">
                    <svg width="6" height="10" viewBox="0 0 6 10" fill="none">
                      <path d="M1 1l4 4-4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-3 py-4 border-t border-gray-100">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
            m
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">monish</div>
            <div className="text-xs text-gray-500 truncate">monishravi508@gmail.com</div>
          </div>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 mt-1 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-50 w-full transition-colors">
          <LogOut size={16} />
          <span>Log Out</span>
        </button>
      </div>
    </aside>
  )
}
