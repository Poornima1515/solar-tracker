import { NavLink } from 'react-router-dom'

const nav = [
  { to: '/',            label: 'Dashboard' },
  { to: '/monitoring',  label: 'Live Monitoring' },
  { to: '/control',     label: 'Panel Control' },
  { to: '/ml',          label: 'ML Model' },
  { to: '/comparison',  label: 'Comparison' },
  { to: '/overview',    label: 'System Overview' },
  { to: '/hardware',    label: 'Hardware Status' },
]

export default function Sidebar() {
  return (
    <aside className="hidden md:flex flex-col w-52 bg-white border-r border-neutral-200 min-h-screen pt-4 pb-8 flex-shrink-0">
      <div className="px-4 mb-6">
        <div className="text-xs font-semibold text-neutral-400 uppercase tracking-widest">Navigation</div>
      </div>
      <nav className="flex-1 px-2 space-y-0.5">
        {nav.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `block px-3 py-2 rounded text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-solar-100 text-solar-700'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
