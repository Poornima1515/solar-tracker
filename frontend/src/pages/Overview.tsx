import { useState, useEffect, useCallback, useRef } from 'react'
import type { SimulationSnapshot, LatestTelemetry, ControlState } from '../types'
import PanelVisualizer from '../components/viz/PanelVisualizer'
import MetricCard from '../components/common/MetricCard'
import TelemetryChart from '../components/charts/TelemetryChart'
import { controlService } from '../services/controlService'
import { telemetryService } from '../services/telemetryService'
import { simulationService } from '../services/simulationService'

interface Props {
  snapshot: SimulationSnapshot | null
}

export default function Overview({ snapshot }: Props) {
  const [source, setSource] = useState<'real_hardware' | 'simulation'>('real_hardware')
  const [telemetry, setTelemetry] = useState<LatestTelemetry | null>(null)
  const [controlState, setControlState] = useState<ControlState | null>(null)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [customAngle, setCustomAngle] = useState<number>(90)
  const [overrideMode, setOverrideMode] = useState<string | null>(null)
  const [overrideAngle, setOverrideAngle] = useState<number | null>(null)

  // Rolling history for power chart
  const [powerHistory, setPowerHistory] = useState<Array<{ timestamp: string; power: number | null }>>([])
  const maxHistoryPoints = 30

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const showMsg = (text: string, ok: boolean) => {
    setActionMsg({ text, ok })
    setTimeout(() => setActionMsg(null), 3500)
  }

  // ─── Fetch initial control state ────────────────────────────────────────────
  const fetchState = useCallback(async () => {
    try {
      const cs = await controlService.getState()
      setControlState(cs)
      if (cs.system_source) {
        setSource(cs.system_source)
      }
    } catch {
      // Backend starting or offline
    }
  }, [])

  // ─── Fetch live telemetry ───────────────────────────────────────────────────
  const fetchTelemetry = useCallback(async () => {
    try {
      const telem = await telemetryService.getLatest()
      setTelemetry(telem)
      if (telem.system_source) {
        setSource(telem.system_source)
      }

      // Append power point to chart
      const nowStr = new Date().toISOString()
      const currentPower = telem.power != null ? telem.power : null
      setPowerHistory((prev) => {
        const next = [...prev, { timestamp: nowStr, power: currentPower }]
        return next.length > maxHistoryPoints ? next.slice(-maxHistoryPoints) : next
      })
    } catch {
      // Hardware offline
    }
  }, [])

  // Polling every 1 second
  useEffect(() => {
    fetchState()
    fetchTelemetry()
    pollIntervalRef.current = setInterval(() => {
      fetchTelemetry()
      fetchState()
    }, 1000)
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [fetchState, fetchTelemetry])

  // Update chart from simulation snapshot if in simulation mode
  useEffect(() => {
    if (source === 'simulation' && snapshot) {
      const nowStr = new Date().toISOString()
      const currentPower = snapshot.power_w != null ? snapshot.power_w : null
      setPowerHistory((prev) => {
        const next = [...prev, { timestamp: nowStr, power: currentPower }]
        return next.length > maxHistoryPoints ? next.slice(-maxHistoryPoints) : next
      })
    }
  }, [snapshot, source])

  // ─── Source Switch ──────────────────────────────────────────────────────────
  const handleSourceToggle = async (newSource: 'real_hardware' | 'simulation') => {
    setLoadingAction('source')
    try {
      await controlService.setSource(newSource)
      setSource(newSource)
      await fetchState()
      await fetchTelemetry()
      showMsg(
        newSource === 'real_hardware'
          ? 'Switched to REAL HARDWARE (Arduino USB Serial)'
          : 'Switched to SIMULATION mode',
        true
      )
    } catch {
      showMsg('Failed to change system source', false)
    } finally {
      setLoadingAction(null)
    }
  }

  // ─── Mode Switch (AUTO / MANUAL) ────────────────────────────────────────────
  const handleModeToggle = async () => {
    const currentMode =
      overrideMode ??
      (source === 'real_hardware'
        ? telemetry?.mode ?? controlState?.mode ?? 'auto'
        : snapshot?.mode ?? controlState?.mode ?? 'auto')
    const nextMode = currentMode === 'auto' ? 'manual' : 'auto'

    setOverrideMode(nextMode)
    setLoadingAction('mode')
    try {
      await controlService.setMode(nextMode)
      if (source === 'simulation') {
        await simulationService.setMode(nextMode)
      }
      showMsg(`Operating mode set to ${nextMode.toUpperCase()}`, true)
      await fetchState()
      await fetchTelemetry()
    } catch {
      setOverrideMode(currentMode)
      showMsg('Failed to update mode', false)
    } finally {
      setLoadingAction(null)
    }
  }

  // ─── Manual Controls ────────────────────────────────────────────────────────
  const handleJog = async (direction: 'up' | 'down') => {
    setOverrideMode('manual')
    setLoadingAction(`jog-${direction}`)
    try {
      const res = await controlService.jog(direction, 5)
      const newAng = res.current_angle ?? (direction === 'up' ? customAngle + 5 : customAngle - 5)
      setOverrideAngle(newAng)
      setCustomAngle(newAng)
      showMsg(`Adjusted ${direction.toUpperCase()} (+5°) to ${newAng}°`, true)
      await fetchState()
      await fetchTelemetry()
    } catch {
      showMsg('Failed to send jog command', false)
    } finally {
      setLoadingAction(null)
    }
  }

  const handleStop = async () => {
    setOverrideMode('manual')
    setLoadingAction('stop')
    try {
      await controlService.stop()
      showMsg('Panel motor STOPPED. Manual hold engaged.', true)
      await fetchState()
      await fetchTelemetry()
    } catch {
      showMsg('Failed to stop motor', false)
    } finally {
      setLoadingAction(null)
    }
  }

  const handleApplyAngle = async () => {
    setOverrideMode('manual')
    setOverrideAngle(customAngle)
    setLoadingAction('apply')
    try {
      await controlService.setMode('manual')
      await controlService.tilt(customAngle)
      showMsg(`Panel moving to ${customAngle}°`, true)
      await fetchState()
      await fetchTelemetry()
    } catch {
      showMsg('Failed to send tilt command', false)
    } finally {
      setLoadingAction(null)
    }
  }

  // ─── Hardware Telemetry & Calculations ──────────────────────────────────────
  const isReal = source === 'real_hardware'
  const isOnline = isReal ? telemetry?.hardware_online ?? false : true

  const activeMode: string =
    overrideMode ??
    (isReal
      ? telemetry?.mode ?? controlState?.mode ?? 'auto'
      : snapshot?.mode ?? 'auto')

  const commandedAngle: number =
    overrideAngle ??
    (isReal
      ? telemetry?.current_angle ?? 90
      : snapshot?.current_angle ?? 90)

  const voltage = isReal ? telemetry?.voltage : snapshot?.voltage
  const current = isReal ? telemetry?.current : snapshot?.current_a
  const power = isReal ? telemetry?.power : snapshot?.power_w
  const energy = isReal ? telemetry?.energy_today : snapshot?.energy_today_wh

  const ldrLeft = isReal ? telemetry?.ldr_left ?? 0 : 500
  const ldrRight = isReal ? telemetry?.ldr_right ?? 0 : 500
  const ldrDiff = ldrLeft - ldrRight

  // Light tracking balance status
  let lightStatusText = 'SUN BALANCED / EQUAL'
  let lightStatusColor = 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (Math.abs(ldrDiff) > 25) {
    if (ldrDiff > 0) {
      lightStatusText = '◀ BRIGHTER ON LEFT (Tracking Left)'
      lightStatusColor = 'text-blue-700 bg-blue-50 border-blue-200'
    } else {
      lightStatusText = '▶ BRIGHTER ON RIGHT (Tracking Right)'
      lightStatusColor = 'text-amber-700 bg-amber-50 border-amber-200'
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* ── Top Header & Source Selector ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-4 rounded-xl border border-neutral-200 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 tracking-tight">Solar Panel Tilt Tracker</h1>
          <p className="text-xs text-neutral-500 mt-0.5">
            Single-Axis Dual-LDR Tracking • 1 Solar Panel • 1 Servo Motor • 0–25V Voltage Sensor • Arduino UNO
          </p>
        </div>

        {/* Source Toggle */}
        <div className="flex items-center gap-2 bg-neutral-100 p-1.5 rounded-lg border border-neutral-200">
          <span className="text-xs font-semibold text-neutral-500 px-2">SOURCE:</span>
          <button
            onClick={() => handleSourceToggle('real_hardware')}
            disabled={loadingAction === 'source'}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
              isReal
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isReal ? (isOnline ? 'bg-white animate-pulse' : 'bg-red-300') : 'bg-neutral-400'}`} />
            REAL HARDWARE
          </button>
          <button
            onClick={() => handleSourceToggle('simulation')}
            disabled={loadingAction === 'source'}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
              !isReal
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${!isReal ? 'bg-white animate-pulse' : 'bg-neutral-400'}`} />
            SIMULATION
          </button>
        </div>
      </div>

      {/* Disconnection Warning (Hardware Mode) */}
      {isReal && !isOnline && (
        <div className="rounded-xl border-2 border-red-500 bg-red-50 p-4 text-red-900 shadow-sm flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none">🔴</span>
            <div>
              <p className="font-bold text-base text-red-800">ARDUINO DISCONNECTED</p>
              <p className="text-xs text-red-700 mt-0.5">
                Waiting for live data from Arduino UNO. Please run:
                <code className="mx-1 px-1.5 py-0.5 bg-red-100 rounded text-red-900 font-mono font-bold">
                  python serial_bridge.py
                </code>
                (Make sure the Arduino IDE Serial Monitor is closed).
              </p>
            </div>
          </div>
          <span className="px-3 py-1 bg-red-200 text-red-900 rounded-md font-mono text-xs font-bold whitespace-nowrap">
            OFFLINE
          </span>
        </div>
      )}

      {actionMsg && (
        <div
          className={`rounded-lg px-4 py-2.5 text-xs font-semibold border ${
            actionMsg.ok
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : 'bg-red-50 text-red-800 border-red-300'
          }`}
        >
          {actionMsg.text}
        </div>
      )}

      {/* ── Status Matrix ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3 rounded-lg border border-neutral-200 shadow-sm">
          <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Controller Status</p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span className={`text-sm font-bold ${isOnline ? 'text-emerald-700' : 'text-red-700'}`}>
              {isOnline ? 'Arduino Online (COM7)' : 'Offline'}
            </span>
          </div>
        </div>

        <div className="bg-white p-3 rounded-lg border border-neutral-200 shadow-sm">
          <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Operating Mode</p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`text-xs font-bold px-2.5 py-0.5 rounded ${
                activeMode === 'auto'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-blue-100 text-blue-800 border border-blue-300'
              }`}
            >
              {activeMode.toUpperCase()}
            </span>
            <button
              onClick={handleModeToggle}
              disabled={loadingAction === 'mode'}
              className="text-xs text-blue-600 hover:underline font-semibold"
            >
              Switch
            </button>
          </div>
        </div>

        <div className="bg-white p-3 rounded-lg border border-neutral-200 shadow-sm">
          <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Ground Reference</p>
          <p className="text-sm font-bold text-neutral-800 mt-1">
            0° = Flat Ground / Horizontal
          </p>
        </div>

        <div className="bg-white p-3 rounded-lg border border-neutral-200 shadow-sm">
          <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Light Tracking State</p>
          <p className="text-xs font-bold text-neutral-800 mt-1 truncate">
            {activeMode === 'auto' ? (Math.abs(ldrDiff) > 25 ? 'Active Adjusting' : 'Balanced / Locked') : 'Manual Hold'}
          </p>
        </div>
      </div>

      {/* ── Solar Output (Actual Voltmeter Hardware) ───────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-neutral-800 uppercase tracking-wider">
            Solar Panel Generation (Voltmeter Sensor)
          </h2>
          <span className="text-xs text-neutral-400">Measured from 0–25V Sensor Module on Pin A2</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricCard
            label="Solar Voltage"
            value={voltage != null ? voltage.toFixed(2) : '—'}
            unit="V"
            sub={isReal && !isOnline ? 'Offline' : 'Direct Voltmeter Reading'}
            accent="green"
          />
          <MetricCard
            label="Load Current (Est.)"
            value={current != null ? current.toFixed(2) : '—'}
            unit="A"
            sub="Across 10Ω Test Load"
            accent="blue"
          />
          <MetricCard
            label="Power Output"
            value={power != null ? power.toFixed(2) : '—'}
            unit="W"
            sub="V × I Generation"
            accent="amber"
          />
          <MetricCard
            label="Total Energy"
            value={energy != null ? energy.toFixed(1) : '—'}
            unit="Wh"
            sub="Accumulated"
            accent="neutral"
          />
        </div>
      </div>

      {/* ── Middle Row: 2 LDR Sensors & Panel Position Visualizer ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Card: 2 LDR Sensors (Actual Hardware) */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <p className="section-title">2× LDR Light Intensity</p>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${lightStatusColor}`}>
              {lightStatusText}
            </span>
          </div>

          <div className="space-y-4 pt-2">
            {/* Left LDR */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-neutral-600">Left LDR (A0):</span>
                <span className="font-mono text-blue-700">{ldrLeft} / 1023</span>
              </div>
              <div className="w-full bg-neutral-100 rounded-full h-3 overflow-hidden border border-neutral-200">
                <div
                  className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, (ldrLeft / 1023) * 100)}%` }}
                />
              </div>
            </div>

            {/* Right LDR */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-neutral-600">Right LDR (A1):</span>
                <span className="font-mono text-amber-700">{ldrRight} / 1023</span>
              </div>
              <div className="w-full bg-neutral-100 rounded-full h-3 overflow-hidden border border-neutral-200">
                <div
                  className="bg-amber-500 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, (ldrRight / 1023) * 100)}%` }}
                />
              </div>
            </div>

            <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 text-xs text-neutral-600 space-y-1">
              <div className="flex justify-between">
                <span>Light Difference (L - R):</span>
                <span className="font-mono font-bold">{ldrDiff > 0 ? `+${ldrDiff}` : ldrDiff}</span>
              </div>
              <div className="flex justify-between">
                <span>Deadband Threshold:</span>
                <span className="font-mono">±25</span>
              </div>
            </div>
          </div>
        </div>

        {/* Center / Right: Panel Position & Visualizer */}
        <div className="lg:col-span-2 card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="section-title">Panel Tilt Angle & Ground Reference</p>
              <p className="text-xs text-neutral-500">
                0° = Parallel to Ground (Flat) • 90° = Vertical
              </p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-mono font-black text-neutral-900">
                {commandedAngle.toFixed(0)}°
              </span>
              <p className="text-[10px] text-neutral-400 font-semibold uppercase">Tilt from Ground</p>
            </div>
          </div>

          <PanelVisualizer
            currentAngle={commandedAngle}
            optimalAngle={90}
            solarElevation={60}
            solarAzimuth={180}
            isDaytime={true}
            motorMoving={activeMode === 'auto' && Math.abs(ldrDiff) > 25}
          />

          {/* Visual reference reminder */}
          <div className="flex justify-between items-center text-xs text-neutral-500 bg-neutral-50 p-2.5 rounded-lg border border-neutral-200">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-neutral-400" />
              <strong>0°:</strong> Ground Level (Horizontal)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <strong>45°:</strong> Half Tilt
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <strong>90°:</strong> Vertical to Ground
            </span>
          </div>
        </div>
      </div>

      {/* ── Bottom Row: Manual Controls & Power vs Time Chart ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Manual Control Panel */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <p className="section-title">Manual Panel Control</p>
            <span className="text-xs font-mono font-bold text-neutral-500">
              Mode: {activeMode.toUpperCase()}
            </span>
          </div>

          <div className="space-y-3">
            {activeMode !== 'manual' && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center justify-between">
                <span>🔒 Manual tilt controls are disabled in AUTO mode.</span>
                <button
                  onClick={handleModeToggle}
                  className="font-bold text-amber-900 underline hover:text-amber-950 ml-2"
                >
                  Enable Manual Control
                </button>
              </div>
            )}

            {/* Quick Jog Buttons */}
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => handleJog('down')}
                disabled={activeMode !== 'manual' || loadingAction != null}
                className="py-3 px-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-200 disabled:text-neutral-400 text-white font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-sm transition-all"
              >
                <span className="text-base">◀</span>
                <span>TILT LEFT (-5°)</span>
              </button>

              <button
                onClick={handleStop}
                disabled={activeMode !== 'manual' || loadingAction != null}
                className="py-3 px-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-neutral-200 disabled:text-neutral-400 text-white font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-sm transition-all"
              >
                <span className="text-base">■</span>
                <span>STOP MOTOR</span>
              </button>

              <button
                onClick={() => handleJog('up')}
                disabled={activeMode !== 'manual' || loadingAction != null}
                className="py-3 px-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-200 disabled:text-neutral-400 text-white font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-sm transition-all"
              >
                <span className="text-base">▶</span>
                <span>TILT RIGHT (+5°)</span>
              </button>
            </div>

            {/* Direct Slider & Angle Input */}
            <div className={`bg-neutral-50 rounded-lg p-3 border border-neutral-200 space-y-3 ${activeMode !== 'manual' ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-neutral-700">Direct Angle Input (0° to 180° Full Sweep):</span>
                <span className="font-mono font-bold text-blue-700 text-sm">{customAngle}°</span>
              </div>

              <input
                type="range"
                min={0}
                max={180}
                step={1}
                value={customAngle}
                disabled={activeMode !== 'manual' || loadingAction != null}
                onChange={(e) => setCustomAngle(parseInt(e.target.value, 10))}
                className="w-full accent-blue-600 cursor-pointer"
              />

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={180}
                  value={customAngle}
                  disabled={activeMode !== 'manual' || loadingAction != null}
                  onChange={(e) =>
                    setCustomAngle(Math.max(0, Math.min(180, parseInt(e.target.value, 10) || 0)))
                  }
                  className="input w-20 text-xs text-center font-mono font-bold"
                />
                <span className="text-xs text-neutral-500">degrees</span>
                <button
                  onClick={handleApplyAngle}
                  disabled={activeMode !== 'manual' || loadingAction != null}
                  className="ml-auto btn btn-primary text-xs py-1.5 px-3"
                >
                  Set Angle
                </button>
              </div>
            </div>

            {/* Mode switcher */}
            <div className="pt-2 border-t border-neutral-200 flex items-center justify-between">
              <span className="text-xs text-neutral-500">
                {activeMode === 'auto' ? 'Currently following 2-LDR light autonomously' : 'Manual operator control active'}
              </span>
              <button
                onClick={handleModeToggle}
                disabled={loadingAction != null}
                className="btn btn-secondary text-xs py-1 px-3"
              >
                {activeMode === 'auto' ? 'Switch to MANUAL' : 'Return to AUTO'}
              </button>
            </div>
          </div>
        </div>

        {/* Live Power vs Time Chart */}
        <div className="card">
          <TelemetryChart
            data={powerHistory}
            series={[{ key: 'power', label: 'Solar Output Power', unit: 'W', color: '#16a34a' }]}
            title="Real-Time Solar Power Output"
            height={220}
          />
        </div>
      </div>
    </div>
  )
}
