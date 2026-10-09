import { useState, useEffect, useCallback } from 'react'
import { comparisonService } from '../services/comparisonService'
import TelemetryChart from '../components/charts/TelemetryChart'
import ErrorMessage from '../components/common/ErrorMessage'
import DataLabel from '../components/common/DataLabel'
import type { ComparisonRecord, ComparisonSummary } from '../types'

export default function Comparison() {
  const [summary, setSummary] = useState<ComparisonSummary | null>(null)
  const [history, setHistory] = useState<ComparisonRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Log fixed-panel form state
  const [fixedDate, setFixedDate] = useState('')
  const [fixedEnergy, setFixedEnergy] = useState('')
  const [fixedNotes, setFixedNotes] = useState('')
  const [logMsg, setLogMsg] = useState<string | null>(null)
  const [logErr, setLogErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, h] = await Promise.all([
        comparisonService.getSummary(),
        comparisonService.getHistory(),
      ])
      setSummary(s)
      // Ensure h is always an array and every record has an id
      const records = (Array.isArray(h) ? h : []).map((r: any, i: number) => ({
        ...r,
        id: r.id ?? i + 1,
      })) as ComparisonRecord[]
      setHistory(records)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load comparison data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleLogFixed = async () => {
    setLogMsg(null)
    setLogErr(null)
    if (!fixedDate || !fixedEnergy) {
      setLogErr('Date and energy value are both required.')
      return
    }
    const energyVal = parseFloat(fixedEnergy)
    if (isNaN(energyVal) || energyVal <= 0) {
      setLogErr('Energy must be a positive number (Wh).')
      return
    }
    setSubmitting(true)
    try {
      await comparisonService.logFixed({
        date: fixedDate,           // YYYY-MM-DD
        fixed_energy_wh: energyVal,
        notes: fixedNotes || undefined,
        data_source: 'live',
      })
      setLogMsg('Fixed-panel reference saved. The table will update now.')
      setFixedDate('')
      setFixedEnergy('')
      setFixedNotes('')
      load()
    } catch (e) {
      setLogErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  // Chart data — ordered oldest → newest for Recharts
  const chartData = [...history]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      timestamp: r.date,
      ai_energy: r.ai_energy_wh,
      fixed_energy: r.fixed_energy_wh,
      net_gain: r.net_gain_wh,
    }))

  if (loading) return <div className="text-sm text-neutral-400 p-4">Loading comparison data…</div>
  if (error) return <ErrorMessage message={error} onRetry={load} />

  const isDemo = summary?.data_source === 'demo'

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Performance Comparison</h1>
          <p className="page-sub">AI-controlled tracking panel vs fixed-tilt baseline</p>
        </div>
        <div className="flex items-center gap-2">
          {summary && <DataLabel source={summary.data_source} />}
          <button onClick={load} className="btn btn-secondary btn-sm">Refresh</button>
        </div>
      </div>

      {/* Explanation banner */}
      <div className={`rounded border px-4 py-3 text-xs ${isDemo ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
        <div className="font-semibold mb-1">
          {isDemo ? 'Demo Data — Simulated Comparison' : 'How This Works'}
        </div>
        {isDemo
          ? 'The comparison table currently shows simulated demo data to illustrate the format. When you connect real hardware and log actual fixed-panel readings below, real experimental data will appear here.'
          : 'Log the energy output of your fixed-tilt reference panel each day using the form below. The system automatically records the AI-tracked panel energy. Net Gain = AI Energy − Fixed Energy − Motor Energy Cost.'
        }
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total AI Energy',    value: summary.total_ai_energy_wh?.toFixed(1) ?? '—',    unit: 'Wh' },
            { label: 'Total Fixed Energy', value: summary.total_fixed_energy_wh?.toFixed(1) ?? '—', unit: 'Wh' },
            { label: 'Net Energy Gain',    value: summary.total_net_gain_wh?.toFixed(1) ?? '—',     unit: 'Wh' },
            { label: 'Avg Improvement',    value: summary.avg_percentage_improvement?.toFixed(1) ?? '—', unit: '%' },
            { label: 'Motor Energy Cost',  value: summary.total_tracking_cost_wh?.toFixed(2) ?? '—', unit: 'Wh' },
            { label: 'Total Movements',    value: summary.total_movements?.toString() ?? '—',       unit: '' },
            { label: 'Days Recorded',      value: summary.days_recorded.toString(),                 unit: 'days' },
          ].map(({ label, value, unit }) => (
            <div key={label} className="card">
              <div className="text-xs text-neutral-500 uppercase tracking-wide mb-1">{label}</div>
              <div className="text-xl font-mono font-semibold text-neutral-800">
                {value}
                {unit && <span className="text-xs font-normal text-neutral-400 ml-1">{unit}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Energy comparison chart */}
      <TelemetryChart
        title="Daily Energy Comparison — AI Panel vs Fixed Panel"
        data={chartData}
        height={240}
        emptyMessage="No comparison records yet — add a fixed-panel reading below to start."
        series={[
          { key: 'ai_energy',    label: 'AI Tracked (Wh)',   unit: 'Wh', color: '#5fb229' },
          { key: 'fixed_energy', label: 'Fixed Tilt (Wh)',   unit: 'Wh', color: '#a3a3a3' },
          { key: 'net_gain',     label: 'Net Gain (Wh)',     unit: 'Wh', color: '#f59e0b' },
        ]}
      />
      {chartData.length > 0 && (
        <p className="text-xs text-neutral-400 -mt-3 px-1">
          Net Gain = AI Energy − Fixed Energy − Motor Cost. Negative = tracker consumed more than it gained.
        </p>
      )}

      {/* History table */}
      {history.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="section-title">Daily Records</div>
          <table className="w-full">
            <thead>
              <tr>
                {['Date', 'AI Energy Wh', 'Fixed Energy Wh', 'Motor Cost Wh', 'Net Gain Wh', '% Improvement', 'Movements', 'Source'].map((h) => (
                  <th key={h} className="table-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((r, i) => (
                <tr key={r.id ?? i} className="hover:bg-neutral-50">
                  <td className="table-td font-medium">{r.date}</td>
                  <td className="table-td">{r.ai_energy_wh?.toFixed(1) ?? '—'}</td>
                  <td className="table-td">{r.fixed_energy_wh?.toFixed(1) ?? '—'}</td>
                  <td className="table-td">{r.tracking_cost_wh?.toFixed(2) ?? '—'}</td>
                  <td className={`table-td font-medium ${(r.net_gain_wh ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {r.net_gain_wh?.toFixed(2) ?? '—'}
                  </td>
                  <td className="table-td">
                    {r.percentage_improvement != null
                      ? `${r.percentage_improvement.toFixed(1)}%`
                      : '—'}
                  </td>
                  <td className="table-td">{r.num_movements ?? '—'}</td>
                  <td className="table-td"><DataLabel source={r.data_source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Log fixed-panel reading */}
      <div className="card">
        <div className="section-title">Log Fixed-Panel Energy Reading</div>

        {/* How-to explanation */}
        <div className="rounded bg-neutral-50 border border-neutral-200 px-3 py-2 text-xs text-neutral-600 mb-3 space-y-1">
          <div className="font-semibold text-neutral-700">How the experiment works:</div>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Set up a second (fixed-angle) solar panel pointed at the seasonal optimum tilt.</li>
            <li>Connect both panels to identical loads or energy meters.</li>
            <li>At the end of each day, read the energy meter from the fixed panel (Wh).</li>
            <li>Enter it here. The AI panel energy is recorded automatically by the INA219 sensor.</li>
            <li>Net gain = AI energy − fixed energy − motor cost (tracked automatically).</li>
          </ol>
        </div>

        {logMsg && (
          <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 mb-3">
            ✓ {logMsg}
          </div>
        )}
        {logErr && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 mb-3">
            {logErr}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Date</label>
            <input
              type="date"
              className="input"
              value={fixedDate}
              onChange={(e) => setFixedDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Fixed Panel Energy (Wh)</label>
            <input
              type="number"
              className="input"
              placeholder="e.g. 48.5"
              min="0"
              step="0.1"
              value={fixedEnergy}
              onChange={(e) => setFixedEnergy(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Notes (optional)</label>
            <input
              type="text"
              className="input"
              placeholder="Weather conditions, panel tilt used…"
              value={fixedNotes}
              onChange={(e) => setFixedNotes(e.target.value)}
            />
          </div>
        </div>
        <button
          onClick={handleLogFixed}
          disabled={submitting}
          className="btn btn-primary disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save Fixed-Panel Reading'}
        </button>
      </div>

    </div>
  )
}
