import { useState, useCallback } from 'react'
import type { SimulationSnapshot } from '../types'
import FaultBanner from '../components/common/FaultBanner'
import { simulationService } from '../services/simulationService'
import { controlService } from '../services/controlService'

interface Props {
  snapshot: SimulationSnapshot | null
}

function MotorStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; dot: string }> = {
    idle:    { bg: 'bg-neutral-100', text: 'text-neutral-600', dot: 'bg-neutral-400' },
    moving:  { bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500 animate-pulse' },
    fault:   { bg: 'bg-red-50',      text: 'text-red-700',     dot: 'bg-red-500' },
    stopped: { bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-400' },
  }
  const s = map[status] ?? map['idle']
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-2 h-2 rounded-full ${s.dot}`} />
      {status.toUpperCase()}
    </span>
  )
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full bg-neutral-200 rounded-full h-2">
      <div
        className={`h-2 rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  )
}

export default function LiveControl({ snapshot }: Props) {
  const [manualAngle, setManualAngle] = useState(35)
  const [loading, setLoading]         = useState<string | null>(null)
  const [message, setMessage]         = useState<{ text: string; ok: boolean } | null>(null)
  const [showEStop, setShowEStop]     = useState(false)
  const [stopped, setStopped]         = useState(false)

  const showMsg = (text: string, ok: boolean) => {
    setMessage({ text, ok })
    setTimeout(() => setMessage(null), 4000)
  }

  const applyMode = useCallback(async (mode: 'auto' | 'manual') => {
    setLoading('mode')
    try {
      await simulationService.setMode(mode)
      showMsg(`Mode changed to ${mode.toUpperCase()}`, true)
    } catch { showMsg('Failed to change mode', false) }
    finally { setLoading(null) }
  }, [])

  const applyTilt = useCallback(async () => {
    setLoading('tilt')
    try {
      await simulationService.setMode('manual')
      await simulationService.tilt(manualAngle)
      showMsg(`Panel moving to ${manualAngle}°`, true)
    } catch { showMsg('Failed to send tilt command', false) }
    finally { setLoading(null) }
  }, [manualAngle])

  const handleJog = useCallback(async (direction: 'up' | 'down') => {
    setLoading(`jog-${direction}`)
    try {
      const res = await controlService.jog(direction, 5)
      if (res.success) {
        showMsg(`Jogged ${direction.toUpperCase()} (+5°) to ${res.current_angle?.toFixed(1)}°`, true)
      } else {
        showMsg(`Jog stopped: ${res.status}`, false)
      }
    } catch {
      showMsg('Failed to send jog command', false)
    } finally {
      setLoading(null)
    }
  }, [])

  const doEmergencyStop = useCallback(async () => {
    setLoading('estop')
    try {
      await simulationService.setMode('stopped')
      setStopped(true)
      setShowEStop(false)
      showMsg('Emergency stop activated. All movement halted.', false)
    } catch { showMsg('Emergency stop failed', false) }
    finally { setLoading(null) }
  }, [])

  const doRecover = useCallback(async () => {
    setLoading('recover')
    try {
      await simulationService.setMode('auto')
      setStopped(false)
      showMsg('System recovered. Auto tracking resumed.', true)
    } catch { showMsg('Recovery failed', false) }
    finally { setLoading(null) }
  }, [])

  const snap = snapshot

  // Explain WHY the panel is moving
  function getDecisionText(): string {
    if (!snap) return 'Waiting for data…'
    if (snap.mode === 'stopped') return 'SYSTEM STOPPED — Emergency stop is active. Manual recovery required.'
    if (snap.motor.fault_message) return `Motor fault: ${snap.motor.fault_message}`
    if (!snap.is_daytime) return 'Sun is below the horizon. Panel is in night position (0°).'
    const diff = Math.abs(snap.tilt_difference)
    if (snap.motor.status === 'moving') {
      const dir = snap.motor.direction === 'up' ? 'increase' : 'decrease'
      return `Solar elevation is ${snap.solar_elevation.toFixed(1)}°. ` +
        `Current tilt (${snap.current_angle.toFixed(1)}°) is ${diff.toFixed(1)}° away from optimal. ` +
        `Panel is moving to ${dir} tilt to ${snap.target_angle.toFixed(1)}°.`
    }
    if (diff < 2) {
      return `Panel is at optimal position (${snap.current_angle.toFixed(1)}°) for current solar elevation of ${snap.solar_elevation.toFixed(1)}°. No adjustment needed.`
    }
    return `Optimal angle for solar elevation ${snap.solar_elevation.toFixed(1)}° is ${snap.optimal_angle.toFixed(1)}°. ` +
      `Panel will adjust from ${snap.current_angle.toFixed(1)}° when threshold (${diff.toFixed(1)}°) is exceeded.`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="page-title">Live Control</h1>
        <p className="page-sub">Real-time panel position, motor state, and manual control</p>
      </div>

      {snap && <FaultBanner faults={snap.active_faults} />}

      {/* ── EMERGENCY STOP prominent ─────────────────────────────────────── */}
      {stopped ? (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <span className="text-red-600 text-xl">✕</span>
            </div>
            <div className="flex-1">
              <h2 className="text-base font-bold text-red-700">SYSTEM STOPPED</h2>
              <p className="text-sm text-red-600 mt-1">Motor movement has been halted. Automatic control is disabled.</p>
              {snap && <p className="text-xs text-red-500 mt-1">Last known position: {snap.current_angle.toFixed(1)}°</p>}
              <button
                onClick={doRecover}
                disabled={loading === 'recover'}
                className="mt-3 btn btn-primary text-sm"
              >
                {loading === 'recover' ? 'Recovering…' : 'Recover System — Return to AUTO Mode'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          {!showEStop ? (
            <button
              onClick={() => setShowEStop(true)}
              className="btn btn-danger"
            >
              ⏹ EMERGENCY STOP
            </button>
          ) : (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded px-4 py-3">
              <p className="text-sm text-red-700 font-medium">Confirm emergency stop?</p>
              <button onClick={doEmergencyStop} disabled={loading === 'estop'} className="btn btn-danger btn-sm">
                {loading === 'estop' ? 'Stopping…' : 'CONFIRM STOP'}
              </button>
              <button onClick={() => setShowEStop(false)} className="btn btn-secondary btn-sm">Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`rounded px-4 py-2 text-sm font-medium ${message.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      {/* ── Main grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Panel Position card */}
        <div className="card space-y-4">
          <p className="section-title">Panel Position</p>
          {!snap ? (
            <div className="text-sm text-neutral-400">Waiting for simulation data…</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Current Angle', value: `${snap.current_angle.toFixed(1)}°`, accent: 'text-blue-600' },
                  { label: 'Target Angle',  value: `${snap.target_angle.toFixed(1)}°`,  accent: 'text-indigo-600' },
                  { label: 'Difference',    value: (snap.tilt_difference >= 0 ? '+' : '') + snap.tilt_difference.toFixed(1) + '°',
                    accent: Math.abs(snap.tilt_difference) < 2 ? 'text-green-600' : 'text-amber-600' },
                ].map(({ label, value, accent }) => (
                  <div key={label} className="text-center">
                    <p className="text-xs text-neutral-500 mb-1">{label}</p>
                    <p className={`text-2xl font-mono font-bold ${accent}`}>{value}</p>
                  </div>
                ))}
              </div>

              {/* Angle progress bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span>0°</span>
                  <span className="text-neutral-600">Current: {snap.current_angle.toFixed(1)}°</span>
                  <span>70°</span>
                </div>
                <div className="relative h-4 bg-neutral-100 rounded-full overflow-hidden">
                  {/* Optimal marker */}
                  <div
                    className="absolute top-0 h-full w-0.5 bg-green-400 opacity-60"
                    style={{ left: `${(snap.optimal_angle / 70) * 100}%` }}
                  />
                  {/* Current position */}
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${(snap.current_angle / 70) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-neutral-400">
                  <span />
                  <span className="text-green-600">Optimal: {snap.optimal_angle.toFixed(1)}°</span>
                  <span />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Motor State card */}
        <div className="card space-y-4">
          <p className="section-title">Motor Status</p>
          {!snap ? (
            <div className="text-sm text-neutral-400">Waiting for simulation data…</div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <MotorStatusBadge status={snap.motor.status} />
                <span className={`text-sm font-semibold capitalize ${
                  snap.motor.direction === 'up' ? 'text-green-600'
                  : snap.motor.direction === 'down' ? 'text-amber-600'
                  : 'text-neutral-400'
                }`}>
                  {snap.motor.direction !== 'idle'
                    ? `${snap.motor.direction === 'up' ? '↑' : '↓'} ${snap.motor.direction.toUpperCase()}`
                    : '— IDLE'}
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-neutral-500">
                  <span>Speed</span>
                  <span>{snap.motor.speed_pct.toFixed(0)}%</span>
                </div>
                <ProgressBar
                  pct={snap.motor.speed_pct}
                  color={snap.motor.status === 'moving' ? 'bg-blue-500' : 'bg-neutral-300'}
                />
              </div>

              {snap.motor.fault_message && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5">
                  ⚠ {snap.motor.fault_message}
                </p>
              )}

              {snap.motor.status === 'moving' && (
                <div className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded px-2 py-2">
                  <div className="flex justify-between mb-1">
                    <span>Progress</span>
                    <span>{snap.motor.current_angle.toFixed(1)}° → {snap.motor.target_angle.toFixed(1)}°</span>
                  </div>
                  <ProgressBar
                    pct={snap.motor.target_angle !== 0
                      ? (snap.motor.current_angle / snap.motor.target_angle) * 100
                      : 100}
                    color="bg-blue-400"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── WHY IS THE PANEL MOVING ───────────────────────────────────────── */}
      <div className="card">
        <p className="section-title">Control Decision Explanation</p>
        <div className={`rounded-lg p-4 mt-2 border text-sm leading-relaxed
          ${snap?.motor.status === 'moving' ? 'bg-blue-50 border-blue-200 text-blue-800'
          : snap?.mode === 'stopped' ? 'bg-red-50 border-red-200 text-red-800'
          : snap && Math.abs(snap.tilt_difference) < 2 ? 'bg-green-50 border-green-200 text-green-800'
          : 'bg-neutral-50 border-neutral-200 text-neutral-700'}`}
        >
          {getDecisionText()}
        </div>

        {snap && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-xs text-neutral-500">
            <div>
              <p className="mb-0.5 font-medium text-neutral-600">Solar Elevation</p>
              <p className="font-mono text-base text-neutral-800">{snap.solar_elevation.toFixed(1)}°</p>
            </div>
            <div>
              <p className="mb-0.5 font-medium text-neutral-600">Solar Azimuth</p>
              <p className="font-mono text-base text-neutral-800">{snap.solar_azimuth.toFixed(1)}°</p>
            </div>
            <div>
              <p className="mb-0.5 font-medium text-neutral-600">Optimal Tilt</p>
              <p className="font-mono text-base text-neutral-800">{snap.optimal_angle.toFixed(1)}°</p>
            </div>
            <div>
              <p className="mb-0.5 font-medium text-neutral-600">Power Output</p>
              <p className="font-mono text-base text-neutral-800">{snap.power_w?.toFixed(2) ?? '—'} W</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Manual Control ─────────────────────────────────────────────────── */}
      {!stopped && (
        <div className="card">
          <p className="section-title">Manual Panel Control</p>
          <div className="max-w-md space-y-4 mt-2">
            {/* Quick Jog Buttons */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleJog('up')}
                disabled={loading != null || (snap?.current_angle !== undefined && snap.current_angle >= 70) || snap?.max_limit_triggered}
                className="py-2.5 px-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-200 disabled:text-neutral-400 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-sm"
              >
                <span>▲</span> TILT UP (+5°)
              </button>
              <button
                onClick={doEmergencyStop}
                disabled={loading != null}
                className="py-2.5 px-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-neutral-200 disabled:text-neutral-400 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-sm"
              >
                <span>■</span> STOP
              </button>
              <button
                onClick={() => handleJog('down')}
                disabled={loading != null || (snap?.current_angle !== undefined && snap.current_angle <= 0) || snap?.min_limit_triggered}
                className="py-2.5 px-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-200 disabled:text-neutral-400 text-white font-bold text-xs flex items-center justify-center gap-1 shadow-sm"
              >
                <span>▼</span> TILT DOWN (-5°)
              </button>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-sm text-neutral-600 w-24 flex-shrink-0">Target Angle</label>
              <input
                type="number"
                min={0}
                max={70}
                step={1}
                value={manualAngle}
                onChange={(e) => setManualAngle(Math.max(0, Math.min(70, parseFloat(e.target.value) || 0)))}
                className="input w-24"
              />
              <span className="text-sm text-neutral-500">degrees</span>
            </div>
            <div className="space-y-1">
              <input
                type="range"
                min={0}
                max={70}
                step={1}
                value={manualAngle}
                onChange={(e) => setManualAngle(parseInt(e.target.value))}
                className="w-full accent-blue-600"
                aria-label="Target angle slider"
              />
              <div className="flex justify-between text-xs text-neutral-400">
                <span>0° (flat)</span>
                <span className="text-blue-600 font-semibold">{manualAngle}°</span>
                <span>70° (steep)</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={applyTilt}
                disabled={loading === 'tilt' || snap?.mode === 'stopped'}
                className="btn btn-primary"
              >
                {loading === 'tilt' ? 'Sending…' : `Apply ${manualAngle}°`}
              </button>
              <button
                onClick={() => applyMode('auto')}
                disabled={loading === 'mode' || snap?.mode === 'stopped'}
                className="btn btn-secondary"
              >
                Return to AUTO
              </button>
            </div>
            <p className="text-xs text-neutral-400">
              Manual mode overrides automatic tracking. Panel will move to specified angle.
            </p>
          </div>
        </div>
      )}

      {/* ── Mode control ─────────────────────────────────────────────────── */}
      <div className="card">
        <p className="section-title">Operating Mode</p>
        <div className="flex gap-2 mt-2">
          {(['auto', 'manual'] as const).map((m) => (
            <button
              key={m}
              onClick={() => applyMode(m)}
              disabled={loading === 'mode' || snap?.mode === 'stopped'}
              className={`btn ${snap?.mode === m ? 'btn-primary' : 'btn-secondary'}`}
            >
              {m === 'auto' ? '⚡ AUTO' : '🎛 MANUAL'}
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-400 mt-2">
          AUTO: System tracks solar position automatically. MANUAL: Operator controls angle.
        </p>
      </div>
    </div>
  )
}
