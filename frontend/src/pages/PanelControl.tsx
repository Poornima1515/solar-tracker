import { useState, useEffect, useCallback } from 'react'
import { controlService } from '../services/controlService'
import ErrorMessage from '../components/common/ErrorMessage'
import StatusIndicator from '../components/common/StatusIndicator'
import { fmt } from '../utils/formatters'
import type { ControlState, TrackingEvent } from '../types'

export default function PanelControl() {
  const [state, setState] = useState<ControlState | null>(null)
  const [events, setEvents] = useState<TrackingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cmdStatus, setCmdStatus] = useState<string | null>(null)
  const [cmdError, setCmdError] = useState<string | null>(null)
  const [targetInput, setTargetInput] = useState('')
  const [sending, setSending] = useState(false)

  const loadState = useCallback(async () => {
    try {
      const [s, ev] = await Promise.all([
        controlService.getState(),
        controlService.getEvents(20),
      ])
      setState(s)
      setEvents(ev)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load control state')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadState() }, [loadState])

  const clearStatus = () => { setCmdStatus(null); setCmdError(null) }

  const handleTilt = async () => {
    clearStatus()
    const angle = parseFloat(targetInput)
    if (isNaN(angle)) { setCmdError('Enter a valid angle (number)'); return }
    if (!state) return
    if (angle < state.min_angle || angle > state.max_angle) {
      setCmdError(`Angle must be between ${state.min_angle}° and ${state.max_angle}°`)
      return
    }
    setSending(true)
    try {
      const res = await controlService.tilt(angle)
      if (res.success) {
        setCmdStatus(`Panel moved to ${fmt.angle(res.current_angle)} — ${res.status}`)
        loadState()
      } else {
        setCmdError(`Command failed: ${res.status}${res.message ? ' — ' + res.message : ''}`)
      }
    } catch (e) {
      setCmdError(e instanceof Error ? e.message : 'Command failed')
    } finally {
      setSending(false)
    }
  }

  const handleStop = async () => {
    clearStatus()
    setSending(true)
    try {
      const res = await controlService.stop()
      setCmdStatus(res.message)
      loadState()
    } catch (e) {
      setCmdError(e instanceof Error ? e.message : 'Stop failed')
    } finally { setSending(false) }
  }

  const handleHome = async () => {
    clearStatus()
    setSending(true)
    try {
      const res = await controlService.home()
      setCmdStatus(res.success ? `Homed to ${fmt.angle(res.current_angle)}` : 'Home failed')
      loadState()
    } catch (e) {
      setCmdError(e instanceof Error ? e.message : 'Home failed')
    } finally { setSending(false) }
  }

  const handleMode = async (mode: string) => {
    clearStatus()
    setSending(true)
    try {
      const res = await controlService.setMode(mode)
      setCmdStatus(res.message)
      loadState()
    } catch (e) {
      setCmdError(e instanceof Error ? e.message : 'Mode change failed')
    } finally { setSending(false) }
  }

  const handleTriggerCycle = async () => {
    clearStatus()
    setSending(true)
    try {
      await controlService.triggerCycle()
      setCmdStatus('Tracking cycle triggered. Refreshing…')
      setTimeout(loadState, 2000)
    } catch (e) {
      setCmdError(e instanceof Error ? e.message : 'Trigger failed')
    } finally { setSending(false) }
  }

  if (loading) return <div className="text-sm text-neutral-400 p-4">Loading…</div>
  if (error) return <ErrorMessage message={error} onRetry={loadState} />

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Panel Control</h1>
        <p className="page-sub">Manual and automatic tilt control</p>
      </div>

      {/* State summary */}
      {state && (
        <div className="card">
          <div className="section-title">Current State</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-neutral-500">Current Angle</div>
              <div className="text-2xl font-mono font-semibold mt-0.5">{fmt.angle(state.current_angle)}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Target Angle</div>
              <div className="text-2xl font-mono font-semibold mt-0.5 text-solar-600">{fmt.angle(state.target_angle)}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Mode</div>
              <div className="text-sm font-medium mt-1 capitalize">{state.mode}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Hardware</div>
              <div className="mt-1">
                <StatusIndicator
                  status={state.hardware_online ? 'online' : 'offline'}
                  label={state.hardware_online ? 'Online' : 'Offline'}
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Min Angle</div>
              <div className="text-base font-mono mt-0.5">{state.min_angle}°</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Max Angle</div>
              <div className="text-base font-mono mt-0.5">{state.max_angle}°</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Move Threshold</div>
              <div className="text-base font-mono mt-0.5">{state.movement_threshold}°</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Demo Mode</div>
              <div className="text-sm mt-1">{state.demo_mode ? 'Yes' : 'No'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Command status */}
      {cmdStatus && (
        <div className="rounded border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800 flex justify-between">
          {cmdStatus}
          <button onClick={clearStatus} className="text-green-600 hover:text-green-800 ml-3">×</button>
        </div>
      )}
      {cmdError && <ErrorMessage message={cmdError} onRetry={clearStatus} />}

      {/* Tilt command */}
      <div className="card space-y-4">
        <div className="section-title">Set Target Angle</div>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">
              Angle (°) — allowed: {state?.min_angle}° to {state?.max_angle}°
            </label>
            <input
              type="number"
              className="input w-36"
              placeholder="e.g. 42"
              min={state?.min_angle}
              max={state?.max_angle}
              step={0.5}
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTilt()}
            />
          </div>
          <button
            onClick={handleTilt}
            disabled={sending || !targetInput}
            className="btn btn-primary disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Move Panel'}
          </button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="card space-y-3">
        <div className="section-title">Quick Actions</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleStop} disabled={sending} className="btn btn-danger disabled:opacity-50">
            Stop Movement
          </button>
          <button onClick={handleHome} disabled={sending} className="btn btn-secondary disabled:opacity-50">
            Home (0°)
          </button>
          <button onClick={handleTriggerCycle} disabled={sending} className="btn btn-secondary disabled:opacity-50">
            Trigger Tracking Cycle
          </button>
        </div>
      </div>

      {/* Mode selector */}
      <div className="card space-y-3">
        <div className="section-title">Operating Mode</div>
        <div className="flex gap-2">
          {['auto', 'manual', 'stopped'].map((m) => (
            <button
              key={m}
              onClick={() => handleMode(m)}
              disabled={sending}
              className={`btn btn-sm capitalize disabled:opacity-50 ${
                state?.mode === m ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-400">
          Auto: system controls angle automatically. Manual: angle only changes on explicit command. Stopped: no movement allowed.
        </p>
      </div>

      {/* Tracking events */}
      {events.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="section-title">Recent Tracking Events</div>
          <table className="w-full">
            <thead>
              <tr>
                {['Time', 'Prev °', 'Target °', 'Actual °', 'Moved', 'Success', 'Reason'].map((h) => (
                  <th key={h} className="table-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-neutral-50">
                  <td className="table-td text-xs">{new Date(e.timestamp).toLocaleTimeString()}</td>
                  <td className="table-td">{e.previous_angle?.toFixed(1) ?? '—'}</td>
                  <td className="table-td">{e.target_angle?.toFixed(1) ?? '—'}</td>
                  <td className="table-td">{e.actual_angle?.toFixed(1) ?? '—'}</td>
                  <td className="table-td">{e.move_triggered ? 'Yes' : 'No'}</td>
                  <td className="table-td">
                    {e.move_success == null ? '—' : e.move_success ? (
                      <span className="text-green-600">Yes</span>
                    ) : (
                      <span className="text-red-600">No</span>
                    )}
                  </td>
                  <td className="table-td text-xs text-neutral-500 max-w-xs truncate">{e.movement_reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
