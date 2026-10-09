import { useEffect, useState, useRef } from 'react'
import type { SimulationSnapshot } from '../types'
import { simulationService } from '../services/simulationService'
import type { SimHistoryPoint } from '../types'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'

interface Props {
  snapshot: SimulationSnapshot | null
}

// Mini sparkline
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const pts = data.map((v, i) => ({ v, i }))
  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={pts} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line type="monotone" dataKey="v" stroke={color} dot={false} strokeWidth={1.5} />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.length ? (
              <span className="text-xs bg-white border border-neutral-200 rounded px-1.5 py-0.5 shadow-sm">
                {typeof payload[0].value === 'number' ? payload[0].value.toFixed(1) : payload[0].value}
              </span>
            ) : null
          }
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function statusBadge(val: number | null | undefined, warn: number, err: number) {
  if (val == null) return { label: 'NO DATA', cls: 'text-neutral-400' }
  if (val >= err) return { label: 'HIGH', cls: 'text-red-600' }
  if (val >= warn) return { label: 'ELEVATED', cls: 'text-amber-600' }
  return { label: 'NORMAL', cls: 'text-green-600' }
}

interface SensorCardProps {
  label: string
  value: string
  unit: string
  status: { label: string; cls: string }
  sparkData: number[]
  sparkColor: string
  lastUpdate?: string
  icon?: string
}

function SensorCard({ label, value, unit, status, sparkData, sparkColor, lastUpdate, icon }: SensorCardProps) {
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide flex items-center gap-1.5">
          {icon && <span>{icon}</span>}
          {label}
        </p>
        <span className={`text-xs font-semibold ${status.cls}`}>● {status.label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-mono font-bold text-neutral-800">{value}</span>
        <span className="text-sm text-neutral-500">{unit}</span>
      </div>
      {sparkData.length > 1 && (
        <Sparkline data={sparkData} color={sparkColor} />
      )}
      {lastUpdate && (
        <p className="text-xs text-neutral-400">{lastUpdate}</p>
      )}
    </div>
  )
}

