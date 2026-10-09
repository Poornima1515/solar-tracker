interface Props {
  label: string
  value: string
  unit?: string
  sub?: string
  muted?: boolean
}

export default function MetricCard({ label, value, unit, sub, muted }: Props) {
  return (
    <div className="bg-white border border-neutral-200 rounded p-4">
      <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-semibold font-mono tabular-nums ${muted ? 'text-neutral-400' : 'text-neutral-800'}`}>
        {value}
        {unit && <span className="text-sm font-normal text-neutral-400 ml-1">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-neutral-400 mt-1">{sub}</div>}
    </div>
  )
}
