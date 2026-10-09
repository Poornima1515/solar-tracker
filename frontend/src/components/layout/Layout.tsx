import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { SimulationSnapshot } from '../../types'

interface Props {
  children: React.ReactNode
  snapshot: SimulationSnapshot | null
  wsConnected: boolean
}

const NAV = [
  { to: '/',             label: 'Overview',      icon: '⊙' },
  { to: '/live-control', label: 'Live Control',  icon: '◎' },
  { to: '/analytics',    label: 'Analytics',     icon: '◈' },
  { to: '/sensors',      label: 'Sensors',       icon: '◉' },
  { to: '/services',     label: 'Services',      icon: '◆' },
  { to: '/events',       label: 'Events',        icon: '◪' },
  { to: '/simulation',   label: 'Simulation',    icon: '◫' },
  { to: '/settings',     label: 'Settings',      icon: '⚙' },
]

function StatusBadge({ isSim, hwConnected }: { isSim: boolean; hwConnected: boolean }) {
  if (isSim) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        SIMULATION
      </span>
    )
  }
  if (hwConnected) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold border border-emerald-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        REAL HARDWARE
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs font-semibold border border-red-200">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
      HARDWARE OFFLINE
    </span>
  )
}

export default function Layout({ children, snapshot, wsConnected }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isSim = snapshot ? snapshot.sim_mode : true
  const hwConnected = snapshot ? snapshot.hardware_connected : false
  const hasFaults = (snapshot?.active_faults?.length ?? 0) > 0

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      {/* Dynamic Mode banner */}
      <div
        className={`border-b px-4 py-1.5 flex items-center justify-between text-xs ${
          isSim
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : hwConnected
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}
      >
        <div className="flex items-center gap-2">
          {isSim ? (
            <>
              <span className="font-semibold">⚡ SIMULATION MODE ACTIVE</span>
              <span className="text-amber-600 hidden sm:inline">
                — Demonstrating 2D Sun, P&O tracking, and limit safety.
              </span>
            </>
          ) : hwConnected ? (
            <>
              <span className="font-semibold">🟢 REAL HARDWARE CONNECTED</span>
              <span className="text-emerald-700 hidden sm:inline">
                — Live ESP32-S3 telemetry & INA219 sensor active.
              </span>
            </>
          ) : (
            <>
              <span className="font-semibold">🔴 CONTROLLER DISCONNECTED</span>
              <span className="text-red-700 hidden sm:inline">
                — Real hardware mode active. Waiting for ESP32-S3. No fake data displayed.
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasFaults && (
            <span className="flex items-center gap-1 text-red-600 font-semibold">
              <span>⚠</span>
              <span>
                {snapshot!.active_faults.length} fault{snapshot!.active_faults.length > 1 ? 's' : ''} active
              </span>
            </span>
          )}
          <span
            className={`flex items-center gap-1 ${
              wsConnected ? 'text-green-600' : 'text-neutral-400'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                wsConnected ? 'bg-green-500 animate-pulse' : 'bg-neutral-300'
              }`}
            />
            {wsConnected ? 'Live' : 'Polling'}
          </span>
        </div>
      </div>

      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-30 h-12 flex items-center px-4 gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-solar-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-800 leading-none">Solar Control</p>
            <p className="text-xs text-neutral-400 leading-none mt-0.5 hidden sm:block">Tilt Optimisation System</p>
          </div>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5 flex-1">
          {NAV.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  isActive ? 'bg-solar-100 text-solar-700' : 'text-neutral-600 hover:bg-neutral-100'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Right strip */}
        <div className="flex items-center gap-3 ml-auto">
          {snapshot && (
            <>
              <div className="hidden sm:flex items-center gap-2 text-xs text-neutral-500">
                <span className="font-mono">
                  {snapshot.current_angle.toFixed(1)}°
                </span>
                <span className="text-neutral-300">|</span>
                <span className={snapshot.power_w != null && snapshot.power_w > 0 ? 'text-green-600 font-semibold' : 'text-neutral-400'}>
                  {snapshot.power_w != null ? `${snapshot.power_w.toFixed(2)} W` : '—'}
                </span>
              </div>
              <StatusBadge isSim={isSim} hwConnected={hwConnected} />
            </>
          )}
          {/* Mobile hamburger */}
          <button
            className="md:hidden p-1 rounded text-neutral-500 hover:bg-neutral-100"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>
      </header>

      {/* Mobile nav dropdown */}
      {menuOpen && (
        <div className="md:hidden bg-white border-b border-neutral-200 py-2 px-4 space-y-1">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded text-sm font-medium ${
                  isActive ? 'bg-solar-100 text-solar-700' : 'text-neutral-600 hover:bg-neutral-100'
                }`
              }
            >
              <span>{icon}</span> {label}
            </NavLink>
          ))}
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 p-4 md:p-6 max-w-screen-xl mx-auto w-full">
        {children}
      </main>
    </div>
  )
}
