import { useState, useCallback, useEffect } from 'react'
import { telemetryService } from '../services/telemetryService'
import TelemetryChart from '../components/charts/TelemetryChart'
import ErrorMessage from '../components/common/ErrorMessage'
import DataLabel from '../components/common/DataLabel'
import type { TelemetryHistory, DataSource } from '../types'

type Range = '1h' | '6h' | 'today' | 'custom'

const RANGES: { label: string; value: Range }[] = [
  { label: 'Last 1 hour', value: '1h' },
  { label: 'Last 6 hours', value: '6h' },
  { label: 'Today', value: 'today' },
  { label: 'Custom', value: 'custom' },
]

function getRangeDates(range: Range, customFrom: string, customTo: string) {
  const now = new Date()
  if (range === '1h') {
    return {
      from: new Date(now.getTime() - 3_600_000).toISOString(),
      to: now.toISOString(),
    }
  }
  if (range === '6h') {
    return {
      from: new Date(now.getTime() - 6 * 3_600_000).toISOString(),
      to: now.toISOString(),
    }
  }
  if (range === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return { from: start.toISOString(), to: now.toISOString() }
  }
  // custom — return as-is (datetime-local values are local time, not ISO)
  const fromIso = customFrom ? new Date(customFrom).toISOString() : new Date(now.getTime() - 3_600_000).toISOString()
  const toIso = customTo ? new Date(customTo).toISOString() : now.toISOString()
  return { from: fromIso, to: toIso }
}

export default function LiveMonitoring() {
  const [range, setRange] = useState<Range>('6h')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [history, setHistory] = useState<TelemetryHistory | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchHistory = useCallback(async () => {
    if (range === 'custom' && (!customFrom || !customTo)) return
    setLoading(true)
    try {
      const { from, to } = getRangeDates(range, customFrom, customTo)
      const data = await telemetryService.getHistory({ from, to, limit: 1000 })
      setHistory(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [range, customFrom, customTo])

  // Fetch on mount and whenever range changes
  useEffect(() => { fetchHistory() }, [fetchHistory])

  // Auto-refresh every 30 s (not for custom range)
  useEffect(() => {
    if (range === 'custom') return
    const id = setInterval(fetchHistory, 30_000)
    return () => clearInterval(id)
  }, [range, fetchHistory])

  // ── Chart data arrays ──────────────────────────────────────────────────────
  const sensorPoints = (history?.sensor ?? []).map((r) => ({
    timestamp: typeof r.timestamp === 'string' ? r.timestamp : new Date(r.timestamp).toISOString(),
    temperature: r.temperature,
    humidity: r.humidity,
    irradiance: r.irradiance,
  }))

  const electricalPoints = (history?.electrical ?? []).map((r) => ({
    timestamp: typeof r.timestamp === 'string' ? r.timestamp : new Date(r.timestamp).toISOString(),
    voltage: r.voltage,
    current: r.current,
    power: r.power,
  }))

  const anglePoints = (history?.positions ?? []).map((r) => ({
    timestamp: typeof r.timestamp === 'string' ? r.timestamp : new Date(r.timestamp).toISOString(),
    current_angle: r.current_angle,
    target_angle: r.target_angle,
  }))

  const dataSource: DataSource =
    (history?.sensor[0]?.data_source as DataSource) ??
    (history?.electrical[0]?.data_source as DataSource) ??
    'no_data'

  const totalPoints = (history?.sensor?.length ?? 0)
  const hasData = totalPoints > 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Live Monitoring</h1>
          <p className="page-sub">Time-series sensor, electrical, and angle data</p>
        </div>
        {hasData && <DataLabel source={dataSource} />}
      </div>

      {/* Time range selector */}
      <div className="card">
        <div className="section-title">Time Range</div>
        <div className="flex flex-wrap gap-2 mb-2">
          {RANGES.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setRange(value)}
              className={`btn btn-sm ${range === value ? 'btn-primary' : 'btn-secondary'}`}
            >
              {label}
            </button>
          ))}
          <button onClick={fetchHistory} disabled={loading} className="btn btn-secondary btn-sm ml-auto">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {range === 'custom' && (
          <div className="flex flex-wrap gap-3 items-end mt-3">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">From</label>
              <input
                type="datetime-local"
                className="input w-52"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">To</label>
              <input
                type="datetime-local"
                className="input w-52"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
            <button onClick={fetchHistory} className="btn btn-primary btn-sm">Apply</button>
          </div>
        )}

        {history && (
          <p className="text-xs text-neutral-400 mt-2">
            {history.total_records} records loaded
            {dataSource === 'demo' && ' — demo data (hardware offline)'}
          </p>
        )}
      </div>

      {error && <ErrorMessage message={error} onRetry={fetchHistory} />}

      {/* ── Charts ── */}
      <TelemetryChart
        title="Irradiance & Temperature"
        data={sensorPoints}
        loading={loading}
        series={[
          { key: 'irradiance',  label: 'Irradiance',  unit: 'W/m²', color: '#f59e0b' },
          { key: 'temperature', label: 'Temperature', unit: '°C',   color: '#ef4444' },
        ]}
      />

      <TelemetryChart
        title="Humidity"
        data={sensorPoints}
        loading={loading}
        height={180}
        series={[
          { key: 'humidity', label: 'Humidity', unit: '%', color: '#3b82f6' },
        ]}
      />

      <TelemetryChart
        title="Electrical Output — Power, Voltage, Current"
        data={electricalPoints}
        loading={loading}
        series={[
          { key: 'power',   label: 'Power',   unit: 'W', color: '#5fb229' },
          { key: 'voltage', label: 'Voltage', unit: 'V', color: '#8b5cf6' },
          { key: 'current', label: 'Current', unit: 'A', color: '#06b6d4' },
        ]}
      />

      <TelemetryChart
        title="Panel Angle — Current vs Target"
        data={anglePoints}
        loading={loading}
        height={180}
        series={[
          { key: 'current_angle', label: 'Current Angle', unit: '°', color: '#5fb229' },
          { key: 'target_angle',  label: 'Target Angle',  unit: '°', color: '#f59e0b' },
        ]}
      />

      {/* Raw data table */}
      {!loading && hasData && (
        <div className="card overflow-x-auto">
          <div className="section-title">Recent Sensor Readings (last 20)</div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['Timestamp', 'Temp °C', 'Humidity %', 'Pressure hPa', 'Irradiance W/m²', 'LDR Left', 'LDR Right', 'Source'].map((h) => (
                  <th key={h} className="table-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...(history?.sensor ?? [])].reverse().slice(0, 20).map((r, i) => (
                <tr key={r.id ?? i} className="hover:bg-neutral-50">
                  <td className="table-td text-xs">
                    {new Date(r.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td className="table-td">{r.temperature?.toFixed(1) ?? '—'}</td>
                  <td className="table-td">{r.humidity?.toFixed(1) ?? '—'}</td>
                  <td className="table-td">{r.pressure?.toFixed(1) ?? '—'}</td>
                  <td className="table-td">{r.irradiance?.toFixed(1) ?? '—'}</td>
                  <td className="table-td">{r.ldr_left ?? '—'}</td>
                  <td className="table-td">{r.ldr_right ?? '—'}</td>
                  <td className="table-td">
                    <DataLabel source={r.data_source} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
