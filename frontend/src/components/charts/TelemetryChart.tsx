import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { fmt } from '../../utils/formatters'

interface DataPoint {
  timestamp: string
  [key: string]: string | number | null | undefined
}

interface Series {
  key: string
  label: string
  unit: string
  color: string
}

interface Props {
  data: DataPoint[]
  series: Series[]
  title: string
  height?: number
  loading?: boolean
  emptyMessage?: string
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-neutral-200 rounded shadow-sm p-2 text-xs">
      <p className="text-neutral-500 mb-1">{fmt.ts(label)}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-mono">
          {p.name}:{' '}
          <span className="font-semibold">
            {p.value != null ? Number(p.value).toFixed(2) : '—'}
          </span>
          {p.unit && <span className="text-neutral-400 ml-0.5">{p.unit.trim()}</span>}
        </p>
      ))}
    </div>
  )
}

export default function TelemetryChart({
  data,
  series,
  title,
  height = 220,
  loading,
  emptyMessage = 'No data in selected range',
}: Props) {
  if (loading) {
    return (
      <div className="bg-white border border-neutral-200 rounded p-4">
        {title && (
          <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
            {title}
          </div>
        )}
        <div
          className="flex items-center justify-center text-neutral-300 text-sm"
          style={{ height }}
        >
          Loading…
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-white border border-neutral-200 rounded p-4">
        {title && (
          <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
            {title}
          </div>
        )}
        <div
          className="flex items-center justify-center text-neutral-300 text-sm"
          style={{ height }}
        >
          {emptyMessage}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-neutral-200 rounded p-4">
      {title && (
        <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
          {title}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={(v) => fmt.timeOnly(v)}
            tick={{ fontSize: 10, fill: '#a3a3a3' }}
            minTickGap={40}
          />
          <YAxis tick={{ fontSize: 10, fill: '#a3a3a3' }} width={45} />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconType="line" iconSize={10} wrapperStyle={{ fontSize: 11 }} />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              unit={` ${s.unit}`}
              stroke={s.color}
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
