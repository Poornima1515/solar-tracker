import { useEffect, useState, useCallback } from 'react'
import type { SimHistoryPoint } from '../types'
import { simulationService } from '../services/simulationService'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, AreaChart, Area, ReferenceLine,
} from 'recharts'

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch { return '' }
}

interface ChartCardProps {
  title: string
  children: React.ReactNode
  height?: number
}

function ChartCard({ title, children, height = 200 }: ChartCardProps) {
  return (
    <div className="card">
      <p className="section-title">{title}</p>
      <div style={{ height }} className="mt-2">
        {children}
      </div>
    </div>
  )
}

const TICK_STYLE = { fontSize: 10, fill: '#737373' }
const TOOLTIP_STYLE = { fontSize: 11, borderRadius: 4, border: '1px solid #e5e5e5' }

export default function Analytics() {
  const [history, setHistory]       = useState<SimHistoryPoint[]>([])
  const [loading, setLoading]       = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const { history: h } = await simulationService.getHistory(400)
      setHistory(h)
      setLastRefresh(new Date())
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [load])

  // Chart data — add human-readable time
  const chartData = history.map(h => ({
    ...h,
    time: formatTime(h.sim_time),
    power_kw: (h.power_w ?? 0) / 1000,
    tilt_diff: (h.optimal_angle ?? 0) - (h.current_angle ?? 0),
  }))

  // Summaries
  const totalEnergyWh = history.length > 0 ? Math.max(...history.map(h => h.energy_wh ?? 0)) : 0
  const peakPower     = Math.max(...history.map(h => h.power_w ?? 0), 0)
  const avgIrr        = history.length > 0
    ? history.reduce((s, h) => s + (h.irradiance ?? 0), 0) / history.filter(h => (h.irradiance ?? 0) > 0).length
    : 0
  const peakIrr       = Math.max(...history.map(h => h.irradiance ?? 0), 0)

  // Fixed panel estimate (30° static, cosine model)
  const fixedEnergyWh = history.reduce((acc, h, i, arr) => {
    if (i === 0) return acc
    const elev = h.solar_elevation ?? 0
    const irr  = h.irradiance ?? 0
    const cos  = Math.max(0, Math.cos(Math.abs(elev - 30) * Math.PI / 180))
    const dt_h = 1 / 12  // ~5 min intervals assumed
    return acc + irr * 0.0098 * cos * dt_h
  }, 0)
  const trackedEnergyWh = totalEnergyWh
  const improvement = fixedEnergyWh > 0
    ? ((trackedEnergyWh - fixedEnergyWh) / fixedEnergyWh * 100)
    : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-sub">Historical performance — simulation time series</p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-neutral-400">
              Updated {lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button onClick={load} className="btn btn-secondary btn-sm">↺ Refresh</button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Energy Today',  value: totalEnergyWh < 1000 ? `${totalEnergyWh.toFixed(1)} Wh` : `${(totalEnergyWh / 1000).toFixed(2)} kWh`, accent: 'border-t-green-500' },
          { label: 'Peak Power',          value: `${peakPower.toFixed(2)} W`,  accent: 'border-t-amber-400' },
          { label: 'Peak Irradiance',     value: `${peakIrr.toFixed(0)} W/m²`, accent: 'border-t-amber-400' },
          { label: 'Avg Irradiance (day)', value: `${isNaN(avgIrr) ? 0 : avgIrr.toFixed(0)} W/m²`, accent: 'border-t-blue-400' },
        ].map(({ label, value, accent }) => (
          <div key={label} className={`card border-t-2 ${accent}`}>
            <p className="section-title mb-1">{label}</p>
            <p className="text-xl font-mono font-bold text-neutral-800">{value}</p>
            <p className="text-xs text-blue-500 mt-0.5">SIMULATION</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      {loading ? (
        <div className="card h-48 flex items-center justify-center text-neutral-400 text-sm">
          Loading simulation history…
        </div>
      ) : history.length === 0 ? (
        <div className="card h-48 flex items-center justify-center text-neutral-400 text-sm">
          No history yet — simulation is warming up…
        </div>
      ) : (
        <>
          {/* Power output */}
          <ChartCard title="Power Output vs Simulated Time" height={220}>
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="powGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22C55E" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#22C55E" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f0f0f0" strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={TICK_STYLE} interval="preserveStartEnd" />
                <YAxis tick={TICK_STYLE} unit=" W" width={48} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(3)} W`, 'Power']} />
                <Area type="monotone" dataKey="power_w" stroke="#22C55E" fill="url(#powGrad)" dot={false} strokeWidth={2} name="Power (W)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Tilt angles */}
          <ChartCard title="Panel Tilt Angles vs Simulated Time" height={220}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#f0f0f0" strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={TICK_STYLE} interval="preserveStartEnd" />
                <YAxis tick={TICK_STYLE} unit="°" domain={[0, 75]} width={40} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v?.toFixed(1)}°`]} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="current_angle" stroke="#3B82F6" dot={false} strokeWidth={2} name="Current Angle" />
                <Line type="monotone" dataKey="optimal_angle" stroke="#22C55E" dot={false} strokeWidth={1.5} strokeDasharray="4 3" name="Optimal Angle" />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Irradiance & temperature */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Solar Irradiance vs Simulated Time" height={200}>
              <ResponsiveContainer>
                <AreaChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="irrGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#F59E0B" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#f0f0f0" strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={TICK_STYLE} interval="preserveStartEnd" />
                  <YAxis tick={TICK_STYLE} unit=" W/m²" width={54} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v?.toFixed(0)} W/m²`, 'Irradiance']} />
                  <Area type="monotone" dataKey="irradiance" stroke="#F59E0B" fill="url(#irrGrad)" dot={false} strokeWidth={2} name="Irradiance" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Solar Elevation vs Simulated Time" height={200}>
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#f0f0f0" strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={TICK_STYLE} interval="preserveStartEnd" />
                  <YAxis tick={TICK_STYLE} unit="°" domain={[0, 80]} width={36} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v?.toFixed(1)}°`, 'Elevation']} />
                  <ReferenceLine y={0} stroke="#e5e5e5" />
                  <Line type="monotone" dataKey="solar_elevation" stroke="#F97316" dot={false} strokeWidth={2} name="Solar Elevation" />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Cumulative energy */}
          <ChartCard title="Cumulative Energy Today" height={180}>
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="eneGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366F1" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#6366F1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f0f0f0" strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={TICK_STYLE} interval="preserveStartEnd" />
                <YAxis tick={TICK_STYLE} unit=" Wh" width={48} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v?.toFixed(2)} Wh`, 'Energy']} />
                <Area type="monotone" dataKey="energy_wh" stroke="#6366F1" fill="url(#eneGrad)" dot={false} strokeWidth={2} name="Cumulative Energy" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}

      {/* Optimization comparison */}
      <div className="card">
        <p className="section-title">Energy Optimisation — Tracking vs Fixed Panel</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-3">
          <div className="text-center border border-neutral-100 rounded-lg p-4">
            <p className="text-xs text-neutral-500 mb-2">Fixed Panel (30°)</p>
            <p className="text-3xl font-mono font-bold text-neutral-600">
              {fixedEnergyWh.toFixed(2)}
            </p>
            <p className="text-sm text-neutral-400 mt-0.5">Wh today</p>
          </div>
          <div className="text-center border-2 border-green-200 rounded-lg p-4 bg-green-50">
            <p className="text-xs text-green-600 mb-2 font-semibold">With Tilt Tracking</p>
            <p className="text-3xl font-mono font-bold text-green-700">
              {trackedEnergyWh.toFixed(2)}
            </p>
            <p className="text-sm text-green-500 mt-0.5">Wh today</p>
          </div>
          <div className="text-center border border-neutral-100 rounded-lg p-4">
            <p className="text-xs text-neutral-500 mb-2">Improvement</p>
            <p className={`text-3xl font-mono font-bold ${improvement != null && improvement > 0 ? 'text-green-600' : 'text-neutral-500'}`}>
              {improvement != null ? `+${improvement.toFixed(1)}%` : '—'}
            </p>
            <p className="text-sm text-neutral-400 mt-0.5">
              {improvement != null && improvement > 0
                ? `+${(trackedEnergyWh - fixedEnergyWh).toFixed(2)} Wh extra`
                : 'No daytime data yet'}
            </p>
          </div>
        </div>
        <p className="text-xs text-neutral-400 mt-4">
          * Simulated values based on cosine incidence model. Fixed panel assumes permanent 30° south-facing tilt.
        </p>
      </div>
    </div>
  )
}
