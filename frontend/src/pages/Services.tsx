import { useEffect, useState, useCallback } from 'react'
import type { ServiceDescriptor, ServiceStatus, ServiceType, SimulationSnapshot } from '../types'
import { servicesRegistry } from '../services/servicesRegistry'

interface Props {
  snapshot: SimulationSnapshot | null
}

const STATUS_CONFIG: Record<ServiceStatus, { dot: string; text: string; badge: string }> = {
  online:     { dot: 'bg-green-500',              text: 'text-green-700',  badge: 'bg-green-50 border-green-200' },
  simulation: { dot: 'bg-blue-400',               text: 'text-blue-700',   badge: 'bg-blue-50 border-blue-200' },
  offline:    { dot: 'bg-neutral-400',             text: 'text-neutral-500',badge: 'bg-neutral-50 border-neutral-200' },
  degraded:   { dot: 'bg-amber-400',              text: 'text-amber-700',  badge: 'bg-amber-50 border-amber-200' },
  fault:      { dot: 'bg-red-500',                text: 'text-red-700',    badge: 'bg-red-50 border-red-200' },
  starting:   { dot: 'bg-amber-300 animate-pulse', text: 'text-amber-600',  badge: 'bg-amber-50 border-amber-100' },
}

const TYPE_ICON: Record<ServiceType, string> = {
  sensor:     '◉',
  controller: '◎',
  analytics:  '◈',
  ml:         '◆',
  hardware:   '◇',
  simulation: '⊙',
}

const TYPE_COLOR: Record<ServiceType, string> = {
  sensor:     'text-green-600 bg-green-50',
  controller: 'text-blue-600 bg-blue-50',
  analytics:  'text-purple-600 bg-purple-50',
  ml:         'text-indigo-600 bg-indigo-50',
  hardware:   'text-amber-600 bg-amber-50',
  simulation: 'text-orange-600 bg-orange-50',
}

function ServiceCard({ svc }: { svc: ServiceDescriptor }) {
  const s = STATUS_CONFIG[svc.status] ?? STATUS_CONFIG['offline']
  const t = TYPE_COLOR[svc.service_type] ?? 'text-neutral-600 bg-neutral-50'
  const icon = TYPE_ICON[svc.service_type] ?? '◦'

  return (
    <div className="card hover:border-neutral-300 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${t}`}>
            {icon}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-neutral-800 truncate">{svc.service_name}</h3>
            <p className="text-xs text-neutral-400">{svc.service_id}</p>
          </div>
        </div>
        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold flex-shrink-0 ${s.badge} ${s.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
          {svc.status.toUpperCase()}
        </span>
      </div>

      <p className="text-xs text-neutral-500 mb-3 leading-relaxed">{svc.description}</p>

      {svc.capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {svc.capabilities.map((cap) => (
            <span key={cap} className="px-1.5 py-0.5 bg-neutral-100 text-neutral-600 rounded text-xs">
              {cap.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-neutral-400 border-t border-neutral-100 pt-2 mt-1">
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${t}`}>
          {svc.service_type}
        </span>
        {svc.version && <span>v{svc.version}</span>}
        {svc.last_seen && (
          <span>
            {new Date(svc.last_seen).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  )
}

export default function Services({ snapshot }: Props) {
  const [services, setServices] = useState<ServiceDescriptor[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const { services: svcs } = await servicesRegistry.list()
      setServices(svcs)
      setLastFetch(new Date())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load services')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  // Health summary
  const counts = services.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const hasFaults = snapshot?.active_faults?.length ?? 0 > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Services</h1>
          <p className="page-sub">Service registry — all registered microservices</p>
        </div>
        <div className="flex items-center gap-2">
          {lastFetch && (
            <span className="text-xs text-neutral-400">
              {lastFetch.toLocaleTimeString()}
            </span>
          )}
          <button onClick={load} className="btn btn-secondary btn-sm">↺ Refresh</button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(counts).map(([status, count]) => {
          const cfg = STATUS_CONFIG[status as ServiceStatus] ?? STATUS_CONFIG['offline']
          return (
            <span key={status} className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${cfg.badge} ${cfg.text}`}>
              <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
              {count} {status.toUpperCase()}
            </span>
          )
        })}
        <span className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-500">
          {services.length} total services registered
        </span>
      </div>

      {/* Fault warning */}
      {hasFaults && snapshot && (
        <div className="bg-red-50 border border-red-200 rounded px-4 py-3 text-sm text-red-700">
          <span className="font-semibold">⚠ Active faults affecting services: </span>
          {snapshot.active_faults.join(' · ')}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded px-4 py-3 text-sm text-red-700">
          Error loading services: {error}
        </div>
      )}

      {/* Service cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card animate-pulse space-y-3">
              <div className="h-5 bg-neutral-200 rounded w-3/4" />
              <div className="h-3 bg-neutral-100 rounded w-full" />
              <div className="h-3 bg-neutral-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((svc) => (
            <ServiceCard key={svc.service_id} svc={svc} />
          ))}
        </div>
      )}

      {/* Architecture note */}
      <div className="card bg-blue-50 border-blue-100">
        <p className="text-xs text-blue-700 leading-relaxed">
          <span className="font-semibold">Hardware-ready architecture:</span> This service registry is configuration-driven.
          New microservices (real sensors, hardware adapters, additional controllers) can register via{' '}
          <code className="bg-blue-100 px-1 rounded">POST /api/services/register</code> and will automatically appear
          in this dashboard without frontend code changes.
        </p>
      </div>
    </div>
  )
}
