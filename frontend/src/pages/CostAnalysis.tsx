import { useState, useEffect, useCallback } from 'react'
import { costService } from '../services/comparisonService'
import ErrorMessage from '../components/common/ErrorMessage'
import DataLabel from '../components/common/DataLabel'
import type { CostAnalysis, CostAssumptionRequest } from '../types'

const DEFAULT_FORM: CostAssumptionRequest = {
  cost_esp32: 500,
  cost_servo: 350,
  cost_sensors: 400,
  cost_solar_panel: 1200,
  cost_mechanical_frame: 1500,
  cost_wiring_misc: 500,
  cost_power_supply: 300,
  electricity_tariff_per_kwh: 8,
  currency_symbol: '₹',
  measured_daily_gain_wh: null,
  data_source: 'demo',
}

export default function CostAnalysis() {
  const [data, setData] = useState<CostAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<CostAssumptionRequest>(DEFAULT_FORM)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await costService.getAnalysis()
      setData(d)
      // Populate form from server values
      setForm({
        cost_esp32: d.bom.find(b => b.component.includes('ESP32'))?.cost ?? 500,
        cost_servo: d.bom.find(b => b.component.includes('Servo'))?.cost ?? 350,
        cost_sensors: d.bom.find(b => b.component.includes('Sensor'))?.cost ?? 400,
        cost_solar_panel: d.bom.find(b => b.component.includes('Solar'))?.cost ?? 1200,
        cost_mechanical_frame: d.bom.find(b => b.component.includes('Mechanical'))?.cost ?? 1500,
        cost_wiring_misc: d.bom.find(b => b.component.includes('Wiring'))?.cost ?? 500,
        cost_power_supply: d.bom.find(b => b.component.includes('Power'))?.cost ?? 300,
        electricity_tariff_per_kwh: 8,
        currency_symbol: d.currency_symbol,
        measured_daily_gain_wh: d.measured_daily_gain_wh,
        data_source: d.data_source as CostAssumptionRequest['data_source'],
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cost data')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaveMsg(null); setSaveErr(null)
    setSaving(true)
    try {
      const d = await costService.updateAssumptions(form)
      setData(d)
      setSaveMsg('Assumptions saved.')
      setEditing(false)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  const f = (v: number | null | undefined) =>
    v != null ? `${data?.currency_symbol ?? '₹'}${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'

  if (loading) return <div className="text-sm text-neutral-400 p-4">Loading…</div>
  if (error) return <ErrorMessage message={error} onRetry={load} />
  if (!data) return null

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Cost Analysis</h1>
          <p className="page-sub">Prototype BOM and payback estimation</p>
        </div>
        <DataLabel source={data.data_source} />
      </div>

      {/* Disclaimer */}
      <div className="rounded border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-500">
        {data.disclaimer}
      </div>

      {/* BOM table */}
      <div className="card overflow-x-auto">
        <div className="section-title">Bill of Materials — Prototype</div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-th">Component</th>
              <th className="table-th text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.bom.map((item) => (
              <tr key={item.component} className="hover:bg-neutral-50">
                <td className="table-td">{item.component}</td>
                <td className="table-td text-right font-mono">{item.currency}{item.cost.toLocaleString('en-IN')}</td>
              </tr>
            ))}
            <tr className="bg-neutral-50 font-semibold">
              <td className="table-td">Total Prototype Cost</td>
              <td className="table-td text-right font-mono text-neutral-900">
                {f(data.total_prototype_cost)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Financial projection */}
      <div className="card">
        <div className="section-title">Energy & Financial Projection</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-neutral-500">Measured Daily Gain</div>
            <div className="text-lg font-mono font-semibold mt-0.5">
              {data.measured_daily_gain_wh != null ? `${data.measured_daily_gain_wh} Wh` : 'Not measured'}
            </div>
            <div className="text-xs text-neutral-400">From experimental data</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Est. Annual Gain</div>
            <div className="text-lg font-mono font-semibold mt-0.5">
              {data.estimated_annual_gain_kwh != null ? `${data.estimated_annual_gain_kwh} kWh` : '—'}
            </div>
            <div className="text-xs text-neutral-400">Daily × 365</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Est. Annual Revenue</div>
            <div className="text-lg font-mono font-semibold mt-0.5">{f(data.estimated_annual_revenue)}</div>
            <div className="text-xs text-neutral-400">At tariff rate</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Est. Payback Period</div>
            <div className="text-lg font-mono font-semibold mt-0.5">
              {data.estimated_payback_years != null ? `${data.estimated_payback_years} years` : '—'}
            </div>
            <div className="text-xs text-neutral-400">Cost ÷ Annual revenue</div>
          </div>
        </div>
        {data.measured_daily_gain_wh == null && (
          <p className="text-xs text-neutral-400 mt-3 border-t border-neutral-100 pt-2">
            Financial projections are not available until a measured daily energy gain is entered below.
            Run the fixed-vs-AI experiment and enter the result in the Comparison page, then enter the daily gain here.
          </p>
        )}
      </div>

      {/* Editable assumptions */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="section-title mb-0">Edit Assumptions</div>
          {!editing && (
            <button onClick={() => setEditing(true)} className="btn btn-secondary btn-sm">Edit</button>
          )}
        </div>

        {saveMsg && (
          <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 mb-3">
            {saveMsg}
          </div>
        )}
        {saveErr && <div className="mb-3"><ErrorMessage message={saveErr} /></div>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            ['ESP32', 'cost_esp32'],
            ['Servo', 'cost_servo'],
            ['Sensors', 'cost_sensors'],
            ['Solar Panel', 'cost_solar_panel'],
            ['Mechanical Frame', 'cost_mechanical_frame'],
            ['Wiring & Misc', 'cost_wiring_misc'],
            ['Power Supply', 'cost_power_supply'],
          ] as [string, keyof CostAssumptionRequest][]).map(([label, key]) => (
            <div key={key}>
              <label className="block text-xs text-neutral-500 mb-1">{label} ({form.currency_symbol})</label>
              <input
                type="number"
                className="input"
                disabled={!editing}
                value={form[key] as number}
                onChange={(e) => setForm({ ...form, [key]: parseFloat(e.target.value) || 0 })}
              />
            </div>
          ))}
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Electricity Tariff (per kWh)</label>
            <input
              type="number"
              className="input"
              disabled={!editing}
              value={form.electricity_tariff_per_kwh}
              onChange={(e) => setForm({ ...form, electricity_tariff_per_kwh: parseFloat(e.target.value) || 8 })}
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Measured Daily Gain (Wh)</label>
            <input
              type="number"
              className="input"
              disabled={!editing}
              placeholder="Enter after experiment"
              value={form.measured_daily_gain_wh ?? ''}
              onChange={(e) => setForm({ ...form, measured_daily_gain_wh: e.target.value ? parseFloat(e.target.value) : null })}
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Data Source</label>
            <select
              className="input"
              disabled={!editing}
              value={form.data_source}
              onChange={(e) => setForm({ ...form, data_source: e.target.value as CostAssumptionRequest['data_source'] })}
            >
              <option value="demo">Demo</option>
              <option value="live">Live (experimental)</option>
              <option value="simulation">Simulation</option>
            </select>
          </div>
        </div>

        {editing && (
          <div className="flex gap-2 mt-4">
            <button onClick={handleSave} disabled={saving} className="btn btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setEditing(false); load() }} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
