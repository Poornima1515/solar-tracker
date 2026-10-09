import { useState } from 'react'
import type { EventSeverity, SystemEvent } from '../types'
import { useEvents } from '../hooks/useEvents'

const SEV_CONFIG: Record<EventSeverity, { dot: string; badge: string; text: string; rowBg: string }> = {
  info:     { dot: 'bg-blue-400',    badge: 'bg-blue-50 border-blue-200 text-blue-700',     text: 'text-blue-700',    rowBg: '' },
  warning:  { dot: 'bg-amber-400',   badge: 'bg-amber-50 border-amber-200 text-amber-700',  text: 'text-amber-700',   rowBg: 'bg-amber-50/40' },
  error:    { dot: 'bg-red-400',     badge: 'bg-red-50 border-red-200 text-red-700',        text: 'text-red-700',     rowBg: 'bg-red-50/40' },
  critical: { dot: 'bg-red-600',     badge: 'bg-red-100 border-red-300 text-red-800',       text: 'text-red-800',     rowBg: 'bg-red-100/50' },
}

const CAT_ICON: Record<string, string> = {
  motor: '⚙', tilt: '◎', sensor: '◉', service: '◆', system: '⊙',
}

const FILTERS: { id: EventSeverity | 'all'; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'info',     label: 'Info' },
  { id: 'warning',  label: 'Warning' },
  { id: 'error',    label: 'Error' },
  { id: 'critical', label: 'Critical' },
]

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  } catch { return iso }
}

function EventRow({ event }: { event: SystemEvent }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = SEV_CONFIG[event.severity] ?? SEV_CONFIG['info']
  const icon = CAT_ICON[event.category] ?? '◦'

  return (
    <div
      className={`border-b border-neutral-100 last:border-0 ${cfg.rowBg} cursor-pointer hover:bg-neutral-50 transition-colors`}
      onClick={() => setExpanded(!expanded)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') setExpanded(!expanded) }}
      aria-expanded={expanded}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Severity dot */}
        <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${cfg.dot}`} />

        {/* Time */}
        <span className="text-xs font-mono text-neutral-400 flex-shrink-0 mt-0.5 w-20">
          {formatTime(event.timestamp)}
        </span>

        {/* Category */}
        <span className="text-xs text-neutral-400 flex-shrink-0 w-12 mt-0.5">{icon} {event.category}</span>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${cfg.text}`}>{event.title}</p>
          {expanded && (
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{event.detail}</p>
          )}
        </div>

        {/* Badge */}
        <span className={`flex-shrink-0 px-1.5 py-0.5 rounded border text-xs font-semibold uppercase ${cfg.badge}`}>
          {event.severity}
        </span>
      </div>
    </div>
  )
}

export default function Events() {
  const { events, connected } = useEvents()
  const [filter, setFilter] = useState<EventSeverity | 'all'>('all')
  const [search, setSearch] = useState('')

  const filtered = events.filter((e) => {
    if (filter !== 'all' && e.severity !== filter) return false
    if (search && !e.title.toLowerCase().includes(search.toLowerCase()) &&
        !e.detail.toLowerCase().includes(search.toLowerCase()) &&
        !e.category.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Counts per severity
  const counts = events.reduce((acc, e) => {
    acc[e.severity] = (acc[e.severity] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Events & Alerts</h1>
          <p className="page-sub">Real-time system event log — {events.length} events captured</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 text-xs ${connected ? 'text-green-600' : 'text-neutral-400'}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-neutral-300'}`} />
            {connected ? 'Live stream' : 'Polling'}
          </span>
        </div>
      </div>

      {/* Severity summary */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(({ id, label }) => {
          const count = id === 'all' ? events.length : (counts[id] ?? 0)
          const cfg = id !== 'all' ? SEV_CONFIG[id as EventSeverity] : null
          return (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                filter === id
                  ? id === 'all' ? 'bg-neutral-800 text-white border-neutral-800'
                    : `${cfg!.badge} border-2`
                  : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
              }`}
            >
              {cfg && <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />}
              {label} {count > 0 && <span className="opacity-70">({count})</span>}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search events…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input max-w-sm"
        aria-label="Search events"
      />

      {/* Event list */}
      <div className="card p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-neutral-400 text-sm">
            {events.length === 0
              ? 'Waiting for events — simulation is starting up…'
              : 'No events match the current filter.'}
          </div>
        ) : (
          <div className="divide-y-0">
            {/* Table header */}
            <div className="flex items-center gap-3 px-4 py-2 bg-neutral-50 border-b border-neutral-200">
              <span className="w-2 flex-shrink-0" />
              <span className="text-xs font-semibold text-neutral-500 w-20">Time</span>
              <span className="text-xs font-semibold text-neutral-500 w-12">Category</span>
              <span className="text-xs font-semibold text-neutral-500 flex-1">Event</span>
              <span className="text-xs font-semibold text-neutral-500">Severity</span>
            </div>
            {filtered.map((ev) => (
              <EventRow key={ev.id} event={ev} />
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-neutral-500">
        {Object.entries(SEV_CONFIG).map(([sev, cfg]) => (
          <span key={sev} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
            <span className="font-medium capitalize">{sev}</span>
          </span>
        ))}
        <span className="text-neutral-400">Click any row to expand details</span>
      </div>
    </div>
  )
}
