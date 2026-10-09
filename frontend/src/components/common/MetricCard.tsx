interface Props {
  label: string
  value: string | number | null
  unit?: string
  sub?: string
  accent?: 'green' | 'amber' | 'red' | 'blue' | 'neutral'
  large?: boolean
}

const accentClasses = {
  green:   'border-t-green-500',
  amber:   'border-t-amber-400',
  red:     'border-t-red-500',
  blue:    'border-t-blue-500',
  neutral: 'border-t-neutral-300',
}

export default function MetricCard({ label, value, unit, sub, accent = 'neutral', large = false }: Props) {
  return (
    <div className={`card border-t-2 ${accentClasses[accent]} flex flex-col gap-1`}>
      <p className="section-title mb-0">{label}</p>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className={`font-mono font-semibold text-neutral-800 ${large ? 'text-3xl' : 'text-2xl'}`}>
          {value ?? '—'}
        </span>
        {unit && <span className="text-sm text-neutral-500">{unit}</span>}
      </div>
      {sub && <p className="text-xs text-neutral-400 mt-0.5">{sub}</p>}
    </div>
  )
}
