import { useState, useCallback, useEffect } from 'react'
import type { SimulationSnapshot, WeatherScenario, DemoScenario } from '../types'
import { simulationService } from '../services/simulationService'

interface Props {
  snapshot: SimulationSnapshot | null
}

const SPEEDS = [
  { label: '1×',   value: 1 },
  { label: '10×',  value: 10 },
  { label: '60×',  value: 60 },
  { label: '300×', value: 300 },
]

const WEATHER_OPTIONS: { id: WeatherScenario; label: string; icon: string; desc: string }[] = [
  { id: 'clear',         label: 'Clear',         icon: '☀',  desc: '90–100% of clear-sky irradiance' },
  { id: 'partly_cloudy', label: 'Partly Cloudy', icon: '⛅', desc: '55–80% with variability' },
  { id: 'cloudy',        label: 'Cloudy',         icon: '☁',  desc: '20–40% of clear-sky' },
  { id: 'rain',          label: 'Rain',           icon: '🌧', desc: '4–15% of clear-sky' },
]

const FAULT_CONFIG = [
  { key: 'motor_fault',  label: 'Motor Fault',         desc: 'Motor controller failure — auto tilt paused',      color: 'border-red-400 bg-red-50' },
  { key: 'sensor_fault', label: 'Sensor Failure',      desc: 'All sensor readings return null / unavailable',    color: 'border-amber-400 bg-amber-50' },
  { key: 'comm_fault',   label: 'Communication Loss',  desc: 'All services report offline — comm timeout sim',   color: 'border-orange-400 bg-orange-50' },
]

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1
        ${checked ? 'bg-red-500 focus:ring-red-300' : 'bg-neutral-200 focus:ring-neutral-300'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

export default function Simulation({ snapshot }: Props) {
  const [scenarios, setScenarios]     = useState<DemoScenario[]>([])
  const [loading, setLoading]         = useState<string | null>(null)
  const [message, setMessage]         = useState<{ text: string; ok: boolean } | null>(null)
  const [tempOverride, setTempOverride]   = useState<string>('')
  const [irrOverride, setIrrOverride]     = useState<string>('')
  const [windSpeed, setWindSpeed]         = useState<string>('')
  const [startHour, setStartHour]         = useState<number>(8)

  const showMsg = (text: string, ok: boolean) => {
    setMessage({ text, ok })
    setTimeout(() => setMessage(null), 4000)
  }

  useEffect(() => {
    simulationService.getScenarios()
      .then(({ scenarios: s }) => setScenarios(s))
      .catch(() => {})
  }, [])

  const setSpeed = useCallback(async (v: number) => {
    setLoading('speed')
    try {
      await simulationService.configure({ speed_multiplier: v })
      showMsg(`Speed set to ${v}×`, true)
    } catch { showMsg('Failed to set speed', false) }
    finally { setLoading(null) }
  }, [])

  const setWeather = useCallback(async (w: WeatherScenario) => {
    setLoading('weather')
    try {
      await simulationService.configure({ weather: w })
      showMsg(`Weather: ${w.replace('_', ' ')}`, true)
    } catch { showMsg('Failed to set weather', false) }
    finally { setLoading(null) }
  }, [])

  const setTime = useCallback(async () => {
    setLoading('time')
    try {
      await simulationService.configure({ sim_start_hour: startHour })
      showMsg(`Simulation time set to ${startHour.toFixed(0).padStart(2, '0')}:00`, true)
    } catch { showMsg('Failed to set time', false) }
    finally { setLoading(null) }
  }, [startHour])

  const toggleFault = useCallback(async (key: string, val: boolean) => {
    setLoading(key)
    try {
      await simulationService.configure({ [key]: val })
      showMsg(`${key.replace('_', ' ')}: ${val ? 'INJECTED' : 'CLEARED'}`, val ? false : true)
    } catch { showMsg('Failed to toggle fault', false) }
    finally { setLoading(null) }
  }, [])

  const applyOverrides = useCallback(async () => {
    setLoading('overrides')
    const cfg: Record<string, unknown> = {}
    if (tempOverride !== '') cfg.temperature_override = parseFloat(tempOverride) || null
    if (irrOverride  !== '') cfg.irradiance_override  = parseFloat(irrOverride) || null
    if (windSpeed    !== '') cfg.wind_speed            = parseFloat(windSpeed) || 3.0
    try {
      await simulationService.configure(cfg)
      showMsg('Overrides applied', true)
    } catch { showMsg('Failed to apply overrides', false) }
    finally { setLoading(null) }
  }, [tempOverride, irrOverride, windSpeed])

  const clearOverrides = useCallback(async () => {
    setLoading('clear')
    try {
      await simulationService.configure({
        temperature_override: null,
        irradiance_override: null,
        wind_speed: 3.0,
      })
      setTempOverride('')
      setIrrOverride('')
      setWindSpeed('')
      showMsg('Overrides cleared', true)
    } catch { showMsg('Failed to clear overrides', false) }
    finally { setLoading(null) }
  }, [])

  const activateScenario = useCallback(async (id: string) => {
    setLoading(id)
    try {
      const { description } = await simulationService.activateScenario(id)
      showMsg(`Scenario: ${description}`, true)
    } catch { showMsg('Failed to activate scenario', false) }
    finally { setLoading(null) }
  }, [])

  const doReset = useCallback(async () => {
    setLoading('reset')
    try {
      await simulationService.reset()
      setTempOverride('')
      setIrrOverride('')
      setWindSpeed('')
      showMsg('Simulation reset to 08:00', true)
    } catch { showMsg('Reset failed', false) }
    finally { setLoading(null) }
  }, [])

  const cfg = snapshot  // use snapshot as config mirror (approximate)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Simulation</h1>
          <p className="page-sub">Control the simulated environment, speed, faults, and scenarios</p>
        </div>
        <button onClick={doReset} disabled={loading === 'reset'} className="btn btn-secondary">
          {loading === 'reset' ? 'Resetting…' : '↺ Reset Simulation'}
        </button>
      </div>

      {/* Status strip */}
      {cfg && (
        <div className="flex flex-wrap gap-3 text-sm">
          {[
            { label: 'Sim Time',    value: new Date(cfg.sim_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) },
            { label: 'Speed',       value: `${cfg.speed_multiplier}×` },
            { label: 'Weather',     value: cfg.weather.replace('_', ' ') },
            { label: 'Mode',        value: cfg.mode.toUpperCase() },
            { label: 'Power',       value: cfg.power_w != null ? `${cfg.power_w.toFixed(2)} W` : '—' },
            { label: 'Tick',        value: `#${cfg.tick_count}` },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-1.5 bg-white border border-neutral-200 rounded px-3 py-1.5 text-xs">
              <span className="text-neutral-400">{label}:</span>
              <span className="font-mono font-semibold text-neutral-800">{value}</span>
            </div>
          ))}
        </div>
      )}

      {message && (
        <div className={`rounded px-4 py-2 text-sm font-medium border ${message.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
          {message.text}
        </div>
      )}

      {/* ── MAIN GRID ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Speed control */}
        <div className="card space-y-4">
          <p className="section-title">Simulation Speed</p>
          <div className="grid grid-cols-4 gap-2">
            {SPEEDS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setSpeed(value)}
                disabled={loading === 'speed'}
                className={`btn text-sm ${cfg?.speed_multiplier === value ? 'btn-primary' : 'btn-secondary'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-neutral-400">
            At 60×, one real second = one simulated minute. At 300×, 5 real seconds = 1 simulated day.
          </p>
        </div>

        {/* Time control */}
        <div className="card space-y-4">
          <p className="section-title">Simulation Time</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>06:00</span>
              <span className="text-neutral-700 font-semibold">
                {startHour.toFixed(0).padStart(2, '0')}:00
                {cfg && ` (current: ${new Date(cfg.sim_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })})`}
              </span>
              <span>22:00</span>
            </div>
            <input
              type="range"
              min={6}
              max={22}
              step={0.5}
              value={startHour}
              onChange={(e) => setStartHour(parseFloat(e.target.value))}
              className="w-full accent-solar-500"
              aria-label="Simulation start hour"
            />
          </div>
          <button onClick={setTime} disabled={loading === 'time'} className="btn btn-primary w-full">
            {loading === 'time' ? 'Applying…' : `Jump to ${startHour.toFixed(0).padStart(2, '0')}:00`}
          </button>
        </div>

        {/* Weather */}
        <div className="card space-y-4">
          <p className="section-title">Weather Scenario</p>
          <div className="grid grid-cols-2 gap-2">
            {WEATHER_OPTIONS.map(({ id, label, icon, desc }) => (
              <button
                key={id}
                onClick={() => setWeather(id)}
                disabled={loading === 'weather'}
                className={`flex flex-col items-start gap-0.5 p-3 rounded border text-left transition-all ${
                  cfg?.weather === id
                    ? 'border-solar-500 bg-solar-50 text-solar-700'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                }`}
              >
                <span className="text-xl">{icon}</span>
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs text-neutral-400">{desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Environment overrides */}
        <div className="card space-y-4">
          <p className="section-title">Environment Overrides</p>
          <div className="space-y-3">
            {[
              { label: 'Temperature (°C)',    value: tempOverride, set: setTempOverride, placeholder: 'e.g. 30', min: -10, max: 60 },
              { label: 'Irradiance (W/m²)',   value: irrOverride,  set: setIrrOverride,  placeholder: 'e.g. 800', min: 0, max: 1400 },
              { label: 'Wind Speed (m/s)',    value: windSpeed,    set: setWindSpeed,    placeholder: 'e.g. 5.0', min: 0, max: 30 },
            ].map(({ label, value, set, placeholder }) => (
              <div key={label} className="flex items-center gap-3">
                <label className="text-xs text-neutral-600 w-40 flex-shrink-0">{label}</label>
                <input
                  type="number"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  placeholder={placeholder}
                  className="input w-28 text-sm"
                  aria-label={label}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={applyOverrides} disabled={loading === 'overrides'} className="btn btn-primary btn-sm">
              {loading === 'overrides' ? 'Applying…' : 'Apply Overrides'}
            </button>
            <button onClick={clearOverrides} disabled={loading === 'clear'} className="btn btn-secondary btn-sm">
              Clear
            </button>
          </div>
          <p className="text-xs text-neutral-400">
            Leave blank to use automatic simulation values. Set to override.
          </p>
        </div>
      </div>

      {/* Fault injection */}
      <div className="card space-y-4">
        <p className="section-title">Fault Injection</p>
        <p className="text-xs text-neutral-500">Toggle simulated faults to test dashboard error handling and alerts.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {FAULT_CONFIG.map(({ key, label, desc, color }) => {
            const active = key === 'motor_fault'  ? (cfg?.active_faults?.includes('Motor Controller Fault') ?? false)
                         : key === 'sensor_fault' ? (cfg?.active_faults?.includes('Sensor Failure') ?? false)
                         : (cfg?.active_faults?.includes('Communication Loss') ?? false)
            return (
              <div key={key} className={`rounded-lg border-2 p-4 space-y-2 transition-all ${active ? color : 'border-neutral-200 bg-white'}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${active ? 'text-red-700' : 'text-neutral-700'}`}>{label}</span>
                  <Toggle checked={active} onChange={(v) => toggleFault(key, v)} disabled={loading === key} />
                </div>
                <p className="text-xs text-neutral-500">{desc}</p>
                {active && (
                  <span className="inline-block px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                    ACTIVE
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Demo scenarios */}
      {scenarios.length > 0 && (
        <div className="card space-y-4">
          <p className="section-title">Demo Scenarios</p>
          <p className="text-xs text-neutral-500">Pre-configured scenarios for stakeholder demonstrations. Activating a scenario resets the simulation.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {scenarios.map(({ id, description }) => (
              <button
                key={id}
                onClick={() => activateScenario(id)}
                disabled={!!loading}
                className="text-left p-3 rounded border border-neutral-200 hover:border-solar-400 hover:bg-solar-50 transition-all group"
              >
                <p className="text-sm font-semibold text-neutral-800 group-hover:text-solar-700 capitalize">
                  {id.replace(/_/g, ' ')}
                </p>
                <p className="text-xs text-neutral-400 mt-0.5">{description}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
