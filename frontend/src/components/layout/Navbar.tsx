import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import StatusIndicator from '../common/StatusIndicator'
import DataLabel from '../common/DataLabel'
import type { DeviceStatusSummary } from '../../types'
import { fmt } from '../../utils/formatters'

interface Props {
  deviceStatus: DeviceStatusSummary | null
}

const nav = [
  { to: '/',            label: 'Dashboard' },
  { to: '/monitoring',  label: 'Monitoring' },
  { to: '/control',     label: 'Control' },
  { to: '/ml',          label: 'ML Model' },
  { to: '/comparison',  label: 'Comparison' },
  { to: '/cost',        label: 'Cost Analysis' },
  { to: '/overview',    label: 'System Overview' },
  { to: '/algorithms',  label: 'Algorithms' },
  { to: '/hardware',    label: 'Hardware' },
]

export default function Navbar({ deviceStatus }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const online = deviceStatus?.status === 'online'
  const isDemo = deviceStatus?.demo_mode ?? true

  return (
    <header className="bg-white border-b border-neutral-200 sticky top-0 z-30">
      <div className="flex items-center justify-between px-4 h-12">
        {/* Brand */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 w-7 h-7 rounded bg-solar-500 flex items-center justify-center">
            <span className="text-white text-xs font-bold">ST</span>
          </div>
          <div className="min-w-0">
            <span className="text-sm font-semibold text-neutral-800 truncate block">Solar Tracker</span>
            <span className="text-xs text-neutral-400 hidden sm:block">Tilt Optimisation System</span>
          </div>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-solar-100 text-solar-700'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Status strip */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2">
            <StatusIndicator
              status={online ? 'online' : 'offline'}
              label={online ? 'Hardware Online' : 'Hardware Offline'}
              size="sm"
            />
            <DataLabel source={isDemo ? 'demo' : 'live'} />
          </div>
          {deviceStatus?.last_seen && (
            <span className="hidden lg:block text-xs text-neutral-400">
              {fmt.secsAgo(deviceStatus.seconds_since_seen)}
            </span>
          )}
          {/* Mobile menu toggle */}
          <button
            className="md:hidden p-1 rounded text-neutral-500 hover:bg-neutral-100"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden border-t border-neutral-100 bg-white py-2 px-4 space-y-1">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `block px-3 py-2 rounded text-sm font-medium ${
                  isActive ? 'bg-solar-100 text-solar-700' : 'text-neutral-600 hover:bg-neutral-100'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </header>
  )
}
