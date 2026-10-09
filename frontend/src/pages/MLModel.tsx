import { useState, useCallback, useEffect } from 'react'
import { mlService } from '../services/mlService'
import ErrorMessage from '../components/common/ErrorMessage'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { ModelStatus } from '../types'

// ─── Algorithm explanation cards ─────────────────────────────────────────────

const ALGORITHMS = [
  {
    name: 'XGBoost (eXtreme Gradient Boosting)',
    role: 'Irradiance Prediction',
    color: 'border-yellow-300 bg-yellow-50',
    badge: 'bg-yellow-100 text-yellow-800',
    description:
      'The main ML model. Predicts how much solar energy (W/m²) will arrive at the panel given current weather and time conditions.',
    howItWorks:
      'Builds hundreds of small decision trees one after another. Each new tree corrects the errors made by all previous trees — this is called "gradient boosting". The result is an accurate predictor trained on historical irradiance + weather data.',
    whyChosen:
      'Chosen over neural networks and random forests because it trains fast, handles tabular/structured data extremely well, requires minimal data cleaning, and gives interpretable feature importance scores.',
    codeFile: 'backend/app/ml/prediction.py  +  ml/train.py',
    inputs: 'Hour, month, day of year, solar elevation/azimuth/zenith, clear-sky GHI/DNI/DHI, temperature, humidity',
    output: 'Predicted GHI (W/m²)',
  },
  {
    name: 'NREL Solar Position Algorithm',
    role: 'Sun Position Calculation',
    color: 'border-blue-300 bg-blue-50',
    badge: 'bg-blue-100 text-blue-800',
    description:
      'Calculates the exact position of the sun (elevation, azimuth, zenith) for any date, time, and GPS location.',
    howItWorks:
      'Uses precise astronomical equations from the U.S. National Renewable Energy Laboratory. Accurate to within 0.0003° over a 2,000-year range. Accessed via the pvlib library, which is the standard tool used by solar energy researchers globally.',
    whyChosen:
      'No hand-written approximation can match this accuracy. pvlib is actively maintained, peer-reviewed, and used in commercial solar energy research.',
    codeFile: 'backend/app/ml/solar_geometry.py',
    inputs: 'UTC datetime, site latitude, longitude, altitude, timezone',
    output: 'Elevation (°), azimuth (°), zenith (°), apparent elevation (°)',
  },
  {
    name: 'Ineichen-Perez Clear-Sky Model',
    role: 'Theoretical Maximum Irradiance',
    color: 'border-green-300 bg-green-50',
    badge: 'bg-green-100 text-green-800',
    description:
      'Calculates how much irradiance would arrive on a perfectly clear day — no clouds, no haze. Used as the baseline and as a fallback when the ML model is not trained.',
    howItWorks:
      'Uses the Linke Turbidity Factor (a measure of atmospheric haziness) for the site location and computes GHI, DNI, and DHI components. pvlib includes a built-in global turbidity dataset, so no extra data is needed.',
    whyChosen:
      'Accurate globally with minimal inputs. Requires only location + time — no extra weather station data. The most widely used clear-sky model in practice.',
    codeFile: 'backend/app/ml/solar_geometry.py → get_clearsky_irradiance()',
    inputs: 'UTC datetime, site latitude, longitude, altitude',
    output: 'Clear-sky GHI (W/m²), DNI (W/m²), DHI (W/m²)',
  },
  {
    name: 'Geometric Single-Axis Tilt Formula',
    role: 'Optimal Panel Angle Calculation',
    color: 'border-purple-300 bg-purple-50',
    badge: 'bg-purple-100 text-purple-800',
    description:
      'Calculates the panel tilt angle that maximises direct sunlight capture given the sun\'s current elevation.',
    howItWorks:
      'For a north-south single-axis tracker, the formula is: tilt = 90° − solar_elevation. This is derived from basic trigonometry — it points the panel normal vector directly at the sun. Clamped to mechanical limits [0°, 70°].',
    whyChosen:
      'This is the exact mathematical optimum for DNI capture on a single-axis tracker. There is no ML involved in the angle calculation because the physics already gives the perfect answer.',
    codeFile: 'backend/app/ml/solar_geometry.py → _optimal_tilt_single_axis()',
    inputs: 'Solar elevation angle (°)',
    output: 'Optimal tilt angle (°), range 0–70°',
  },
  {
    name: 'Dead-Band Threshold Filter',
    role: 'Movement Decision Gate',
    color: 'border-orange-300 bg-orange-50',
    badge: 'bg-orange-100 text-orange-800',
    description:
      'Prevents the motor from moving unless the angle difference is large enough to justify it, reducing motor wear and energy consumption.',
    howItWorks:
      'Rule: if |target − current| < 3°, do nothing. If the difference exceeds 3°, move to the new target. The threshold is configurable. Without this, the motor would make thousands of micro-adjustments per day.',
    whyChosen:
      'Simple, effective, and directly reduces operating cost. The 3° default is a balance between tracking accuracy and motor longevity — the sun moves ~0.25°/min so a 3° threshold means roughly 4–6 movements per day.',
    codeFile: 'backend/app/ml/optimization.py → should_move()',
    inputs: 'Current angle (°), target angle (°), threshold (°)',
    output: 'Boolean: move or stay',
  },
]

