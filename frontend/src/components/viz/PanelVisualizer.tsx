/**
 * PanelVisualizer — 2D SVG panel that rotates based on current tilt angle.
 * Sun position changes based on solar elevation and azimuth.
 */

interface Props {
  currentAngle: number    // degrees (0 = horizontal, 70 = steep)
  optimalAngle: number
  solarElevation: number  // degrees above horizon
  solarAzimuth: number    // degrees clockwise from north
  isDaytime: boolean
  motorMoving: boolean
}

function SunIcon({ x, y, r, opacity }: { x: number; y: number; r: number; opacity: number }) {
  return (
    <g opacity={opacity}>
      <circle cx={x} cy={y} r={r} fill="#FCD34D" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
        const rad = (angle * Math.PI) / 180
        const x1 = x + (r + 3) * Math.cos(rad)
        const y1 = y + (r + 3) * Math.sin(rad)
        const x2 = x + (r + 8) * Math.cos(rad)
        const y2 = y + (r + 8) * Math.sin(rad)
        return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FCD34D" strokeWidth={1.5} strokeLinecap="round" />
      })}
    </g>
  )
}

export default function PanelVisualizer({
  currentAngle,
  optimalAngle,
  solarElevation,
  solarAzimuth,
  isDaytime,
  motorMoving,
}: Props) {
  const W = 340
  const H = 260
  const cx = W / 2        // pivot x
  const cy = H - 48       // pivot y (base of panel)
  const panelLen = 100
  const panelW = 18

  // Panel rotation: 0° = horizontal (flat), 90° = vertical
  // We rotate around the bottom-centre pivot point
  const panelRotate = -(currentAngle)   // negative = tilt toward sun (left)

  // Sun position: map elevation to Y (high elevation = higher up), azimuth to X
  // Azimuth: 90=east (left), 180=south (top), 270=west (right)
  const sunNorm = Math.max(0, Math.min(solarElevation / 85, 1))
  // X: azimuth 90→left edge, 270→right edge
  const azNorm  = (solarAzimuth - 90) / 180  // 0=east, 1=west
  const sunX = 30 + azNorm * (W - 60)
  const sunY = (H - 80) * (1 - sunNorm * 0.8) + 10
  const sunOpacity = isDaytime ? 1 : 0.15

  // Shadow ray from sun toward panel centre
  const panelTopX = cx + Math.sin((currentAngle * Math.PI) / 180) * (-panelLen * 0.5)
  const panelTopY = cy - Math.cos((currentAngle * Math.PI) / 180) * (panelLen * 0.5)

  // Optimal angle indicator
  const optRad = (optimalAngle * Math.PI) / 180
  const optX = cx + Math.sin(optRad) * (-80)
  const optY = cy - Math.cos(optRad) * 80

  const diff = Math.abs(currentAngle - optimalAngle)
  const aligned = diff < 2

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ maxHeight: 260 }}
        aria-label={`Solar panel visualization — current angle ${currentAngle}°`}
      >
        {/* Sky gradient */}
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isDaytime ? '#EFF6FF' : '#1E293B'} />
            <stop offset="100%" stopColor={isDaytime ? '#FEF9C3' : '#334155'} />
          </linearGradient>
          <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D6D3D1" />
            <stop offset="100%" stopColor="#A8A29E" />
          </linearGradient>
        </defs>

        {/* Sky */}
        <rect x={0} y={0} width={W} height={H - 40} fill="url(#sky)" rx={8} />

        {/* Ground */}
        <rect x={0} y={H - 42} width={W} height={42} fill="url(#ground)" rx={4} />

        {/* Sun */}
        <SunIcon x={sunX} y={sunY} r={14} opacity={sunOpacity} />

        {/* Sun label */}
        {isDaytime && (
          <text x={sunX} y={sunY - 20} textAnchor="middle" fontSize={9} fill="#92400E" fontWeight={600}>
            {solarElevation.toFixed(0)}°
          </text>
        )}

        {/* Optimal angle guide (dashed) */}
        {isDaytime && !aligned && (
          <line
            x1={cx} y1={cy}
            x2={optX} y2={optY}
            stroke="#6EE7B7"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            opacity={0.7}
          />
        )}

        {/* Pole / stand */}
        <rect x={cx - 3} y={cy - 30} width={6} height={30} fill="#78716C" rx={2} />

        {/* Panel group */}
        <g transform={`rotate(${panelRotate}, ${cx}, ${cy})`}>
          {/* Panel shadow */}
          <rect
            x={cx - panelLen / 2 - 1}
            y={cy - panelW - 1}
            width={panelLen + 2}
            height={panelW + 2}
            fill="#00000030"
            rx={2}
          />
          {/* Panel body */}
          <rect
            x={cx - panelLen / 2}
            y={cy - panelW}
            width={panelLen}
            height={panelW}
            fill={aligned ? '#22C55E' : motorMoving ? '#3B82F6' : '#1D4ED8'}
            rx={2}
            opacity={0.9}
          />
          {/* Grid lines */}
          {[-33, 0, 33].map((offset) => (
            <line
              key={offset}
              x1={cx + offset} y1={cy - panelW}
              x2={cx + offset} y2={cy}
              stroke="white" strokeWidth={0.5} opacity={0.3}
            />
          ))}
          <line x1={cx - panelLen / 2} y1={cy - panelW / 2} x2={cx + panelLen / 2} y2={cy - panelW / 2}
            stroke="white" strokeWidth={0.5} opacity={0.3} />
          {/* Panel label */}
          <text x={cx} y={cy - panelW / 2 + 3} textAnchor="middle" fontSize={7} fill="white" fontWeight={700} opacity={0.9}>
            SOLAR PANEL
          </text>
        </g>

        {/* Angle arc */}
        <path
          d={`M ${cx + 40} ${cy} A 40 40 0 0 0 ${cx + 40 * Math.cos((currentAngle * Math.PI) / 180 + Math.PI / 2)} ${cy - 40 * Math.sin((currentAngle * Math.PI) / 180 + Math.PI / 2)}`}
          fill="none" stroke="#6366F1" strokeWidth={1.5} strokeDasharray="3 2"
        />

        {/* Angle text */}
        <text x={cx + 52} y={cy - 12} fontSize={11} fill="#4F46E5" fontWeight={700}>
          {currentAngle.toFixed(1)}°
        </text>

        {/* Status text */}
        {motorMoving && (
          <text x={cx} y={H - 52} textAnchor="middle" fontSize={9} fill="#3B82F6" fontWeight={600}>
            ● ADJUSTING
          </text>
        )}
        {aligned && isDaytime && !motorMoving && (
          <text x={cx} y={H - 52} textAnchor="middle" fontSize={9} fill="#22C55E" fontWeight={600}>
            ✓ OPTIMAL
          </text>
        )}
        {!isDaytime && (
          <text x={cx} y={H - 52} textAnchor="middle" fontSize={9} fill="#94A3B8" fontWeight={600}>
            ◗ NIGHT
          </text>
        )}
      </svg>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-1 text-xs text-neutral-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-blue-600 inline-block" />
          Current {currentAngle.toFixed(1)}°
        </span>
        {isDaytime && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-emerald-400 border-dashed border-b border-emerald-400 inline-block" style={{ borderStyle: 'dashed' }} />
            Optimal {optimalAngle.toFixed(1)}°
          </span>
        )}
      </div>
    </div>
  )
}
