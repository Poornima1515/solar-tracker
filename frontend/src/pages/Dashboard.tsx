import { useTelemetry } from '../hooks/useTelemetry'
import MetricCard from '../components/panels/MetricCard'
import DataLabel from '../components/common/DataLabel'
import StatusIndicator from '../components/common/StatusIndicator'
import ErrorMessage from '../components/common/ErrorMessage'
import { fmt } from '../utils/formatters'

export default function Dashboard() {
  const { telemetry, deviceStatus, dailySummary, loading, error, refresh } = useTelemetry(10000)

  if (error) return <ErrorMessage message={error} onRetry={refresh} />

  const t = telemetry
  const online = deviceStatus?.status === 'online'

  const trackingStatus = () => {
    if (!t) return 'Unknown'
    if (!t.hardware_online) return 'Hardware Offline'
    if (t.mode === 'auto') {
      const diff = Math.abs((t.target_angle ?? 0) - (t.current_angle ?? 0))
      return diff > 0.5 ? 'Adjusting' : 'Tracking'
    }
    if (t.mode === 'manual') return 'Manual Mode'
    return 'Stopped'
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Real-time system overview</p>
        </div>
        <div className="flex items-center gap-3">
          {t && <DataLabel source={t.data_source} />}
          <StatusIndicator
            status={online ? 'online' : 'offline'}
            label={online ? 'ESP32 Online' : 'ESP32 Offline'}
          />
        </div>
      </div>

      {/* Skeleton while loading */}
      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card animate-pulse h-20 bg-neutral-100" />
          ))}
        </div>
      )}

      {!loading && t && (
        <>
          {/* Panel angle + tracking status row */}
          <div className="card flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="section-title mb-2">Panel Position</div>
              <div className="flex items-end gap-6">
                <div>
                  <div className="text-xs text-neutral-500 mb-0.5">Current Angle</div>
                  <div className="text-3xl font-semibold font-mono text-neutral-800">
                    {fmt.angle(t.current_angle)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500 mb-0.5">Target Angle</div>
                  <div className="text-3xl font-semibold font-mono text-solar-600">
                    {fmt.angle(t.target_angle)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500 mb-0.5">Mode</div>
                  <div className={`text-sm font-medium capitalize px-2 py-0.5 rounded-full border ${
                    t.mode === 'auto'
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : 'bg-neutral-100 text-neutral-600 border-neutral-200'
                  }`}>
                    {t.mode ?? '—'}
                  </div>
                </div>
              </div>
            </div>
            <div className="border-l border-neutral-100 pl-4 hidden sm:block">
              <div className="text-xs text-neutral-500 mb-0.5">Tracking Status</div>
              <div className="text-base font-medium text-neutral-700">{trackingStatus()}</div>
              {t.timestamp && (
                <div className="text-xs text-neutral-400 mt-1">
                  Updated {fmt.ts(t.timestamp)}
                </div>
              )}
            </div>
          </div>

          {/* Environmental metrics */}
          <div>
            <div className="section-title">Environmental Sensors — BME280</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard label="Temperature"  value={fmt.temp(t.temperature)}         sub="BME280" />
              <MetricCard label="Humidity"     value={fmt.humidity(t.humidity)}         sub="BME280" />
              <MetricCard label="Pressure"     value={fmt.pressure(t.pressure)}         sub="BME280" />
              <MetricCard
                label="Irradiance"
                value={t.irradiance != null ? `${t.irradiance.toFixed(1)}` : '—'}
                unit="W/m²"
                sub={t.irradiance_source ? `Source: ${t.irradiance_source}` : undefined}
              />
            </div>
          </div>

          {/* Electrical metrics */}
          <div>
            <div className="section-title">Electrical Output — INA219</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard label="Voltage"       value={fmt.voltage(t.voltage)}        sub="Bus voltage" />
              <MetricCard label="Current"       value={fmt.current(t.current)}        sub="Shunt current" />
              <MetricCard label="Power"         value={fmt.power(t.power)}            sub="Calculated" />
              <MetricCard label="Energy Today"  value={fmt.energy(t.energy_today)}    sub="Cumulative Wh" />
            </div>
          </div>

          {/* LDR */}
          <div>
            <div className="section-title">Light Sensors — LDR (raw ADC, 0–4095)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard label="LDR Left"  value={t.ldr_left != null  ? String(t.ldr_left)  : '—'} sub="GPIO 4" />
              <MetricCard label="LDR Right" value={t.ldr_right != null ? String(t.ldr_right) : '—'} sub="GPIO 5" />
              <MetricCard
                label="LDR Balance"
                value={
                  t.ldr_left != null && t.ldr_right != null
                    ? `${((t.ldr_left - t.ldr_right) / 40.95).toFixed(1)}`
                    : '—'
                }
                unit="%"
                sub="Left − Right"
              />
            </div>
          </div>

          {/* Daily summary */}
          {dailySummary && (
            <div>
              <div className="section-title">Today's Summary — {dailySummary.date}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Peak Power"       value={fmt.power(dailySummary.peak_power_w)}     sub="Today" />
                <MetricCard label="Avg Power"        value={fmt.power(dailySummary.avg_power_w)}      sub="Today" />
                <MetricCard label="Total Energy"     value={fmt.energy(dailySummary.total_energy_wh)} sub="Today" />
                <MetricCard label="Panel Movements"  value={String(dailySummary.num_movements)}       sub="Today" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