export default function MLModel() {
  const [status, setStatus] = useState<ModelStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trainMsg, setTrainMsg] = useState<string | null>(null)
  const [trainErr, setTrainErr] = useState<string | null>(null)
  const [training, setTraining] = useState(false)
  const [showAlgorithms, setShowAlgorithms] = useState(true)

  // Training hyperparameters
  const [nEst, setNEst] = useState('300')
  const [maxDepth, setMaxDepth] = useState('6')
  const [lr, setLr] = useState('0.05')

  const [solarPos, setSolarPos] = useState<any>(null)
  const [optResult, setOptResult] = useState<any>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, pos, opt] = await Promise.all([
        mlService.getStatus(),
        mlService.getSolarPosition().catch(() => null),
        mlService.optimise().catch(() => null),
      ])
      setStatus(s)
      setSolarPos(pos)
      setOptResult(opt)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ML status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleTrain = async () => {
    setTrainMsg(null); setTrainErr(null)
    setTraining(true)
    try {
      const res = await mlService.triggerTraining({
        n_estimators: parseInt(nEst) || 300,
        max_depth: parseInt(maxDepth) || 6,
        learning_rate: parseFloat(lr) || 0.05,
      })
      setTrainMsg(res.message + ' — Check back in a moment, then refresh.')
    } catch (e) {
      setTrainErr(e instanceof Error ? e.message : 'Training request failed')
    } finally {
      setTraining(false)
    }
  }

  if (loading) return <div className="text-sm text-neutral-400 p-4">Loading…</div>
  if (error) return <ErrorMessage message={error} onRetry={load} />

  const s = status!
  const importance = s.feature_importance
    ? [...s.feature_importance].sort((a, b) => b.importance - a.importance).slice(0, 12)
    : []

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">ML Model & Algorithms</h1>
          <p className="page-sub">How the system decides where to point the panel</p>
        </div>
        <button onClick={load} className="btn btn-secondary btn-sm">Refresh</button>
      </div>

      {/* ── Algorithm Reference Section ─────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <div className="section-title mb-0">Algorithms Used in This System</div>
          <button
            onClick={() => setShowAlgorithms(!showAlgorithms)}
            className="text-xs text-neutral-400 hover:text-neutral-600"
          >
            {showAlgorithms ? 'Collapse ▲' : 'Expand ▼'}
          </button>
        </div>
        <p className="text-xs text-neutral-500 mb-3">
          5 algorithms work together every cycle. Click any card for details.
        </p>

        {/* Pipeline summary */}
        <div className="flex flex-wrap gap-2 mb-4">
          {ALGORITHMS.map((a, i) => (
            <div key={a.name} className="flex items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${a.badge}`}>
                {i + 1}. {a.role}
              </span>
              {i < ALGORITHMS.length - 1 && (
                <span className="text-neutral-300 text-xs">→</span>
              )}
            </div>
          ))}
        </div>

        {showAlgorithms && (
          <div className="space-y-3">
            {ALGORITHMS.map((a, i) => (
              <div key={a.name} className={`rounded border ${a.color} p-4`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mb-1 ${a.badge}`}>
                      Step {i + 1} — {a.role}
                    </span>
                    <div className="text-sm font-semibold text-neutral-800">{a.name}</div>
                  </div>
                </div>
                <p className="text-xs text-neutral-700 mb-2">{a.description}</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="font-semibold text-neutral-600 mb-0.5">How it works</div>
                    <p className="text-neutral-600">{a.howItWorks}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-neutral-600 mb-0.5">Why chosen over alternatives</div>
                    <p className="text-neutral-600">{a.whyChosen}</p>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-black/5 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="font-semibold text-neutral-500">Code: </span>
                    <code className="font-mono text-neutral-700 bg-white/60 px-1 rounded">{a.codeFile}</code>
                  </div>
                  <div>
                    <span className="font-semibold text-neutral-500">Inputs: </span>
                    <span className="text-neutral-600">{a.inputs}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-neutral-500">Output: </span>
                    <span className="text-neutral-600">{a.output}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Model status ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="section-title">XGBoost Model Status</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-neutral-500">Status</div>
            <div className={`text-sm font-medium mt-0.5 ${s.model_available ? 'text-green-700' : 'text-amber-700'}`}>
              {s.model_available ? '✓ Trained & Loaded' : '⚠ Not Trained'}
            </div>
            {!s.model_available && (
              <div className="text-xs text-neutral-400 mt-0.5">
                Using Ineichen clear-sky fallback
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-neutral-500">Model Type</div>
            <div className="text-sm mt-0.5">{s.model_type ?? 'XGBoost Regressor'}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Target Variable</div>
            <div className="text-sm mt-0.5">{s.target_variable ?? 'Solar Irradiance (W/m²)'}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Training Date</div>
            <div className="text-sm font-mono mt-0.5">
              {s.training_date ? new Date(s.training_date).toLocaleDateString() : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Version</div>
            <div className="text-sm font-mono mt-0.5">{s.model_version ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Training Records</div>
            <div className="text-sm font-mono mt-0.5">{s.num_training_records?.toLocaleString() ?? '—'}</div>
          </div>
        </div>
        {s.message && (
          <p className="text-xs text-neutral-400 mt-3 border-t border-neutral-100 pt-2">{s.message}</p>
        )}
      </div>

      {/* ── Metrics ──────────────────────────────────────────────────────── */}
      {s.model_available && (
        <div className="card">
          <div className="section-title">Evaluation Metrics (Test Set)</div>
          <div className="grid grid-cols-3 gap-4 mb-3">
            <div className="text-center">
              <div className="text-xs text-neutral-500 mb-1">MAE — Mean Absolute Error</div>
              <div className="text-2xl font-mono font-semibold">{s.mae?.toFixed(2) ?? '—'}</div>
              <div className="text-xs text-neutral-400">W/m² average error</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-neutral-500 mb-1">RMSE — Root Mean Squared Error</div>
              <div className="text-2xl font-mono font-semibold">{s.rmse?.toFixed(2) ?? '—'}</div>
              <div className="text-xs text-neutral-400">W/m² (penalises large errors)</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-neutral-500 mb-1">R² Score</div>
              <div className="text-2xl font-mono font-semibold">{s.r2?.toFixed(4) ?? '—'}</div>
              <div className="text-xs text-neutral-400">1.0 = perfect fit</div>
            </div>
          </div>
          <div className="rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
            <strong>How to read these:</strong> MAE is the average prediction error in W/m². 
            A 10W solar panel at peak sun produces ~1000 W/m² of irradiance, so an MAE of 
            50 W/m² is ~5% average error. R² above 0.90 indicates a well-fitted model. 
            Metrics are from a held-out time-series test split — they reflect unseen data only.
          </div>
        </div>
      )}

      {/* ── Feature importance chart ─────────────────────────────────────── */}
      {importance.length > 0 && (
        <div className="card">
          <div className="section-title">Feature Importance</div>
          <p className="text-xs text-neutral-500 mb-3">
            Which inputs matter most to the XGBoost model? Higher = more influential.
            <span className="ml-1 text-neutral-400">
              (Importance = fraction of decisions this feature contributes across all trees)
            </span>
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={importance}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 100, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="feature" tick={{ fontSize: 10 }} width={100} />
              <Tooltip
                formatter={(v: number) => [v.toFixed(4), 'Importance']}
                contentStyle={{ fontSize: 11 }}
              />
              <Bar dataKey="importance" fill="#5fb229" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-neutral-400 mt-2">
            Typically clearsky_ghi and solar_elevation dominate because irradiance is 
            physically driven by sun position. Temperature and humidity add correction for 
            actual atmospheric conditions.
          </p>
        </div>
      )}

      {/* ── Feature list ─────────────────────────────────────────────────── */}
      {s.features && (
        <div className="card">
          <div className="section-title">Input Features ({s.features.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {s.features.map((f) => (
              <span key={f} className="px-2 py-0.5 bg-neutral-100 text-neutral-700 rounded text-xs font-mono">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Live solar position & optimisation ──────────────────────────── */}
      {(solarPos || optResult) && (
        <div className="card">
          <div className="section-title">Live: Current Solar Position & Optimisation Result</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {solarPos && (
              <>
                <div>
                  <div className="text-xs text-neutral-500">Solar Elevation</div>
                  <div className="text-base font-mono mt-0.5">{solarPos.elevation_deg?.toFixed(1)}°</div>
                  <div className="text-xs text-neutral-400">above horizon</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Solar Azimuth</div>
                  <div className="text-base font-mono mt-0.5">{solarPos.azimuth_deg?.toFixed(1)}°</div>
                  <div className="text-xs text-neutral-400">from north</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Daytime?</div>
                  <div className={`text-sm font-medium mt-0.5 ${solarPos.is_daytime ? 'text-green-600' : 'text-neutral-400'}`}>
                    {solarPos.is_daytime ? 'Yes — sun above horizon' : 'No — panel stowed at 0°'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Geometric Tilt (90° − elevation)</div>
                  <div className="text-base font-mono mt-0.5">{solarPos.optimal_tilt_single_axis_deg?.toFixed(1)}°</div>
                  <div className="text-xs text-neutral-400">algorithm 4</div>
                </div>
              </>
            )}
          </div>
          {optResult && (
            <div className="border-t border-neutral-100 pt-3">
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                Dead-Band Result (Algorithm 5)
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-neutral-500">Current Angle</div>
                  <div className="font-mono text-sm">{optResult.current_angle}°</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Recommended</div>
                  <div className="font-mono text-sm text-solar-600">{optResult.recommended_angle}°</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Difference</div>
                  <div className="font-mono text-sm">{optResult.difference}°</div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Should Move?</div>
                  <div className={`text-sm font-medium mt-0.5 ${optResult.should_move ? 'text-amber-600' : 'text-green-600'}`}>
                    {optResult.should_move ? '→ Yes, movement triggered' : '✓ No, within threshold'}
                  </div>
                </div>
              </div>
              <p className="text-xs text-neutral-400 mt-2">{optResult.reason}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Train trigger ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="section-title">Train the XGBoost Model</div>
        <div className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800 mb-3">
          <strong>Before training:</strong> Place a CSV file with a <code className="font-mono">timestamp</code> column and a <code className="font-mono">ghi</code> column (W/m²) in{' '}
          <code className="font-mono bg-white/60 px-1 rounded">ml/data/raw/</code>.
          Optionally include <code className="font-mono">temperature</code> and <code className="font-mono">humidity</code> columns for better accuracy.
          Free data sources: NSRDB, Open-Meteo, PVGIS.{' '}
          <span className="font-semibold">See docs/DATA_AND_TRAINING.md for the complete guide.</span>
        </div>

        {trainMsg && (
          <div className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 mb-3">
            {trainMsg}
          </div>
        )}
        {trainErr && <ErrorMessage message={trainErr} />}

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">
              n_estimators
              <span className="ml-1 text-neutral-400 normal-case font-normal">(number of trees)</span>
            </label>
            <input type="number" className="input" value={nEst}
              onChange={(e) => setNEst(e.target.value)} min={50} max={2000} />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">
              max_depth
              <span className="ml-1 text-neutral-400 normal-case font-normal">(tree complexity)</span>
            </label>
            <input type="number" className="input" value={maxDepth}
              onChange={(e) => setMaxDepth(e.target.value)} min={2} max={12} />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">
              learning_rate
              <span className="ml-1 text-neutral-400 normal-case font-normal">(step size)</span>
            </label>
            <input type="number" className="input" value={lr}
              onChange={(e) => setLr(e.target.value)} step={0.01} min={0.001} max={1} />
          </div>
        </div>

        <div className="rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-500 mb-3">
          <strong>Hyperparameter guide:</strong> More estimators = more accurate but slower to train.
          Higher max_depth = can learn complex patterns but may overfit small datasets.
          Lower learning_rate with more estimators generally gives better results.
          The defaults (300 / 6 / 0.05) are a reliable starting point.
        </div>

        <button
          onClick={handleTrain}
          disabled={training}
          className="btn btn-primary disabled:opacity-50"
        >
          {training ? 'Starting training…' : 'Train XGBoost Model'}
        </button>
      </div>
    </div>
  )
}
