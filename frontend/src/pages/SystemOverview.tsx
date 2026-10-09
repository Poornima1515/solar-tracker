/**
 * System Overview page
 * Shows:
 *  - 2D system architecture pipeline diagram (SVG, no external deps)
 *  - Hardware component specs table
 *  - Data flow explanation
 *  - Wiring summary
 */

export default function SystemOverview() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="page-title">System Overview</h1>
        <p className="page-sub">
          AI-Based Intelligent Solar Panel Tilt Optimization — architecture, hardware, and data flow
        </p>
      </div>

      {/* ── Architecture Pipeline Diagram ── */}
      <div className="card overflow-x-auto">
        <div className="section-title">System Architecture — Data Flow Pipeline</div>
        <PipelineDiagram />
      </div>

      {/* ── Hardware Block Diagram ── */}
      <div className="card overflow-x-auto">
        <div className="section-title">Hardware Block Diagram</div>
        <HardwareBlockDiagram />
      </div>

      {/* ── Component Specs ── */}
      <div className="card overflow-x-auto">
        <div className="section-title">Hardware Components</div>
        <table className="w-full">
          <thead>
            <tr>
              {['Component', 'Model', 'Interface', 'Role', 'Key Spec'].map((h) => (
                <th key={h} className="table-th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPONENTS.map((c) => (
              <tr key={c.model} className="hover:bg-neutral-50">
                <td className="table-td font-medium text-neutral-800">{c.name}</td>
                <td className="table-td font-mono text-xs">{c.model}</td>
                <td className="table-td">{c.iface}</td>
                <td className="table-td text-neutral-600">{c.role}</td>
                <td className="table-td text-xs text-neutral-500">{c.spec}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── GPIO Pin Map ── */}
      <div className="card overflow-x-auto">
        <div className="section-title">ESP32-S3 GPIO Pin Assignments</div>
        <table className="w-full">
          <thead>
            <tr>
              {['GPIO', 'Signal', 'Connected To', 'Notes'].map((h) => (
                <th key={h} className="table-th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PINS.map((p) => (
              <tr key={p.gpio} className="hover:bg-neutral-50">
                <td className="table-td font-mono font-semibold text-solar-700">{p.gpio}</td>
                <td className="table-td">{p.signal}</td>
                <td className="table-td">{p.connected}</td>
                <td className="table-td text-xs text-neutral-500">{p.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Software Stack ── */}
      <div className="card">
        <div className="section-title">Software Stack</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {STACK.map((s) => (
            <div key={s.layer} className="border border-neutral-200 rounded p-3">
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                {s.layer}
              </div>
              <ul className="space-y-1">
                {s.items.map((item) => (
                  <li key={item} className="text-xs font-mono text-neutral-700 bg-neutral-50 rounded px-2 py-0.5">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* ── Algorithm Decision Pipeline ── */}
      <div className="card">
        <div className="section-title">Algorithm Decision Pipeline — Every 10 Minutes</div>
        <p className="text-xs text-neutral-500 mb-4">
          These 5 algorithms run in sequence every tracking cycle to determine whether and where to move the panel.
        </p>
        <div className="space-y-2">
          {ALGORITHM_PIPELINE.map((step, i) => (
            <div key={step.name} className={`rounded border p-3 ${step.border}`}>
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step.badge}`}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-neutral-800">{step.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${step.badge}`}>{step.role}</span>
                  </div>
                  <p className="text-xs text-neutral-600 mb-1">{step.desc}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-neutral-500">
                    <span><strong>Why: </strong>{step.why}</span>
                  </div>
                </div>
                <div className="hidden md:block text-right text-xs text-neutral-400 flex-shrink-0 max-w-36">
                  <div className="font-semibold text-neutral-500 mb-0.5">Output</div>
                  <div>{step.output}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-neutral-400 mt-3">
          Full algorithm details, comparison with alternatives, and code references: see{' '}
          <code className="font-mono bg-neutral-100 px-1 rounded">docs/ALGORITHMS.md</code>
        </p>
      </div>

      {/* ── Operating Modes ── */}
      <div className="card">
        <div className="section-title">Operating Modes</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {MODES.map((m) => (
            <div key={m.name} className={`rounded border p-4 ${m.border}`}>
              <div className={`text-sm font-semibold mb-1 ${m.color}`}>{m.name}</div>
              <p className="text-xs text-neutral-600">{m.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Pipeline SVG Diagram ─────────────────────────────────────────────────────

function PipelineDiagram() {
  const steps = [
    { label: 'Weather /\nHistorical Data',  color: '#e0f2fe', border: '#7dd3fc', text: '#0369a1' },
    { label: 'Data\nPreprocessing',          color: '#f0fdf4', border: '#86efac', text: '#15803d' },
    { label: 'XGBoost\nML Model',            color: '#fef9c3', border: '#fde047', text: '#854d0e' },
    { label: 'Irradiance\nPrediction',       color: '#fef9c3', border: '#fde047', text: '#854d0e' },
    { label: 'Solar Geometry\n(pvlib)',       color: '#f0fdf4', border: '#86efac', text: '#15803d' },
    { label: 'Optimal\nTilt Angle',          color: '#fef9c3', border: '#fde047', text: '#854d0e' },
    { label: 'Movement\nThreshold Check',    color: '#fefce8', border: '#fde047', text: '#713f12' },
    { label: 'ESP32-S3\nController',         color: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' },
    { label: 'MG996R\nServo Motor',          color: '#fdf2f8', border: '#f0abfc', text: '#86198f' },
    { label: 'Panel\nMovement',              color: '#fdf2f8', border: '#f0abfc', text: '#86198f' },
    { label: 'INA219\nPower Sensor',         color: '#fff7ed', border: '#fdba74', text: '#9a3412' },
    { label: 'Backend\nDatabase',            color: '#f0fdf4', border: '#86efac', text: '#15803d' },
    { label: 'React\nDashboard',             color: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' },
  ]

  const BOX_W = 100
  const BOX_H = 52
  const COL_GAP = 36
  const ROW_GAP = 28
  const COLS = 4

  // Layout: wrap into rows of COLS
  const positions = steps.map((_, i) => ({
    col: i % COLS,
    row: Math.floor(i / COLS),
  }))

  const totalCols = COLS
  const totalRows = Math.ceil(steps.length / COLS)
  const svgW = totalCols * BOX_W + (totalCols - 1) * COL_GAP + 32
  const svgH = totalRows * BOX_H + (totalRows - 1) * ROW_GAP + 32

  const cx = (col: number) => 16 + col * (BOX_W + COL_GAP)
  const cy = (row: number) => 16 + row * (BOX_H + ROW_GAP)

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        width={svgW}
        height={svgH}
        className="block mx-auto"
        style={{ minWidth: svgW }}
      >
        {/* Arrows */}
        {steps.map((_, i) => {
          if (i === steps.length - 1) return null
          const fromCol = i % COLS
          const fromRow = Math.floor(i / COLS)
          const toCol = (i + 1) % COLS
          const toRow = Math.floor((i + 1) / COLS)

          const x1 = cx(fromCol) + BOX_W / 2
          const y1 = cy(fromRow) + BOX_H / 2
          const x2 = cx(toCol) + BOX_W / 2
          const y2 = cy(toRow) + BOX_H / 2

          // Same row: horizontal arrow right
          if (fromRow === toRow) {
            return (
              <g key={i}>
                <line
                  x1={cx(fromCol) + BOX_W} y1={y1}
                  x2={cx(toCol) - 4} y2={y1}
                  stroke="#a3a3a3" strokeWidth="1.5" markerEnd="url(#arrow)"
                />
              </g>
            )
          }
          // Row wrap: arrow goes down from last col, then across to first col of next row
          return (
            <g key={i}>
              <polyline
                points={`
                  ${cx(fromCol) + BOX_W / 2},${cy(fromRow) + BOX_H}
                  ${cx(fromCol) + BOX_W / 2},${cy(toRow) - 4}
                `}
                fill="none" stroke="#a3a3a3" strokeWidth="1.5"
                markerEnd="url(#arrow)"
              />
            </g>
          )
        })}

        {/* Arrow marker */}
        <defs>
          <marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#a3a3a3" />
          </marker>
        </defs>

        {/* Boxes */}
        {steps.map((step, i) => {
          const { col, row } = positions[i]
          const x = cx(col)
          const y = cy(row)
          const lines = step.label.split('\n')
          return (
            <g key={i}>
              <rect
                x={x} y={y} width={BOX_W} height={BOX_H} rx={6}
                fill={step.color} stroke={step.border} strokeWidth="1.5"
              />
              {lines.map((line, li) => (
                <text
                  key={li}
                  x={x + BOX_W / 2}
                  y={y + BOX_H / 2 + (li - (lines.length - 1) / 2) * 14}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize="9.5" fontWeight="600" fill={step.text}
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {line}
                </text>
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── Hardware Block Diagram ───────────────────────────────────────────────────

function HardwareBlockDiagram() {
  return (
    <div className="overflow-x-auto">
      <svg viewBox="0 0 620 300" width="620" height="300" className="block mx-auto" style={{ minWidth: 500 }}>
        <defs>
          <marker id="harrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#737373" />
          </marker>
        </defs>

        {/* ESP32 — centre */}
        <rect x="230" y="110" width="160" height="80" rx="8" fill="#eff6ff" stroke="#93c5fd" strokeWidth="2" />
        <text x="310" y="144" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1d4ed8" fontFamily="Inter,sans-serif">ESP32-S3</text>
        <text x="310" y="160" textAnchor="middle" fontSize="9" fill="#3b82f6" fontFamily="Inter,sans-serif">Main Controller</text>
        <text x="310" y="174" textAnchor="middle" fontSize="8.5" fill="#6b7280" fontFamily="Inter,sans-serif">Wi-Fi · HTTP · PWM · ADC · I²C</text>

        {/* BME280 */}
        <rect x="30" y="20" width="110" height="50" rx="6" fill="#f0fdf4" stroke="#86efac" strokeWidth="1.5" />
        <text x="85" y="42" textAnchor="middle" fontSize="10" fontWeight="600" fill="#15803d" fontFamily="Inter,sans-serif">BME280</text>
        <text x="85" y="58" textAnchor="middle" fontSize="8.5" fill="#6b7280" fontFamily="Inter,sans-serif">Temp · Humidity · Pressure</text>

        {/* INA219 */}
        <rect x="30" y="100" width="110" height="50" rx="6" fill="#fff7ed" stroke="#fdba74" strokeWidth="1.5" />
        <text x="85" y="122" textAnchor="middle" fontSize="10" fontWeight="600" fill="#9a3412" fontFamily="Inter,sans-serif">INA219</text>
        <text x="85" y="138" textAnchor="middle" fontSize="8.5" fill="#6b7280" fontFamily="Inter,sans-serif">Voltage · Current · Power</text>

        {/* LDR Left */}
        <rect x="30" y="180" width="110" height="50" rx="6" fill="#fefce8" stroke="#fde047" strokeWidth="1.5" />
        <text x="85" y="202" textAnchor="middle" fontSize="10" fontWeight="600" fill="#713f12" fontFamily="Inter,sans-serif">LDR × 2</text>
        <text x="85" y="218" textAnchor="middle" fontSize="8.5" fill="#6b7280" fontFamily="Inter,sans-serif">Light intensity (ADC)</text>

        {/* MG996R */}
        <rect x="480" y="110" width="120" height="50" rx="6" fill="#fdf2f8" stroke="#f0abfc" strokeWidth="1.5" />
        <text x="540" y="132" textAnchor="middle" fontSize="10" fontWeight="600" fill="#86198f" fontFamily="Inter,sans-serif">MG996R Servo</text>
        <text x="540" y="148" textAnchor="middle" fontSize="8.5" fill="#6b7280" fontFamily="Inter,sans-serif">Panel tilt actuator</text>

        {/* Solar Panel */}
        <rect x="480" y="200" width="120" height="50" rx="6" fill="#fef9c3" stroke="#fde047" strokeWidth="1.5" />
        <text x="540" y="222" textAnchor="middle" fontSize="10" fontWeight="600" fill="#854d0e" fontFamily="Inter,sans-serif">10W Solar Panel</text>
        <text x="540" y="238" textAnchor="middle" fontSize="8.5" fill="#6b7280" fontFamily="Inter,sans-serif">Power source</text>

        {/* Backend */}
        <rect x="230" y="240" width="160" height="50" rx="6" fill="#f0fdf4" stroke="#86efac" strokeWidth="1.5" />
        <text x="310" y="261" textAnchor="middle" fontSize="10" fontWeight="600" fill="#15803d" fontFamily="Inter,sans-serif">FastAPI Backend</text>
        <text x="310" y="277" textAnchor="middle" fontSize="8.5" fill="#6b7280" fontFamily="Inter,sans-serif">ML · DB · Dashboard</text>

        {/* I2C bus line */}
        <line x1="140" y1="45" x2="230" y2="140" stroke="#86efac" strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#harrow)" />
        <text x="172" y="88" fontSize="8" fill="#15803d" fontFamily="Inter,sans-serif">I²C</text>

        <line x1="140" y1="125" x2="230" y2="145" stroke="#fdba74" strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#harrow)" />
        <text x="165" y="130" fontSize="8" fill="#9a3412" fontFamily="Inter,sans-serif">I²C</text>

        <line x1="140" y1="205" x2="230" y2="170" stroke="#fde047" strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#harrow)" />
        <text x="163" y="193" fontSize="8" fill="#713f12" fontFamily="Inter,sans-serif">ADC</text>

        {/* ESP32 → Servo */}
        <line x1="390" y1="150" x2="480" y2="135" stroke="#f0abfc" strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#harrow)" />
        <text x="420" y="138" fontSize="8" fill="#86198f" fontFamily="Inter,sans-serif">PWM</text>

        {/* Solar panel → INA219 */}
        <line x1="480" y1="225" x2="140" y2="125" stroke="#fdba74" strokeWidth="1" strokeDasharray="3,4" markerEnd="url(#harrow)" />
        <text x="310" y="200" fontSize="8" fill="#9a3412" fontFamily="Inter,sans-serif">In series (+)</text>

        {/* ESP32 → Backend */}
        <line x1="310" y1="190" x2="310" y2="240" stroke="#86efac" strokeWidth="1.5" strokeDasharray="4,3" markerEnd="url(#harrow)" />
        <text x="316" y="220" fontSize="8" fill="#15803d" fontFamily="Inter,sans-serif">HTTP/JSON</text>
      </svg>
    </div>
  )
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const ALGORITHM_PIPELINE = [
  {
    name: 'NREL Solar Position Algorithm (via pvlib)',
    role: 'Sun Position',
    desc: 'Calculates the exact elevation, azimuth, and zenith of the sun for the current time and GPS location. Accurate to 0.0003°.',
    why: 'Physics-based, no training data needed, accurate everywhere on Earth.',
    output: 'Elevation (°), Azimuth (°)',
    border: 'border-blue-200 bg-blue-50',
    badge: 'bg-blue-100 text-blue-800',
  },
  {
    name: 'Ineichen-Perez Clear-Sky Model (pvlib)',
    role: 'Theoretical Irradiance',
    desc: 'Computes how much irradiance would arrive on a perfectly clear day. Used as a fallback when the ML model is not trained.',
    why: 'Requires only location + time. Globally accurate. Standard model in solar energy research.',
    output: 'GHI, DNI, DHI (W/m²)',
    border: 'border-green-200 bg-green-50',
    badge: 'bg-green-100 text-green-800',
  },
  {
    name: 'XGBoost (eXtreme Gradient Boosting)',
    role: 'Irradiance Prediction (ML)',
    desc: 'Predicts actual irradiance accounting for clouds and weather. Trained on historical solar + weather data. Uses 13 features including time, solar angles, clear-sky estimates, temperature, and humidity.',
    why: 'Outperforms other ML models on tabular/structured data, trains fast, handles missing features, gives interpretable feature importance.',
    output: 'Predicted GHI (W/m²)',
    border: 'border-yellow-200 bg-yellow-50',
    badge: 'bg-yellow-100 text-yellow-800',
  },
  {
    name: 'Geometric Single-Axis Tilt Formula',
    role: 'Optimal Angle',
    desc: 'Computes the mathematically optimal panel tilt: tilt = 90° − solar_elevation. This points the panel normal directly at the sun to maximise DNI capture. Clamped to [0°, 70°].',
    why: 'This is the exact physics optimum. No ML needed for this step — the formula is derived from trigonometry.',
    output: 'Target angle (°)',
    border: 'border-purple-200 bg-purple-50',
    badge: 'bg-purple-100 text-purple-800',
  },
  {
    name: 'Dead-Band Threshold Filter',
    role: 'Movement Gate',
    desc: 'Only moves the motor if the angle difference exceeds 3° (configurable). Prevents thousands of micro-adjustments per day. Default threshold balances tracking accuracy vs. motor wear.',
    why: 'Without this, the motor would run constantly as the sun moves 0.25°/min. Motor energy cost would offset the tracking gain.',
    output: 'Move or stay, with reason',
    border: 'border-orange-200 bg-orange-50',
    badge: 'bg-orange-100 text-orange-800',
  },
]

const COMPONENTS = [
  { name: 'Microcontroller', model: 'ESP32-S3 DevKit', iface: 'Wi-Fi / USB', role: 'Main controller — runs firmware, serves HTTP, sends telemetry', spec: 'Dual-core 240 MHz, 12-bit ADC, Wi-Fi 802.11 b/g/n' },
  { name: 'Servo Motor',     model: 'MG996R',          iface: 'PWM GPIO18',  role: 'Physically tilts the solar panel', spec: '0–180°, 9.4 kg·cm torque, 4.8–7.2 V supply' },
  { name: 'Env. Sensor',     model: 'BME280',           iface: 'I²C (8/9)',   role: 'Measures temperature, humidity, pressure', spec: '±0.5°C temp, ±3% RH, I²C address 0x76/0x77' },
  { name: 'Power Sensor',    model: 'INA219',           iface: 'I²C (8/9)',   role: 'Measures panel voltage, current, power', spec: '26 V max, 3.2 A max, 12-bit resolution' },
  { name: 'Light Sensor',    model: 'LDR (×2)',         iface: 'ADC (4/5)',   role: 'Qualitative left/right light comparison', spec: '10 kΩ nominal, voltage divider configuration' },
  { name: 'Solar Panel',     model: '10 W Polycrystalline', iface: 'Electrical', role: 'Energy source under test', spec: 'Voc ~21 V, Vmp ~17 V, Isc ~0.62 A' },
]

const PINS = [
  { gpio: 'GPIO 8',  signal: 'I²C SDA', connected: 'BME280 SDA + INA219 SDA', notes: 'Shared bus, 4.7 kΩ pull-up to 3.3 V' },
  { gpio: 'GPIO 9',  signal: 'I²C SCL', connected: 'BME280 SCL + INA219 SCL', notes: 'Shared bus, 4.7 kΩ pull-up to 3.3 V' },
  { gpio: 'GPIO 18', signal: 'PWM',      connected: 'MG996R signal wire',      notes: 'Servo powered from external 5–6 V, NOT ESP32 3.3 V' },
  { gpio: 'GPIO 4',  signal: 'ADC',      connected: 'LDR 1 (Left)',            notes: '12-bit ADC, 0–4095. Voltage divider with 10 kΩ' },
  { gpio: 'GPIO 5',  signal: 'ADC',      connected: 'LDR 2 (Right)',           notes: '12-bit ADC, 0–4095. Voltage divider with 10 kΩ' },
  { gpio: '3.3 V',   signal: 'Power',    connected: 'BME280, INA219',          notes: 'Sensor supply only' },
  { gpio: 'GND',     signal: 'Ground',   connected: 'All components',          notes: 'Servo GND must share with ESP32 GND' },
]

const STACK = [
  { layer: 'Frontend',  items: ['React 18', 'Vite + TypeScript', 'Tailwind CSS', 'Recharts'] },
  { layer: 'Backend',   items: ['FastAPI', 'SQLAlchemy', 'Pydantic', 'Uvicorn'] },
  { layer: 'ML',        items: ['XGBoost', 'pvlib', 'scikit-learn', 'pandas'] },
  { layer: 'Firmware',  items: ['ESP32-S3', 'PlatformIO', 'Arduino C++', 'ArduinoJson'] },
]

const MODES = [
  {
    name: 'Demo Mode',
    desc: 'Hardware offline. Backend generates simulated sensor data using a solar bell-curve model. All values are clearly labelled as demo data. Used for testing and presentation without physical hardware.',
    border: 'border-amber-200 bg-amber-50',
    color: 'text-amber-700',
  },
  {
    name: 'Auto Tracking Mode',
    desc: 'ESP32 connected. Backend runs the predict → optimise → move cycle every 10 minutes. XGBoost predicts irradiance, pvlib calculates solar position, optimiser decides the target angle, servo moves if the difference exceeds the 3° threshold.',
    border: 'border-green-200 bg-green-50',
    color: 'text-green-700',
  },
  {
    name: 'Manual Mode',
    desc: 'Operator sends explicit tilt commands via the Panel Control page. Auto-tracking is paused. Useful for calibration, testing mechanical limits, or demonstrating the servo response.',
    border: 'border-blue-200 bg-blue-50',
    color: 'text-blue-700',
  },
]