export default function Sensors({ snapshot }: Props) {
  const [history, setHistory] = useState<SimHistoryPoint[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const { history: h } = await simulationService.getHistory(120)
        setHistory(h)
      } catch { /* silent */ }
    }
    load()
    intervalRef.current = setInterval(load, 5000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  // Extract sparkline arrays
  const irrData  = history.map(h => h.irradiance ?? 0)
  const tempData = history.map(h => h.temperature ?? 0)
  const pwrData  = history.map(h => h.power_w ?? 0)
  const tiltData = history.map(h => h.current_angle ?? 0)

  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  const snap = snapshot

  // Voltage / current / power
  const voltage  = snap?.voltage ?? null
  const current  = snap?.current_a ?? null
  const power    = snap?.power_w ?? null
  const energy   = snap?.energy_today_wh ?? null

  // Panel
  const curAngle = snap?.current_angle ?? null
  const tgtAngle = snap?.target_angle ?? null
  const optAngle = snap?.optimal_angle ?? null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Sensors</h1>
        <p className="page-sub">Real-time sensor readings with trend sparklines</p>
      </div>

      {/* Environmental sensors */}
      <div>
        <h2 className="section-title">Environmental Sensors</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SensorCard
            label="Solar Irradiance"
            value={snap?.irradiance != null ? snap.irradiance.toFixed(0) : '—'}
            unit="W/m²"
            status={statusBadge(snap?.irradiance, 800, 1050)}
            sparkData={irrData}
            sparkColor="#F59E0B"
            lastUpdate={`Last update: ${now}`}
            icon="☀"
          />
          <SensorCard
            label="Temperature"
            value={snap?.temperature != null ? snap.temperature.toFixed(1) : '—'}
            unit="°C"
            status={statusBadge(snap?.temperature, 35, 45)}
            sparkData={tempData}
            sparkColor="#EF4444"
            lastUpdate={`Last update: ${now}`}
            icon="🌡"
          />
          <SensorCard
            label="Humidity"
            value={snap?.humidity != null ? snap.humidity.toFixed(0) : '—'}
            unit="%"
            status={statusBadge(snap?.humidity, 75, 90)}
            sparkData={history.map(h => 65 - ((h.solar_elevation ?? 0) / 90) * 20)}
            sparkColor="#3B82F6"
            lastUpdate={`Last update: ${now}`}
            icon="💧"
          />
          <SensorCard
            label="Wind Speed"
            value={snap?.wind_speed != null ? snap.wind_speed.toFixed(1) : '—'}
            unit="m/s"
            status={statusBadge(snap?.wind_speed, 8, 12)}
            sparkData={history.map(() => (snap?.wind_speed ?? 3) + (Math.random() * 0.4 - 0.2))}
            sparkColor="#8B5CF6"
            lastUpdate={`Last update: ${now}`}
            icon="🌬"
          />
        </div>
      </div>

      {/* Panel sensors */}
      <div>
        <h2 className="section-title">Panel Sensors</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SensorCard
            label="Current Tilt"
            value={curAngle != null ? curAngle.toFixed(1) : '—'}
            unit="°"
            status={{ label: snap?.motor.status === 'moving' ? 'MOVING' : 'STABLE', cls: snap?.motor.status === 'moving' ? 'text-blue-600' : 'text-green-600' }}
            sparkData={tiltData}
            sparkColor="#6366F1"
            lastUpdate={`Target: ${tgtAngle?.toFixed(1) ?? '—'}° | Optimal: ${optAngle?.toFixed(1) ?? '—'}°`}
            icon="◎"
          />
          <SensorCard
            label="Power Output"
            value={power != null ? power.toFixed(3) : '—'}
            unit="W"
            status={{ label: power != null && power > 0 ? 'GENERATING' : 'IDLE', cls: power != null && power > 0 ? 'text-green-600' : 'text-neutral-400' }}
            sparkData={pwrData}
            sparkColor="#22C55E"
            lastUpdate={`Today: ${energy != null ? `${energy.toFixed(1)} Wh` : '—'}`}
            icon="⚡"
          />
          <SensorCard
            label="Panel Voltage"
            value={voltage != null ? voltage.toFixed(2) : '—'}
            unit="V"
            status={statusBadge(voltage, 7.0, 8.0)}
            sparkData={history.map(h => 6.5 + ((h.irradiance ?? 0) / 1020))}
            sparkColor="#F97316"
            lastUpdate={`Last update: ${now}`}
            icon="🔋"
          />
          <SensorCard
            label="Panel Current"
            value={current != null ? current.toFixed(3) : '—'}
            unit="A"
            status={{ label: current != null && current > 0 ? 'NORMAL' : 'NO FLOW', cls: current != null && current > 0 ? 'text-green-600' : 'text-neutral-400' }}
            sparkData={history.map(h => (h.power_w ?? 0) / 7.0)}
            sparkColor="#14B8A6"
            lastUpdate={`Last update: ${now}`}
            icon="⚡"
          />
        </div>
      </div>

      {/* Raw values table */}
      <div className="card">
        <p className="section-title">All Sensor Readings</p>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-th">Sensor</th>
                <th className="table-th">Value</th>
                <th className="table-th">Unit</th>
                <th className="table-th">Status</th>
                <th className="table-th">Source</th>
              </tr>
            </thead>
            <tbody>
              {[
                { sensor: 'Solar Irradiance',    value: snap?.irradiance?.toFixed(1),    unit: 'W/m²',  status: statusBadge(snap?.irradiance, 800, 1050) },
                { sensor: 'Temperature',          value: snap?.temperature?.toFixed(1),   unit: '°C',    status: statusBadge(snap?.temperature, 35, 45) },
                { sensor: 'Humidity',             value: snap?.humidity?.toFixed(0),      unit: '%',     status: statusBadge(snap?.humidity, 75, 90) },
                { sensor: 'Wind Speed',           value: snap?.wind_speed?.toFixed(1),    unit: 'm/s',   status: statusBadge(snap?.wind_speed, 8, 12) },
                { sensor: 'Pressure',             value: snap?.pressure?.toFixed(0),      unit: 'hPa',   status: { label: 'NORMAL', cls: 'text-green-600' } },
                { sensor: 'Panel Voltage',        value: snap?.voltage?.toFixed(2),       unit: 'V',     status: statusBadge(voltage, 7.0, 8.0) },
                { sensor: 'Panel Current',        value: snap?.current_a?.toFixed(3),     unit: 'A',     status: { label: current != null && current > 0 ? 'NORMAL' : 'NO FLOW', cls: current != null && current > 0 ? 'text-green-600' : 'text-neutral-400' } },
                { sensor: 'Power Output',         value: snap?.power_w?.toFixed(3),       unit: 'W',     status: { label: power != null && power > 0 ? 'GENERATING' : 'IDLE', cls: power != null && power > 0 ? 'text-green-600' : 'text-neutral-400' } },
                { sensor: 'Cumulative Energy',    value: snap?.energy_today_wh?.toFixed(2), unit: 'Wh', status: { label: 'ACCUMULATING', cls: 'text-green-600' } },
                { sensor: 'Current Tilt',         value: snap?.current_angle?.toFixed(1), unit: '°',    status: { label: snap?.motor.status === 'moving' ? 'MOVING' : 'STABLE', cls: snap?.motor.status === 'moving' ? 'text-blue-600' : 'text-green-600' } },
                { sensor: 'Solar Elevation',      value: snap?.solar_elevation?.toFixed(1), unit: '°',  status: { label: snap?.is_daytime ? 'DAYTIME' : 'NIGHT', cls: snap?.is_daytime ? 'text-amber-600' : 'text-neutral-400' } },
                { sensor: 'Solar Azimuth',        value: snap?.solar_azimuth?.toFixed(1), unit: '°',    status: { label: 'TRACKING', cls: 'text-blue-600' } },
              ].map(({ sensor, value, unit, status }) => (
                <tr key={sensor} className="hover:bg-neutral-50">
                  <td className="table-td font-medium">{sensor}</td>
                  <td className="table-td">{value ?? '—'}</td>
                  <td className="table-td text-neutral-400">{unit}</td>
                  <td className={`table-td text-xs font-semibold ${status.cls}`}>{status.label}</td>
                  <td className="table-td text-xs text-blue-600 font-medium">SIMULATION</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
